<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import BaseDialog from "../../components/BaseDialog.vue";
import BaseSelect from "../../components/BaseSelect.vue";
import BaseCheckbox from "../../components/BaseCheckbox.vue";
import BaseTooltip from "../../components/BaseTooltip.vue";
import MapArtworkLayoutEditor from "../../components/MapArtworkLayoutEditor.vue";
import WebDocs from "./WebDocs.vue";
import { del, download, get, patch, post, RequestError, request } from "../../utils/request";
import {
  mapCanvas,
  mergeMapCanvases,
  type MapIcon,
  type MosaicRegion,
} from "../../utils/mapRenderer";
import { useAlertStore } from "../../stores/alert";
import { useAuthStore } from "../../stores/auth";
import { playerNamesRequest } from "../../utils/login";

type ScanMap = {
  key: string;
  map_id: number;
  pixels_base64: string;
  icons: MapIcon[];
  frame: { x: number; y: number; z: number; facing: string | null };
  exists?: boolean;
};
type Artwork = {
  group_id: string;
  name: string;
  price: string;
  author: string;
  source_pw: string;
  description: string;
  category: string;
  tags: string | string[];
  creator_username: string;
  preview_file: string;
  visibility: string;
  status: string;
  view_count: number;
  like_count: number;
  liked: number;
  created_at: string;
  updated_at: string;
};
type SaveResult = { ids: number[]; group_id: string; remaining: number };
type Landmark = {
  id: number;
  name: string;
  owner: string;
  description: string;
  visits: number;
};

const PAGE_SIZE = 24;
const pw = ref("");
const scanMode = ref<"pw" | "teleport">("pw");
const scanning = ref(false);
const saving = ref(false);
const error = ref("");
const scanId = ref("");
const maps = ref<ScanMap[]>([]);
const selected = ref<
  Record<string, { x: number; y: number; rotation: number; mirror: boolean }>
>({});
const editedMapKeys = ref<Record<string, true>>({});
const selectedKey = ref("");
const name = ref("");
const price = ref("");
const author = ref("");
const previewZoom = ref(1);
const indexZoom = ref(1);
const mosaicRegions = ref<MosaicRegion[]>([]);
const activeMosaicIndex = ref(-1);
const mosaicDrawing = ref(false);
const mosaicDrawStart = ref<{ x: number; y: number } | null>(null);
const mosaicMove = ref<{ index: number; pointerX: number; pointerY: number; x: number; y: number } | null>(null);
const draggingKey = ref("");
const resultOpen = ref(false);
const mapFilterMode = ref<"地图 ID" | "展示框坐标">("地图 ID");
const mapFilterModeOptions = ["地图 ID", "展示框坐标"];
const mapIdSearch = ref("");
const mapCoordinateSearch = ref({ x: "", y: "", z: "" });
const automaticGrouping = ref(true);
const mapPage = ref(1);
const artworkOrder = ref("不排序");
const artworkOrderOptions = [
  "不排序",
  "X 从小到大",
  "X 从大到小",
  "Z 从小到大",
  "Z 从大到小",
];
const artworks = ref<Artwork[]>([]);
const loadingArtworks = ref(false);
const keyword = ref("");
const archiveSearchField = ref<
  "name" | "author" | "description" | "tags" | "source_pw"
>("name");
const page = ref(1);
const totalPages = ref(1);
const totalArtworks = ref(0);
const navOpen = ref(false);
const navShell = ref<HTMLElement | null>(null);
const alertStore = useAlertStore();
const authStore = useAuthStore();
const description = ref("");
const category = ref("other");
const tagInput = ref("");
const visibility = ref("public");
const archiveCategory = ref("全部分类");
const archiveSort = ref("最近更新");
const archiveScope = ref<"all" | "favorites" | "added" | "created">("all");
const detailOpen = ref(false);
const detail = ref<Artwork | null>(null);
const detailPreviewZoom = ref(1);
const detailPreviewMirror = ref(false);
const detailTiles = ref<any[]>([]);
const detailVersions = ref<any[]>([]);
const duplicateArtwork = ref<Artwork | null>(null);
const duplicateOpen = ref(false);
const metadataOpen = ref(false);
const layoutOpen = ref(false);
const layoutSaving = ref(false);
const layoutTiles = ref<any[]>([]);
const creationMetadataOpen = ref(false);
const metadata = ref({
  name: "",
  price: "",
  source_pw: "",
  author: "",
  description: "",
  category: "其他",
  tags: "",
  visibility: "公开",
  status: "published",
});
const reportReason = ref("");
const landmarkDialogOpen = ref(false);
const landmarks = ref<Landmark[]>([]);
const landmarkLoading = ref(false);
const landmarkError = ref("");
const playerSearchOpen = ref(false);
const playerSearchInput = ref("");
const playerSearchResults = ref<string[]>([]);
const playerSearchLoading = ref(false);
const playerSearchError = ref("");
const playerSearchPage = ref(1);
const playerSearchTotalPages = ref(1);
const playerSearchHasPrevious = ref(false);
const playerSearchHasNext = ref(false);
const activeShareModule = ref<"maps" | "docs">("maps");

function moduleFromHash() {
  return window.location.hash === "#docs" ? "docs" : "maps";
}

function loadActiveShareModule() {
  activeShareModule.value = moduleFromHash();
  if (activeShareModule.value === "maps" && !loadingArtworks.value)
    void loadArtworks();
}

function selectShareModule(module: "maps" | "docs") {
  navOpen.value = false;
  if (window.location.hash === `#${module}`) {
    activeShareModule.value = module;
    return;
  }
  window.location.hash = module;
}

const filteredMaps = computed(() => {
  if (mapFilterMode.value === "地图 ID") {
    const query = mapIdSearch.value.trim();
    return query
      ? maps.value.filter((map) => String(map.map_id).includes(query))
      : maps.value;
  }
  const coordinates = mapCoordinateSearch.value;
  return maps.value.filter(
    (map) =>
      (coordinates.x === "" || map.frame.x === Number(coordinates.x)) &&
      (coordinates.y === "" || map.frame.y === Number(coordinates.y)) &&
      (coordinates.z === "" || map.frame.z === Number(coordinates.z)),
  );
});
const mapGroups = computed(() => {
  const items = filteredMaps.value;
  if (!automaticGrouping.value)
    return items.map((map, index) => ({
      key: `map-${map.key}`,
      maps: [map],
      index,
    }));
  const byCoordinate = new Map<
    string,
    Array<{ map: ScanMap; index: number }>
  >();
  for (const [index, map] of items.entries()) {
    const coordinate = `${map.frame.x},${map.frame.y},${map.frame.z}`;
    const entries = byCoordinate.get(coordinate) || [];
    entries.push({ map, index });
    byCoordinate.set(coordinate, entries);
  }
  const visited = new Set<string>(),
    groups: Array<{ key: string; maps: ScanMap[]; index: number }> = [];
  for (const entries of byCoordinate.values())
    for (const entry of entries) {
      if (visited.has(entry.map.key)) continue;
      const group: ScanMap[] = [],
        queue = [entry];
      visited.add(entry.map.key);
      while (queue.length) {
        const current = queue.shift()!;
        group.push(current.map);
        for (const [x, y, z] of [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ] as Array<[number, number, number]>) {
          const neighbors =
            byCoordinate.get(
              `${current.map.frame.x + x},${current.map.frame.y + y},${current.map.frame.z + z}`,
            ) || [];
          for (const neighbor of neighbors)
            if (!visited.has(neighbor.map.key)) {
              visited.add(neighbor.map.key);
              queue.push(neighbor);
            }
        }
      }
      group.sort((left, right) => items.indexOf(left) - items.indexOf(right));
      groups.push({
        key: `group-${group[0]!.key}`,
        maps: group,
        index: Math.min(...group.map((map) => items.indexOf(map))),
      });
    }
  return groups.sort((left, right) => left.index - right.index);
});
const groupedMapPages = computed(() => {
  const pages: typeof mapGroups.value[] = [];
  let current: typeof mapGroups.value = [], tileCount = 0;
  for (const group of mapGroups.value) {
    if (current.length && tileCount + group.maps.length > 15) {
      pages.push(current);
      current = [];
      tileCount = 0;
    }
    current.push(group);
    tileCount += group.maps.length;
  }
  if (current.length) pages.push(current);
  return pages;
});
const mapTotalPages = computed(() => Math.max(1, groupedMapPages.value.length));
const visibleGroups = computed(() => groupedMapPages.value[mapPage.value - 1] || []);
const selectedList = computed(() => selectedMaps());
const editedMapCount = computed(
  () => maps.value.filter((map) => editedMapKeys.value[map.key]).length,
);
const activeMap = computed(
  () => maps.value.find((map) => map.key === selectedKey.value) || null,
);
const gridSize = computed(() => {
  const items = selectedList.value;
  if (!items.length) return null;
  return {
    width:
      Math.max(...items.map((item) => item.x)) -
      Math.min(...items.map((item) => item.x)) +
      1,
    height:
      Math.max(...items.map((item) => item.y)) -
      Math.min(...items.map((item) => item.y)) +
      1,
  };
});
const previewBounds = computed(() => {
  const items = selectedList.value;
  if (!items.length) return null;
  const minX = Math.min(...items.map((item) => item.x));
  const maxX = Math.max(...items.map((item) => item.x));
  const minY = Math.min(...items.map((item) => item.y));
  const maxY = Math.max(...items.map((item) => item.y));
  return { minX, minY, width: maxX - minX + 1, height: maxY - minY + 1 };
});
const previewGridStyle = computed(() => {
  const bounds = previewBounds.value;
  if (!bounds) return {};
  const cell = 128 * previewZoom.value;
  return {
    gridTemplateColumns: `repeat(${bounds.width + 2}, ${cell}px)`,
    gridTemplateRows: `repeat(${bounds.height + 2}, ${cell}px)`,
  };
});
const activeMosaic = computed(() => mosaicRegions.value[activeMosaicIndex.value] || null);

function selectedMaps(): Array<
  ScanMap & { x: number; y: number; rotation: number; mirror: boolean }
> {
  return maps.value.flatMap((map) => {
    const position = selected.value[map.key];
    return position
      ? [{ ...map, x: position.x, y: position.y, rotation: position.rotation, mirror: position.mirror }]
      : [];
  });
}

function positionFor(key: string) {
  return selected.value[key] || { x: 0, y: 0, rotation: 0, mirror: false };
}

function nextPosition() {
  const used = new Set(
    Object.values(selected.value).map(
      (position) => `${position.x},${position.y}`,
    ),
  );
  let x = 0;
  let y = 0;
  while (used.has(`${x},${y}`)) {
    x++;
    if (x >= 8) {
      x = 0;
      y++;
    }
  }
  return { x, y, rotation: 0, mirror: false };
}

function toggle(map: ScanMap) {
  if (selected.value[map.key]) {
    const copy = { ...selected.value };
    delete copy[map.key];
    selected.value = copy;
    if (selectedKey.value === map.key)
      selectedKey.value = selectedList.value[0]?.key || "";
    return;
  }
  selected.value = { ...selected.value, [map.key]: nextPosition() };
  selectedKey.value = map.key;
}

function setPosition(key: string, axis: "x" | "y", event: Event) {
  const value = Number((event.target as HTMLInputElement).value);
  if (!Number.isInteger(value)) return;
  const current = selected.value[key];
  if (!current) return;
  const next = { ...current, [axis]: value };
  if (
    Object.entries(selected.value).some(
      ([other, position]) =>
        other !== key && position.x === next.x && position.y === next.y,
    )
  ) {
    error.value = "拼图位置不能重叠";
    return;
  }
  error.value = "";
  selected.value = { ...selected.value, [key]: next };
}

function rotateSelected(step: 90 | -90) {
  const key = selectedKey.value,
    current = selected.value[key];
  if (!current) return;
  selected.value = {
    ...selected.value,
    [key]: { ...current, rotation: (current.rotation + step + 360) % 360 },
  };
}
function mirrorSelected() {
  const key = selectedKey.value, current = selected.value[key];
  if (!current) return;
  selected.value = { ...selected.value, [key]: { ...current, mirror: !current.mirror } };
}

function autoArrange() {
  const items = selectedList.value;
  if (!items.length) return;
  const minX = Math.min(...items.map((item) => item.frame.x)),
    maxX = Math.max(...items.map((item) => item.frame.x));
  const minZ = Math.min(...items.map((item) => item.frame.z)),
    maxZ = Math.max(...items.map((item) => item.frame.z)),
    maxY = Math.max(...items.map((item) => item.frame.y));
  const horizontalAxis: "x" | "z" = maxX - minX >= maxZ - minZ ? "x" : "z";
  const minHorizontal = horizontalAxis === "x" ? minX : minZ;
  const occupied = new Set<string>(),
    next: Record<string, { x: number; y: number; rotation: number; mirror: boolean }> = {};
  for (const item of [...items].sort(
    (left, right) =>
      right.frame.y - left.frame.y ||
      left.frame[horizontalAxis] - right.frame[horizontalAxis],
  )) {
    let x = item.frame[horizontalAxis] - minHorizontal,
      y = maxY - item.frame.y;
    while (occupied.has(`${x},${y}`)) x++;
    occupied.add(`${x},${y}`);
    next[item.key] = { x, y, rotation: item.rotation, mirror: item.mirror };
  }
  selected.value = { ...selected.value, ...next };
  error.value = "";
}

function orderByAxis(axis: "x" | "z", direction: 1 | -1) {
  const items = selectedList.value;
  if (!items.length) return;
  const slots = [...items].sort(
    (left, right) => left.y - right.y || left.x - right.x,
  );
  const ordered = [...items].sort(
    (left, right) =>
      direction * (left.frame[axis] - right.frame[axis]) ||
      left.map_id - right.map_id,
  );
  const next = { ...selected.value };
  for (const [index, item] of ordered.entries()) {
    const slot = slots[index]!;
    next[item.key] = { x: slot.x, y: slot.y, rotation: item.rotation, mirror: item.mirror };
  }
  selected.value = next;
}

function applyArtworkOrder(value: string) {
  artworkOrder.value = value;
  const ordering: Record<string, ["x" | "z", 1 | -1]> = {
    "X 从小到大": ["x", 1],
    "X 从大到小": ["x", -1],
    "Z 从小到大": ["z", 1],
    "Z 从大到小": ["z", -1],
  };
  const option = ordering[value];
  if (option) orderByAxis(...option);
}

function selectAll() {
  const next = { ...selected.value };
  for (const map of filteredMaps.value)
    if (!next[map.key]) next[map.key] = nextPositionFor(next);
  selected.value = next;
  selectedKey.value ||= filteredMaps.value[0]?.key || "";
}

function toggleGroup(group: ScanMap[]) {
  const allSelected = group.every((map) => !!selected.value[map.key]);
  const next = { ...selected.value };
  if (allSelected) for (const map of group) delete next[map.key];
  else
    for (const map of group)
      if (!next[map.key]) next[map.key] = nextPositionFor(next);
  selected.value = next;
  selectedKey.value = allSelected
    ? selectedList.value.find(
        (map) => !group.some((item) => item.key === map.key),
      )?.key || ""
    : group[0]?.key || selectedKey.value;
}
function groupActionLabel(group: ScanMap[]) {
  return group.every((map) => selected.value[map.key])
    ? "取消本组"
    : "选中本组";
}

function nextPositionFor(
  entries: Record<string, { x: number; y: number; rotation: number; mirror: boolean }>,
) {
  const used = new Set(
    Object.values(entries).map((position) => `${position.x},${position.y}`),
  );
  let x = 0;
  let y = 0;
  while (used.has(`${x},${y}`)) {
    x++;
    if (x >= 8) {
      x = 0;
      y++;
    }
  }
  return { x, y, rotation: 0, mirror: false };
}

function clearSelected() {
  selected.value = {};
  selectedKey.value = "";
  mosaicRegions.value = [];
  activeMosaicIndex.value = -1;
  error.value = "";
}
function addMosaicRegion() {
  mosaicDrawing.value = !mosaicDrawing.value;
  mosaicDrawStart.value = null;
  mosaicMove.value = null;
}
function updateMosaicRegion(axis: keyof MosaicRegion, event: Event) {
  const index = activeMosaicIndex.value;
  const value = Number((event.target as HTMLInputElement).value);
  if (index < 0 || !Number.isInteger(value)) return;
  mosaicRegions.value = mosaicRegions.value.map((region, regionIndex) => regionIndex === index ? { ...region, [axis]: Math.max(axis === 'width' || axis === 'height' ? 1 : 0, value) } : region);
}
function removeMosaicRegion() {
  const index = activeMosaicIndex.value;
  if (index < 0) return;
  mosaicRegions.value = mosaicRegions.value.filter((_region, regionIndex) => regionIndex !== index);
  activeMosaicIndex.value = Math.min(index, mosaicRegions.value.length - 1);
}
function previewMosaicPosition(event: PointerEvent) {
  const source = event.currentTarget as HTMLElement;
  const element = source.closest<HTMLElement>(".map-layout") || source;
  const bounds = previewBounds.value;
  if (!bounds) return null;
  const rect = element.getBoundingClientRect();
  const offset = 128 * previewZoom.value + 4;
  return {
    x: Math.max(0, Math.min(bounds.width * 128 - 1, Math.floor((event.clientX - rect.left - offset) / previewZoom.value))),
    y: Math.max(0, Math.min(bounds.height * 128 - 1, Math.floor((event.clientY - rect.top - offset) / previewZoom.value))),
  };
}
function startMosaicDraw(event: PointerEvent) {
  if (!mosaicDrawing.value) return;
  const start = previewMosaicPosition(event);
  if (!start) return;
  mosaicDrawStart.value = start;
  mosaicRegions.value = [...mosaicRegions.value, { ...start, width: 1, height: 1 }];
  activeMosaicIndex.value = mosaicRegions.value.length - 1;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function moveMosaicDraw(event: PointerEvent) {
  const start = mosaicDrawStart.value;
  const index = activeMosaicIndex.value;
  const point = previewMosaicPosition(event);
  if (!start || index < 0 || !point) return;
  const x = Math.min(start.x, point.x), y = Math.min(start.y, point.y);
  mosaicRegions.value = mosaicRegions.value.map((region, regionIndex) => regionIndex === index ? { ...region, x, y, width: Math.abs(point.x - start.x) + 1, height: Math.abs(point.y - start.y) + 1 } : region);
}
function finishMosaicDraw(event: PointerEvent) {
  if (!mosaicDrawStart.value) return;
  mosaicDrawStart.value = null;
  if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
}
function startMosaicMove(event: PointerEvent, index: number) {
  if (mosaicDrawing.value) return;
  const point = previewMosaicPosition(event);
  const region = mosaicRegions.value[index];
  if (!point || !region) return;
  event.preventDefault();
  event.stopPropagation();
  activeMosaicIndex.value = index;
  mosaicMove.value = { index, pointerX: point.x, pointerY: point.y, x: region.x, y: region.y };
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}
function moveMosaicRegion(event: PointerEvent) {
  const move = mosaicMove.value;
  const point = previewMosaicPosition(event);
  const bounds = previewBounds.value;
  if (!move || !point || !bounds) return;
  const region = mosaicRegions.value[move.index];
  if (!region) return;
  const maxX = bounds.width * 128 - region.width;
  const maxY = bounds.height * 128 - region.height;
  const x = Math.max(0, Math.min(maxX, move.x + point.x - move.pointerX));
  const y = Math.max(0, Math.min(maxY, move.y + point.y - move.pointerY));
  mosaicRegions.value = mosaicRegions.value.map((item, itemIndex) => itemIndex === move.index ? { ...item, x, y } : item);
}
function finishMosaicMove(event: PointerEvent) {
  if (!mosaicMove.value) return;
  mosaicMove.value = null;
  if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
}
function mosaicStyle(region: MosaicRegion) {
  const bounds = previewBounds.value;
  if (!bounds) return {} as Record<string, string>;
  const offset = 128 * previewZoom.value + 4;
  return { left: `${offset + region.x * previewZoom.value}px`, top: `${offset + region.y * previewZoom.value}px`, width: `${region.width * previewZoom.value}px`, height: `${region.height * previewZoom.value}px` };
}
function tileMosaicRegions(map: ScanMap & { x: number; y: number }) {
  const bounds = previewBounds.value;
  if (!bounds) return [];
  const tileX = (map.x - bounds.minX) * 128;
  const tileY = (map.y - bounds.minY) * 128;
  return mosaicRegions.value.flatMap((region) => {
    const left = Math.max(tileX, region.x), top = Math.max(tileY, region.y);
    const right = Math.min(tileX + 128, region.x + region.width), bottom = Math.min(tileY + 128, region.y + region.height);
    return right > left && bottom > top ? [{ x: left - tileX, y: top - tileY, width: right - left, height: bottom - top }] : [];
  });
}
function closeResults() {
  resultOpen.value = false;
}
function openCreationMetadata() {
  creationMetadataOpen.value = true;
}
function reopenResults() {
  if (maps.value.length) resultOpen.value = true;
}

function removeFromResults(map: ScanMap) {
  maps.value = maps.value.filter((item) => item.key !== map.key);
  const next = { ...selected.value };
  const edited = { ...editedMapKeys.value };
  delete next[map.key];
  delete edited[map.key];
  selected.value = next;
  editedMapKeys.value = edited;
  if (selectedKey.value === map.key)
    selectedKey.value = selectedList.value[0]?.key || "";
  if (!maps.value.length) {
    resultOpen.value = false;
    scanId.value = "";
  }
}
function removeGroupFromResults(group: ScanMap[]) {
  const keys = new Set(group.map((map) => map.key));
  maps.value = maps.value.filter((map) => !keys.has(map.key));
  const next = { ...selected.value }, edited = { ...editedMapKeys.value };
  for (const key of keys) { delete next[key]; delete edited[key]; }
  selected.value = next;
  editedMapKeys.value = edited;
  if (keys.has(selectedKey.value)) selectedKey.value = selectedList.value[0]?.key || "";
  if (!maps.value.length) { resultOpen.value = false; scanId.value = ""; }
}

function dragStart(event: DragEvent, key: string) {
  draggingKey.value = key;
  event.dataTransfer?.setData("text/plain", key);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function dropOn(key: string) {
  const source = draggingKey.value;
  draggingKey.value = "";
  if (
    !source ||
    source === key ||
    !selected.value[source] ||
    !selected.value[key]
  )
    return;
  const next = {
    ...selected.value,
    [source]: { ...selected.value[key]! },
    [key]: { ...selected.value[source]! },
  };
  selected.value = next;
  selectedKey.value = source;
}

function previewStyle(map: ScanMap & { x: number; y: number }) {
  const bounds = previewBounds.value;
  if (!bounds) return {};
  return {
    gridColumn: String(map.x - bounds.minX + 2),
    gridRow: String(map.y - bounds.minY + 2),
  };
}

function dropInPreview(event: DragEvent) {
  const source = draggingKey.value;
  const bounds = previewBounds.value;
  const layout = event.currentTarget as HTMLElement;
  draggingKey.value = "";
  if (!source || !bounds || !selected.value[source]) return;
  const rect = layout.getBoundingClientRect();
  const cell = 128 * previewZoom.value + 2;
  const column = Math.max(
    0,
    Math.min(bounds.width + 1, Math.floor((event.clientX - rect.left) / cell)),
  );
  const row = Math.max(
    0,
    Math.min(bounds.height + 1, Math.floor((event.clientY - rect.top) / cell)),
  );
  const next = { x: bounds.minX + column - 1, y: bounds.minY + row - 1 };
  const occupying = Object.entries(selected.value).find(
    ([key, position]) =>
      key !== source && position.x === next.x && position.y === next.y,
  );
  if (occupying) {
    const previous = selected.value[source]!;
    selected.value = {
      ...selected.value,
      [source]: { ...selected.value[occupying[0]]! },
      [occupying[0]]: { ...previous },
    };
  } else {
    selected.value = {
      ...selected.value,
      [source]: { ...selected.value[source]!, ...next },
    };
  }
  selectedKey.value = source;
}

function sortMapsByProximity(items: ScanMap[]) {
  const remaining = [...items].sort(
    (left, right) =>
      left.frame.x - right.frame.x ||
      left.frame.y - right.frame.y ||
      left.frame.z - right.frame.z ||
      left.map_id - right.map_id,
  );
  const ordered: ScanMap[] = [];
  let current = remaining.shift();
  while (current) {
    ordered.push(current);
    if (!remaining.length) break;
    let nearestIndex = 0;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index]!;
      const dx = current.frame.x - candidate.frame.x;
      const dy = current.frame.y - candidate.frame.y;
      const dz = current.frame.z - candidate.frame.z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    current = remaining.splice(nearestIndex, 1)[0];
  }
  return ordered;
}

function openLandmarkDialog() {
  landmarkDialogOpen.value = true;
  landmarkError.value = "";
  if (scanMode.value === "pw" && !landmarks.value.length) void searchLandmarks();
}

async function searchLandmarks() {
  landmarkLoading.value = true;
  landmarkError.value = "";
  try {
    const query = new URLSearchParams({
      page: "1",
      limit: "20",
      sort_by: "visits",
      sort_order: "desc",
    });
    if (pw.value.trim()) query.set("keyword", pw.value.trim());
    const result = await get<{ landmarks: Landmark[] }>(
      `/api/landmarks?${query}`,
    );
    landmarks.value = result.landmarks;
  } catch (requestError) {
    landmarkError.value =
      requestError instanceof Error ? requestError.message : "地标查询失败";
  } finally {
    landmarkLoading.value = false;
  }
}

function chooseLandmark(landmark: Landmark) {
  pw.value = landmark.name;
}

function changeMapCoordinate(axis: "x" | "y" | "z", amount: number) {
  const value = mapCoordinateSearch.value[axis];
  mapCoordinateSearch.value = {
    ...mapCoordinateSearch.value,
    [axis]: String((value === "" ? 0 : Number(value)) + amount),
  };
}

function openPlayerSearch() {
  playerSearchInput.value = author.value;
  playerSearchResults.value = [];
  playerSearchError.value = "";
  playerSearchPage.value = 1;
  playerSearchTotalPages.value = 1;
  playerSearchOpen.value = true;
}

async function searchPlayerNames(nextPage = 1) {
  if (playerSearchLoading.value) return;
  playerSearchLoading.value = true;
  playerSearchError.value = "";
  try {
    const result = await playerNamesRequest(
      nextPage,
      10,
      playerSearchInput.value.trim(),
    );
    playerSearchResults.value = result.names;
    playerSearchPage.value = result.pagination.page;
    playerSearchTotalPages.value = result.pagination.total_pages;
    playerSearchHasPrevious.value = result.pagination.has_previous;
    playerSearchHasNext.value = result.pagination.has_next;
  } catch (requestError) {
    playerSearchResults.value = [];
    playerSearchError.value =
      requestError instanceof Error ? requestError.message : "玩家 ID 查询失败";
  } finally {
    playerSearchLoading.value = false;
  }
}

function chooseAuthor(name: string) {
  author.value = name;
  playerSearchOpen.value = false;
}

async function scan() {
  if (scanMode.value === "pw" && !pw.value.trim()) {
    error.value = "请输入 PW 地址";
    return;
  }
  if (
    maps.value.length &&
    !window.confirm("重新读取会丢弃当前未保存的地图画组合，是否继续？")
  )
    return;
  scanning.value = true;
  error.value = "";
  maps.value = [];
  selected.value = {};
  editedMapKeys.value = {};
  selectedKey.value = "";
  scanId.value = "";
  mapIdSearch.value = "";
  mapCoordinateSearch.value = { x: "", y: "", z: "" };
  mapPage.value = 1;
  try {
    const result = await post<{
      scan_id: string;
      maps: ScanMap[];
      cache_merged?: boolean;
      fresh_count?: number;
      source_pw: string;
    }>("/api/map-shares/scan", {
      mode: scanMode.value,
      pw: scanMode.value === "pw" ? pw.value.trim() : undefined,
    });
    scanId.value = result.scan_id;
    maps.value = sortMapsByProximity(result.maps);
    if (!maps.value.length) {
      error.value = "未在已加载范围内读取到完整地图画";
      return;
    }
    landmarkDialogOpen.value = false;
    resultOpen.value = true;
    if (result.cache_merged)
      alertStore.success(
        "地图画缓存已合并",
        result.fresh_count
          ? `本次读取到 ${result.fresh_count} 张新图块，并已与历史缓存去重合并。`
          : "本次未收到新图块，已返回历史缓存。",
      );
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : "扫描失败";
    alertStore.error("地图画读取失败", error.value);
  } finally {
    scanning.value = false;
  }
}

async function save() {
  const items = selectedMaps();
  if (
    !scanId.value ||
    !items.length ||
    !name.value.trim() ||
    !price.value.trim() ||
    !author.value.trim()
  ) {
    error.value = "请选择地图并填写名称、价格和作者";
    return;
  }
  const positions = new Set(items.map((item) => `${item.x},${item.y}`));
  if (positions.size !== items.length) {
    error.value = "拼图位置不能重叠";
    return;
  }
  saving.value = true;
  error.value = "";
  try {
    const canvas = mergeMapCanvases(
      items.map((item) => ({
        base64: item.pixels_base64,
        icons: item.icons,
        x: item.x,
        y: item.y,
        rotation: item.rotation,
        mirror: item.mirror,
      })),
      2,
      mosaicRegions.value,
    );
    const previewData = await new Promise<string>((resolve, reject) =>
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error("PNG 预览生成失败"));
          return;
        }
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("PNG 预览读取失败"));
        reader.readAsDataURL(blob);
      }, "image/png"),
    );
    const categories: Record<string, string> = {
      像素画: "pixel-art",
      文字: "text",
      建筑参考: "building",
      动漫: "anime",
      标志: "logo",
      其他: "other",
    };
    const visibilities: Record<string, string> = {
      公开: "public",
      不公开列出: "unlisted",
      仅自己: "private",
    };
    await post<SaveResult>("/api/map-shares", {
      scan_id: scanId.value,
      name: name.value.trim(),
      price: price.value.trim(),
      author: author.value.trim(),
      description: description.value,
      category: categories[category.value] || category.value,
      tags: tagInput.value
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      visibility: visibilities[visibility.value] || visibility.value,
      status: "published",
      maps: items.map((item) => ({
        key: item.key,
        x: item.x,
        y: item.y,
        rotation: item.rotation,
        mirror: item.mirror,
      })),
      preview_png_base64: previewData,
    });
    const count = items.length;
    editedMapKeys.value = {
      ...editedMapKeys.value,
      ...Object.fromEntries(items.map((item) => [item.key, true] as const)),
    };
    selected.value = {};
    selectedKey.value = "";
    creationMetadataOpen.value = false;
    name.value = "";
    price.value = "";
    author.value = "";
    description.value = "";
    tagInput.value = "";
    await loadArtworks();
    alertStore.success(
      "地图画已保存",
      `${count} 个图块已写入。原始图块会保留在左侧，并标记为“已编辑”。`,
    );
  } catch (requestError) {
    error.value =
      requestError instanceof Error ? requestError.message : "保存失败";
    const duplicateData =
      requestError instanceof RequestError &&
      typeof requestError.data === "object" &&
      requestError.data !== null
        ? (requestError.data as {
            duplicate?: unknown;
            existing_group_id?: unknown;
          })
        : null;
    const duplicateGroupId =
      requestError instanceof RequestError &&
      requestError.status === 409 &&
      duplicateData?.duplicate === true &&
      typeof duplicateData.existing_group_id === "string"
        ? duplicateData.existing_group_id
        : "";
    error.value = "";
    if (duplicateGroupId) {
      try {
        const result = await get<{ artwork: Artwork }>(
          `/api/map-shares/groups/${duplicateGroupId}`,
        );
        duplicateArtwork.value = result.artwork;
        duplicateOpen.value = true;
      } catch {
        alertStore.warning("地图画已存在", "相同像素内容已收录，未重复写入。");
      }
    } else if (requestError instanceof RequestError && requestError.status === 409) {
      alertStore.warning("地图画已存在", "相同像素内容已收录，未重复写入。");
    } else alertStore.error("地图画保存失败", error.value);
  } finally {
    saving.value = false;
  }
}

async function loadArtworks(nextPage = 1) {
  loadingArtworks.value = true;
  try {
    const categories: Record<string, string> = {
      像素画: "pixel-art",
      文字: "text",
      建筑参考: "building",
      动漫: "anime",
      标志: "logo",
      其他: "other",
    };
    const sorts: Record<string, string> = {
      最近更新: "newest",
      最受欢迎: "popular",
      浏览最多: "views",
    };
    const query = new URLSearchParams({
      page: String(nextPage),
      limit: "8",
      sort: sorts[archiveSort.value] || "newest",
    });
    if (keyword.value.trim())
      query.set(archiveSearchField.value, keyword.value.trim());
    if (categories[archiveCategory.value])
      query.set("category", categories[archiveCategory.value]!);
    if (archiveScope.value !== "all") query.set("scope", archiveScope.value);
    const result = await get<{
      artworks: Artwork[];
      pagination: { page: number; total: number; total_pages: number };
    }>(`/api/map-shares?${query}`);
    artworks.value = result.artworks;
    page.value = result.pagination.page;
    totalArtworks.value = result.pagination.total;
    totalPages.value = result.pagination.total_pages;
  } catch (requestError) {
    error.value =
      requestError instanceof Error
        ? requestError.message
        : "地图画列表读取失败";
  } finally {
    loadingArtworks.value = false;
  }
}

function canManage(artwork: Artwork) {
  const username = authStore.user?.username?.trim().toLocaleLowerCase();
  return (
    artwork.creator_username?.trim().toLocaleLowerCase() === username ||
    artwork.author
      .split(",")
      .some((author) => author.trim().toLocaleLowerCase() === username) ||
    ["admin", "owner"].includes(authStore.user?.role || "")
  );
}
function tagList(artwork: Artwork) {
  return Array.isArray(artwork.tags)
    ? artwork.tags
    : JSON.parse(artwork.tags || "[]");
}
function previewUrl(artwork: Artwork) {
  return `/api/map-shares-preview/${artwork.preview_file}?token=${encodeURIComponent(authStore.resourceToken || "")}`;
}
async function openDetail(artwork: Artwork) {
  try {
    const result = await get<{
      artwork: Artwork;
      tiles: any[];
      versions: any[];
    }>(`/api/map-shares/groups/${artwork.group_id}`);
    detail.value = result.artwork;
    detailTiles.value = result.tiles;
    detailVersions.value = result.versions;
    detailPreviewZoom.value = 1;
    detailPreviewMirror.value = false;
    detailOpen.value = true;
  } catch (requestError) {
    alertStore.error(
      "读取作品失败",
      requestError instanceof Error ? requestError.message : "请稍后重试",
    );
  }
}
function openMetadata() {
  if (!detail.value) return;
  metadata.value = {
    ...detail.value,
    tags: tagList(detail.value).join(","),
    status: "published",
  };
  metadataOpen.value = true;
}
async function saveMetadata() {
  if (!detail.value) return;
  try {
    await patch(`/api/map-shares/groups/${detail.value.group_id}`, {
      ...metadata.value,
      status: "published",
      tags: metadata.value.tags
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
    });
    metadataOpen.value = false;
    await openDetail(detail.value);
    await loadArtworks(page.value);
    alertStore.success("作品信息已更新");
  } catch (requestError) {
    alertStore.error(
      "更新失败",
      requestError instanceof Error ? requestError.message : "请稍后重试",
    );
  }
}
async function openLayoutEditor() {
  if (!detail.value) return;
  try {
    const result = await get<{ tiles: any[] }>(`/api/map-shares/groups/${detail.value.group_id}/layout`);
    layoutTiles.value = result.tiles;
    layoutOpen.value = true;
  } catch (requestError) {
    alertStore.error("无法打开排版编辑器", requestError instanceof Error ? requestError.message : "请稍后重试");
  }
}
async function saveLayout(tiles: Array<{ id: number; x: number; y: number; rotation: number; mirror: boolean }>, preview: string) {
  if (!detail.value) return;
  layoutSaving.value = true;
  try {
    await patch(`/api/map-shares/groups/${detail.value.group_id}/layout`, { tiles, preview_png_base64: preview });
    layoutOpen.value = false;
    await openDetail(detail.value);
    await loadArtworks(page.value);
    alertStore.success("图块排版已保存");
  } catch (requestError) {
    alertStore.error("图块排版保存失败", requestError instanceof Error ? requestError.message : "请稍后重试");
  } finally {
    layoutSaving.value = false;
  }
}
async function removeArtwork() {
  if (
    !detail.value ||
    !window.confirm(
      `删除“${detail.value.name}”？此操作会移除所有图块与预览文件。`,
    )
  )
    return;
  try {
    await del(`/api/map-shares/groups/${detail.value.group_id}`);
    detailOpen.value = false;
    await loadArtworks(page.value);
    alertStore.success("地图画已删除");
  } catch (requestError) {
    alertStore.error(
      "删除失败",
      requestError instanceof Error ? requestError.message : "请稍后重试",
    );
  }
}
async function favorite(artwork: Artwork) {
  try {
    const enabled = !artwork.liked;
    const result = await request<{ like_count: number }>(
      `/api/map-shares/groups/${artwork.group_id}/favorite`,
      { method: "PUT", body: JSON.stringify({ enabled }) },
    );
    artwork.liked = enabled ? 1 : 0;
    artwork.like_count = result.like_count;
    if (detail.value?.group_id === artwork.group_id) {
      detail.value.liked = artwork.liked;
      detail.value.like_count = result.like_count;
    }
  } catch (requestError) {
    alertStore.error(
      "收藏失败",
      requestError instanceof Error ? requestError.message : "请稍后重试",
    );
  }
}
async function reportArtwork() {
  if (!detail.value || !reportReason.value.trim()) return;
  try {
    await post(`/api/map-shares/groups/${detail.value.group_id}/reports`, {
      reason: reportReason.value.trim(),
    });
    reportReason.value = "";
    alertStore.success("举报已提交");
  } catch (requestError) {
    alertStore.error(
      "举报失败",
      requestError instanceof Error ? requestError.message : "请稍后重试",
    );
  }
}
async function restoreVersion(revision: number) {
  if (!detail.value || !window.confirm(`恢复至 r${revision}？`)) return;
  try {
    await post(
      `/api/map-shares/groups/${detail.value.group_id}/versions/${revision}/restore`,
      {},
    );
    await openDetail(detail.value);
    await loadArtworks(page.value);
    alertStore.success("已恢复历史版本");
  } catch (requestError) {
    alertStore.error(
      "恢复失败",
      requestError instanceof Error ? requestError.message : "请稍后重试",
    );
  }
}
function exportArtwork() {
  if (detail.value)
    void download(
      `/api/map-shares/groups/${detail.value.group_id}/export`,
      `map-artwork-${detail.value.group_id}.json`,
    ).catch((requestError) =>
      alertStore.error(
        "导出失败",
        requestError instanceof Error ? requestError.message : "请稍后重试",
      ),
    );
}
function downloadPreviewPng() {
  if (!detail.value) return;
  const filename = `${detail.value.name.trim() || "map-artwork"}.png`;
  void download(previewUrl(detail.value), filename).catch((requestError) =>
    alertStore.error(
      "PNG 下载失败",
      requestError instanceof Error ? requestError.message : "请稍后重试",
    ),
  );
}

function closeNavOutside(event: MouseEvent) {
  if (navShell.value && !navShell.value.contains(event.target as Node))
    navOpen.value = false;
}
watch(
  [mapFilterMode, mapIdSearch, mapCoordinateSearch, automaticGrouping],
  () => {
    mapPage.value = 1;
  },
  { deep: true },
);
watch(mapTotalPages, (total) => {
  if (mapPage.value > total) mapPage.value = total;
});
onMounted(() => {
  loadActiveShareModule();
  document.addEventListener("mousedown", closeNavOutside);
  window.addEventListener("hashchange", loadActiveShareModule);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", closeNavOutside),
  window.removeEventListener("hashchange", loadActiveShareModule);
});
</script>

<template>
  <main class="shares-page">
    <div
      ref="navShell"
      :class="{ 'is-open': navOpen }"
      class="shares-nav-shell"
    >
      <aside aria-label="玩家分享导航" class="shares-nav">
        <button
          :aria-expanded="navOpen"
          aria-label="打开玩家分享导航"
          class="shares-nav-toggle"
          type="button"
          @click="navOpen = !navOpen"
        >
          <span aria-hidden="true">{{ navOpen ? "‹" : "›" }}</span></button
        ><button
          :class="{ active: activeShareModule === 'maps' }"
          class="shares-nav-item"
          type="button"
          @click="selectShareModule('maps')"
          ><span aria-hidden="true" class="shares-nav-icon">▣</span
          ><span class="shares-nav-label">地图画分享</span></button
        ><button
          :class="{ active: activeShareModule === 'docs' }"
          class="shares-nav-item"
          type="button"
          @click="selectShareModule('docs')"
          ><span aria-hidden="true" class="shares-nav-icon">&lt;/&gt;</span
          ><span class="shares-nav-label">网页文档</span></button
        >
      </aside>
    </div>
    <section v-if="activeShareModule === 'maps'" class="share-panel">
      <header class="share-toolbar">
        <div class="share-summary">
          <span class="share-mark" aria-hidden="true">▣</span>
          <div>
            <strong>已收录地图画</strong
            ><small>{{
              loadingArtworks
                ? "正在读取存档"
                : `当前 ${totalArtworks} 个作品`
            }}</small>
          </div>
        </div>
        <form class="archive-search" @submit.prevent="loadArtworks(1)">
          <BaseSelect
            v-model="archiveSearchField"
            class="archive-search-field"
            :options="[
              { label: '名称', value: 'name' },
              { label: '作者', value: 'author' },
              { label: '说明', value: 'description' },
              { label: '标签', value: 'tags' },
              { label: '来源 PW', value: 'source_pw' },
            ]"
            aria-label="搜索字段"
          /><label
            ><span class="sr-only">搜索地图画</span
            ><svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" /></svg
            ><input
              v-model="keyword"
              autocomplete="off"
              :placeholder="`搜索${{ name: '名称', author: '作者', description: '说明', tags: '标签', source_pw: '来源 PW' }[archiveSearchField]}`" /></label
          ><button type="submit">查询</button>
        </form>
        <button class="scan-button" type="button" @click="openLandmarkDialog">
          {{ maps.length ? "重新读取" : "读取地图画" }}</button
        ><button
          v-if="maps.length"
          class="resume-button"
          type="button"
          @click="reopenResults"
        >
          继续处理 {{ maps.length }}</button
        ><BaseTooltip placement="bottom" text="刷新地图画档案"><button
          class="refresh-button"
          :class="{ syncing: loadingArtworks }"
          :disabled="loadingArtworks"
          type="button"
          aria-label="刷新地图画档案"
          @click="loadArtworks(page)"
        >
          <svg viewBox="0 0 24 24">
            <path d="M21 12a9 9 0 0 0-15-6.7L3 8" />
            <path d="M3 3v5h5" />
            <path d="M3 12a9 9 0 0 0 15 6.7L21 16" />
            <path d="M16 16h5v5" />
          </svg>
        </button></BaseTooltip>
        <div class="archive-controls">
          <BaseSelect
            v-model="archiveCategory"
            class="archive-select"
            :options="[
              '全部分类',
              '像素画',
              '文字',
              '建筑参考',
              '动漫',
              '标志',
              '其他',
            ]"
            aria-label="分类"
            @update:model-value="loadArtworks(1)"
          /><BaseSelect
            v-model="archiveSort"
            class="archive-select"
            :options="['最近更新', '最受欢迎', '浏览最多']"
            aria-label="排序"
            @update:model-value="loadArtworks(1)"
          /><div class="archive-scope" role="group" aria-label="地图画范围">
            <button
              v-for="scope in [
                { value: 'all', label: '全部' },
                { value: 'favorites', label: '我的收藏' },
                { value: 'added', label: '我添加的' },
                { value: 'created', label: '我制作的' },
              ]"
              :key="scope.value"
              :class="{ active: archiveScope === scope.value }"
              type="button"
              @click="archiveScope = scope.value as typeof archiveScope; loadArtworks(1)"
            >
              {{ scope.label }}
            </button>
          </div>
        </div>
      </header>
      <p v-if="error" class="share-error">{{ error }}</p>
      <section class="archive-section">
        <div v-if="loadingArtworks" class="archive-state">
          <span class="mini-spinner" /><strong>正在读取地图画档案</strong>
        </div>
        <div v-else-if="!artworks.length" class="archive-state">
          <span class="state-code">NO ARCHIVE</span
          ><strong>暂无已收录地图画</strong
          ><small>完成一次读取并保存后，地图画会出现在这里。</small>
        </div>
        <div v-else class="artwork-grid">
          <article
            v-for="artwork in artworks"
            :key="artwork.group_id"
            class="artwork-card"
          >
            <button
              class="artwork-open"
              type="button"
              @click="openDetail(artwork)"
            >
              <img :src="previewUrl(artwork)" alt="地图画预览" />
            </button>
            <div class="artwork-info">
              <header>
                <h3>{{ artwork.name }}</h3>
                <code>{{ artwork.status }}</code>
              </header>
              <dl>
                <div>
                  <dt>作者</dt>
                  <dd>{{ artwork.author }}</dd>
                </div>
                <div>
                  <dt>价格</dt>
                  <dd>{{ artwork.price }}</dd>
                </div>
                <div class="wide">
                  <dt>分类</dt>
                  <dd>
                    {{ artwork.category }} ·
                    {{ tagList(artwork).join(" · ") || "无标签" }}
                  </dd>
                </div>
              </dl>
              <footer>
                <span
                  >{{ artwork.like_count }} 收藏 ·
                  {{ artwork.view_count }} 浏览</span
                ><button type="button" @click="favorite(artwork)">
                  {{ artwork.liked ? "已收藏" : "收藏" }}</button
                ><button type="button" @click="openDetail(artwork)">
                  详情
                </button>
              </footer>
            </div>
          </article>
        </div>
        <footer v-if="totalPages > 1" class="archive-pagination">
          <span>第 {{ page }} / {{ totalPages }} 页</span>
          <div>
            <button
              :disabled="page <= 1"
              type="button"
              @click="loadArtworks(page - 1)"
            >
              ←</button
            ><button
              :disabled="page >= totalPages"
              type="button"
              @click="loadArtworks(page + 1)"
            >
              →
            </button>
          </div>
        </footer>
      </section>
    </section>
    <WebDocs v-else />

    <BaseDialog
      :open="landmarkDialogOpen"
      :dismissible="!scanning"
      title="读取地图画"
      @close="!scanning && (landmarkDialogOpen = false)"
    >
      <form class="landmark-dialog" @submit.prevent="scan">
        <div class="scan-mode" role="group" aria-label="扫描方式">
          <button :class="{ active: scanMode === 'pw' }" :disabled="scanning" type="button" @click="scanMode = 'pw'">PW 扫描</button>
          <button :class="{ active: scanMode === 'teleport' }" :disabled="scanning" type="button" @click="scanMode = 'teleport'">传送扫描</button>
        </div>
        <label v-if="scanMode === 'pw'"
          >PW 地标名称<span class="landmark-input-row"
            ><input
              v-model="pw"
              :disabled="scanning"
              maxlength="128"
              autocomplete="off"
              placeholder="输入地标名称后查询"
              @keydown.enter.prevent="searchLandmarks"
            /><button
              :disabled="scanning || landmarkLoading"
              type="button"
              @click="searchLandmarks"
            >
              {{ landmarkLoading ? "查询中..." : "查询地标" }}
            </button></span
          ></label
        >
        <div v-else class="teleport-scan-state">
          <strong>{{ scanning ? "正在等待传送请求" : "等待玩家发起传送请求" }}</strong>
          <small>开始后请让目标位置的玩家向 Bot 发起传送请求。收到请求将自动接受并扫描，20 秒内未收到请求会超时。</small>
        </div>
        <p v-if="scanMode === 'pw' && landmarkError" class="landmark-error">{{ landmarkError }}</p>
        <div v-if="scanMode === 'pw'" class="landmark-results">
          <button
            v-for="landmark in landmarks"
            :key="landmark.id"
            :class="{ selected: pw === landmark.name }"
            :disabled="scanning"
            type="button"
            @click="chooseLandmark(landmark)"
          >
            <span
              ><strong>{{ landmark.name }}</strong
              ><small
                >{{ landmark.owner || "未知主人" }} ·
                {{ landmark.visits.toLocaleString() }} 次访问</small
              ></span
            ><em>{{ landmark.description || "无描述" }}</em>
          </button>
          <p v-if="!landmarkLoading && !landmarks.length">
            未找到可选地标，可直接输入完整 PW 地标名。
          </p>
        </div>
        <div class="landmark-dialog-actions">
          <button
            v-if="!scanning"
            type="button"
            @click="landmarkDialogOpen = false"
          >
            取消</button
          ><button :disabled="scanning || (scanMode === 'pw' && !pw.trim())" type="submit">
            {{ scanning ? (scanMode === "teleport" ? "等待请求并读取中..." : "正在读取地图画，请勿关闭...") : "开始读取地图画" }}
          </button>
        </div>
      </form>
    </BaseDialog>

    <BaseDialog
      :open="resultOpen"
      size="large"
      title="地图画读取结果"
      @close="closeResults"
    >
      <div class="result-dialog">
        <header class="result-summary">
          <div>
            <strong>{{ pw || "未指定 PW" }}</strong
            ><span
              >{{ maps.length }} 张有效地图 · {{ selectedList.length }} 张已选择
              · 已按展示框坐标排序</span
            >
          </div>
          <span v-if="gridSize" class="grid-size"
            >组合范围 {{ gridSize.width }} × {{ gridSize.height }}</span
          >
        </header>
        <div class="result-workspace">
          <section class="result-index">
            <header>
              <div class="result-filter-bar">
                <label class="map-filter-mode"
                  ><span>筛选</span
                  ><BaseSelect
                    v-model="mapFilterMode"
                    :options="mapFilterModeOptions"
                    aria-label="地图筛选方式"
                    placement="bottom" /></label
                ><label v-if="mapFilterMode === '地图 ID'" class="map-filter"
                  ><svg viewBox="0 0 24 24">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.3-4.3" /></svg
                  ><input
                    v-model="mapIdSearch"
                    inputmode="numeric"
                    placeholder="搜索地图 ID"
                /></label>
                <div v-else class="coordinate-filter">
                  <label v-for="axis in ['x', 'y', 'z'] as const" :key="axis"
                    ><span>{{ axis.toUpperCase() }}</span
                    ><button
                      type="button"
                      :aria-label="`${axis} 减一`"
                      @click="changeMapCoordinate(axis, -1)"
                    >
                      −</button
                    ><input
                      v-model="mapCoordinateSearch[axis]"
                      inputmode="numeric"
                      type="number"
                      :aria-label="`${axis} 坐标`"
                    /><button
                      type="button"
                      :aria-label="`${axis} 加一`"
                      @click="changeMapCoordinate(axis, 1)"
                    >
                      +
                    </button></label
                  >
                </div>
                <BaseCheckbox
                  v-model="automaticGrouping"
                  class="group-toggle"
                  label="自动分组"
                />
              </div>
              <div class="index-actions">
                <BaseTooltip placement="top" text="全选筛选结果"><button
                  class="tool-icon select-all"
                  type="button"
                  aria-label="全选筛选结果"
                  @click="selectAll"
                >
                  ✓</button></BaseTooltip
                ><BaseTooltip placement="top" text="按展示框坐标自动排列已选图块"><button
                  class="tool-icon auto-layout"
                  type="button"
                  :disabled="!selectedList.length"
                  aria-label="按展示框坐标自动排列已选图块"
                  @click="autoArrange"
                >
                  <span aria-hidden="true">⌘</span>自动排版</button></BaseTooltip
                ><BaseSelect
                  v-model="artworkOrder"
                  class="tile-order"
                  :options="artworkOrderOptions"
                  aria-label="按展示框坐标排序"
                  @update:model-value="applyArtworkOrder"
                /><BaseTooltip placement="top" text="清空选择"><button
                  class="tool-icon clear-all"
                  type="button"
                  :disabled="!selectedList.length"
                  aria-label="清空选择"
                  @click="clearSelected"
                >
                  ×
                </button></BaseTooltip>
              </div>
              <div class="index-zoom">
                <span>缩略图</span
                ><button
                  type="button"
                  :disabled="indexZoom <= 0.75"
                  @click="indexZoom = Math.max(0.75, indexZoom - 0.25)"
                >
                  −</button
                ><button
                  type="button"
                  :disabled="indexZoom >= 1.75"
                  @click="indexZoom = Math.min(1.75, indexZoom + 0.25)"
                >
                  +
                </button>
              </div>
            </header>
            <div class="map-list" :style="{ '--index-scale': indexZoom }">
              <section
                v-for="(group, groupIndex) in visibleGroups"
                :key="group.key"
                class="map-group"
              >
                <header v-if="automaticGrouping">
                  <span
                    >连续组
                    {{ mapGroups.findIndex((item) => item.key === group.key) + 1 }}</span
                  ><small>{{ group.maps.length }} 张</small
                  ><button
                    type="button"
                    @click="toggleGroup(group.maps)"
                  >
                    {{ groupActionLabel(group.maps) }}
                  </button><BaseTooltip placement="top" text="从本次读取结果移除整组"><button
                    class="group-remove"
                    type="button"
                    aria-label="从本次读取结果移除整组"
                    @click="removeGroupFromResults(group.maps)"
                  >
                    ×
                  </button></BaseTooltip>
                </header>
                <article
                  v-for="map in group.maps"
                  :key="map.key"
                  :class="{
                    selected: selected[map.key],
                    active: selectedKey === map.key,
                    edited: editedMapKeys[map.key],
                  }"
                  class="map-item"
                >
                  <button
                    class="map-select"
                    type="button"
                    @click="toggle(map)"
                  >
                    <canvas v-map-canvas="{ map, mosaic: false, regions: [] }" /><span
                      ><strong>#{{ map.map_id }}</strong
                      ><small
                        >{{ map.frame.x }}, {{ map.frame.y }},
                        {{ map.frame.z }}</small
                       ></span
                    ><em v-if="map.exists" class="map-existing">已存在</em
                    ><i>{{ selected[map.key] ? "✓" : editedMapKeys[map.key] ? "已编辑" : "+" }}</i></button
                   ><BaseTooltip placement="top" text="从本次读取结果移除"><button
                    class="map-remove"
                    type="button"
                    aria-label="从本次读取结果移除"
                    @click="removeFromResults(map)"
                  >
                    ×
                  </button></BaseTooltip>
                </article>
              </section>
            </div>
            <footer class="map-pagination">
              <span
                >{{ filteredMaps.length }} 张{{
                  automaticGrouping ? ` · ${mapGroups.length} 组` : ""
                }}</span
              >
              <div>
                <button
                  :disabled="mapPage <= 1"
                  type="button"
                  @click="mapPage--"
                >
                  ←</button
                ><b>{{ mapPage }} / {{ mapTotalPages }}</b
                ><button
                  :disabled="mapPage >= mapTotalPages"
                  type="button"
                  @click="mapPage++"
                >
                  →
                </button>
              </div>
            </footer>
          </section>
          <section class="result-preview">
            <header>
              <span>组合预览</span>
              <div class="preview-tools">
                <small>{{
                  selectedList.length
                    ? "拖动图块可交换位置"
                    : "从左侧选择地图图块"
                }}</small
                ><BaseTooltip placement="top" :text="mosaicDrawing ? '取消框选马赛克' : '框选局部马赛克'"><button
                  :class="{ active: mosaicDrawing }"
                  type="button"
                  :aria-label="mosaicDrawing ? '取消框选马赛克' : '框选局部马赛克'"
                  :disabled="!selectedList.length"
                  @click.stop="addMosaicRegion"
                >
                  ▦</button></BaseTooltip
                ><button
                  type="button"
                  :disabled="previewZoom <= 0.5"
                  @click="previewZoom = Math.max(0.5, previewZoom - 0.25)"
                >
                  −</button
                ><b>{{ Math.round(previewZoom * 100) }}%</b
                ><button
                  type="button"
                  :disabled="previewZoom >= 2"
                  @click="previewZoom = Math.min(2, previewZoom + 0.25)"
                >
                  +
                </button>
              </div>
            </header>
            <div class="dialog-preview">
              <div v-if="!selectedList.length" class="preview-empty">
                <span>▦</span><strong>尚未选择地图画</strong
                ><small>选择图块后会在这里实时合并预览。</small>
              </div>
              <div
                v-else-if="previewBounds"
                class="map-layout"
                  :style="previewGridStyle"
                  :class="{ 'mosaic-drawing': mosaicDrawing }"
                  @dragover.prevent
                  @drop.prevent="dropInPreview"
                  @pointerdown="startMosaicDraw"
                  @pointermove="moveMosaicDraw"
                  @pointerup="finishMosaicDraw"
                  @pointercancel="finishMosaicDraw"
              >
                <button
                  v-for="map in selectedList"
                  :key="map.key"
                  :class="{
                    active: selectedKey === map.key,
                    dragging: draggingKey === map.key,
                  }"
                  :style="previewStyle(map)"
                  class="layout-tile"
                  draggable="true"
                  type="button"
                  @click="selectedKey = map.key"
                  @dragstart="dragStart($event, map.key)"
                  @dragend="draggingKey = ''"
                >
                  <canvas
                    v-map-canvas="{ map, mosaic: false, regions: tileMosaicRegions(map) }"
                    :style="{
                      width: `${128 * previewZoom}px`,
                      height: `${128 * previewZoom}px`,
                      transform: `rotate(${map.rotation}deg) scaleX(${map.mirror ? -1 : 1})`,
                    }"
                  /><span>{{ map.x }}, {{ map.y }} · {{ map.rotation }}°</span>
                </button>
                <BaseTooltip v-for="(region, index) in mosaicRegions" :key="`mosaic-tooltip-${index}`" trigger-class="mosaic-region-wrap" :trigger-style="mosaicStyle(region)" placement="top" :text="`马赛克区域 ${index + 1}`"><button
                  :key="`mosaic-${index}`"
                  :class="{ active: activeMosaicIndex === index }"
                  class="mosaic-region"
                  type="button"
                  @pointerdown="startMosaicMove($event, index)"
                  @pointermove="moveMosaicRegion"
                  @pointerup="finishMosaicMove"
                  @pointercancel="finishMosaicMove"
                  @click.stop="activeMosaicIndex = index"
                >
                  马赛克 {{ index + 1 }}
                </button></BaseTooltip>
              </div>
            </div>
            <div class="preview-command-panel">
              <div v-if="activeMosaic" class="mosaic-quick-editor">
                <span>马赛克区域</span>
                <label>X<input :value="activeMosaic.x" min="0" type="number" @change="updateMosaicRegion('x', $event)" /></label>
                <label>Y<input :value="activeMosaic.y" min="0" type="number" @change="updateMosaicRegion('y', $event)" /></label>
                <label>宽<input :value="activeMosaic.width" min="1" type="number" @change="updateMosaicRegion('width', $event)" /></label>
                <label>高<input :value="activeMosaic.height" min="1" type="number" @change="updateMosaicRegion('height', $event)" /></label>
                <BaseTooltip placement="top" text="删除马赛克区域"><button type="button" aria-label="删除马赛克区域" @click="removeMosaicRegion">×</button></BaseTooltip>
              </div>
              <div
                v-if="activeMap && selected[activeMap.key]"
                class="tile-quick-editor"
              >
                <span>图块 #{{ activeMap.map_id }}</span>
                <label
                  >X<input
                    :value="positionFor(activeMap.key).x"
                    type="number"
                    @change="setPosition(activeMap.key, 'x', $event)"
                /></label>
                <label
                  >Y<input
                    :value="positionFor(activeMap.key).y"
                    type="number"
                    @change="setPosition(activeMap.key, 'y', $event)"
                /></label>
                <BaseTooltip placement="top" text="左转 90 度"><button
                  type="button"
                  aria-label="左转 90 度"
                  @click="rotateSelected(-90)"
                >
                  ↶
                </button></BaseTooltip>
                <BaseTooltip placement="top" text="右转 90 度"><button
                  type="button"
                  aria-label="右转 90 度"
                  @click="rotateSelected(90)"
                >
                  ↷
                </button></BaseTooltip>
                <BaseTooltip placement="top" :text="positionFor(activeMap.key).mirror ? '取消水平镜像' : '水平镜像'"><button
                  :class="{ active: positionFor(activeMap.key).mirror }"
                  type="button"
                  :aria-label="positionFor(activeMap.key).mirror ? '取消水平镜像' : '水平镜像'"
                  @click="mirrorSelected"
                >
                  ↔
                </button></BaseTooltip>
                <BaseTooltip placement="top" text="从组合中移除"><button
                  class="tile-remove"
                  type="button"
                  aria-label="从组合中移除"
                  @click="toggle(activeMap)"
                >
                  ×
                </button></BaseTooltip>
                <button
                  class="tile-metadata"
                  type="button"
                  @click="openCreationMetadata"
                >
                  编辑信息
                </button>
              </div>
              <button
                v-else
                class="edit-creation-metadata"
                type="button"
                @click="openCreationMetadata"
              >
                编辑信息
              </button>
            </div>
          </section>
        </div>
        <footer class="result-actions">
          <span>{{
              selectedList.length
                ? `${selectedList.length} 个图块待暂存 · ${editedMapCount} 个图块已编辑`
              : "请选择至少一个地图图块"
          }}</span>
          <div>
            <button type="button" @click="closeResults">稍后处理</button
            ><button
              :disabled="saving || !selectedList.length"
              type="button"
              @click="save"
            >
              {{
                saving
                  ? "正在暂存..."
                  : "暂存组合"
              }}
            </button>
          </div>
        </footer>
      </div>
    </BaseDialog>

    <BaseDialog
      :open="duplicateOpen"
      title="发现相同地图画"
      @close="duplicateOpen = false"
    >
      <section v-if="duplicateArtwork" class="duplicate-artwork-dialog">
        <div class="duplicate-preview">
          <img
            :src="previewUrl(duplicateArtwork)"
            :alt="duplicateArtwork.name"
          />
        </div>
        <div class="duplicate-copy">
          <span>已有作品</span><h3>{{ duplicateArtwork.name }}</h3>
          <p>当前组合生成的完整 PNG 与以下作品一致，因此未再次添加。</p>
          <dl>
            <div><dt>作者</dt><dd>{{ duplicateArtwork.author }}</dd></div>
            <div><dt>添加者</dt><dd>{{ duplicateArtwork.creator_username }}</dd></div>
            <div><dt>分类</dt><dd>{{ duplicateArtwork.category }}</dd></div>
            <div><dt>可见性</dt><dd>{{ duplicateArtwork.visibility }}</dd></div>
            <div class="wide"><dt>标签</dt><dd>{{ tagList(duplicateArtwork).join(" · ") || "暂无标签" }}</dd></div>
          </dl>
          <footer>
            <button type="button" @click="duplicateOpen = false">返回组合</button>
            <button
              class="duplicate-primary"
              type="button"
              @click="duplicateOpen = false; openDetail(duplicateArtwork!)"
            >
              查看已有作品
            </button>
          </footer>
        </div>
      </section>
    </BaseDialog>

    <BaseDialog
      :open="creationMetadataOpen"
      size="wide"
      title="编辑地图画信息"
      @close="creationMetadataOpen = false"
    >
      <form class="creation-metadata-form" @submit.prevent="creationMetadataOpen = false">
        <div class="creation-metadata-heading">
          <strong>发布信息</strong
          ><small>暂存组合前可随时修改，信息会应用到下一次暂存。</small>
        </div>
        <label
          >地图画名称<input v-model="name" maxlength="128" required /></label
        ><label>价格<input v-model="price" maxlength="64" required /></label
        ><label class="creation-author"
          >作者<span class="author-input"
            ><input
              v-model="author"
              maxlength="256"
              placeholder="多个 ID 用逗号分隔"
              required
            /><button
              type="button"
              aria-label="查询玩家 ID"
              title="查询玩家 ID"
              @click="openPlayerSearch"
            >
              ⌕
            </button></span
          ></label
        ><label
          >分类<BaseSelect
            v-model="category"
            :options="[
              { label: '像素画', value: 'pixel-art' },
              { label: '文字', value: 'text' },
              { label: '建筑参考', value: 'building' },
              { label: '动漫', value: 'anime' },
              { label: '标志', value: 'logo' },
              { label: '其他', value: 'other' },
            ]"
            aria-label="地图画分类"
          /></label
        ><label
          >标签<input
            v-model="tagInput"
            maxlength="249"
            placeholder="用逗号分隔" /></label
        ><label
          >可见性<BaseSelect
            v-model="visibility"
            :options="[
              { label: '公开', value: 'public' },
              { label: '不公开列出', value: 'unlisted' },
              { label: '仅自己', value: 'private' },
            ]"
            aria-label="地图画可见性"
          /></label
        ><label class="creation-description"
          ><span>说明 <small>{{ description.length }} / 1000</small></span
          ><textarea
            v-model="description"
            maxlength="1000"
            placeholder="记录作品内容、用途或制作说明"
          /></label
        ><footer>
          <button type="button" @click="creationMetadataOpen = false">
            完成
          </button>
        </footer>
      </form>
    </BaseDialog>

    <BaseDialog
      :open="playerSearchOpen"
      title="查询玩家 ID"
      @close="playerSearchOpen = false"
    >
      <form class="player-search-dialog" @submit.prevent="searchPlayerNames(1)">
        <div class="player-search-field">
          <input
            v-model="playerSearchInput"
            autocomplete="off"
            placeholder="输入完整或部分玩家 ID"
          /><button type="submit" :disabled="playerSearchLoading">
            {{ playerSearchLoading ? "…" : "⌕" }}
          </button>
        </div>
        <div class="player-search-body">
          <p v-if="playerSearchError" class="player-search-error">
            {{ playerSearchError }}
          </p>
          <p v-else-if="playerSearchLoading" class="player-search-state">
            正在查询玩家 ID...
          </p>
          <div
            v-else-if="playerSearchResults.length"
            class="player-search-results"
          >
            <button
              v-for="player in playerSearchResults"
              :key="player"
              type="button"
              @click="chooseAuthor(player)"
            >
              <strong>{{ player }}</strong
              ><span>选择</span>
            </button>
          </div>
          <p v-else class="player-search-state">输入关键词后查询玩家 ID。</p>
        </div>
        <footer>
          <span>{{ playerSearchPage }} / {{ playerSearchTotalPages }}</span>
          <div>
            <button
              type="button"
              :disabled="playerSearchLoading || !playerSearchHasPrevious"
              @click="searchPlayerNames(playerSearchPage - 1)"
            >
              ←</button
            ><button
              type="button"
              :disabled="playerSearchLoading || !playerSearchHasNext"
              @click="searchPlayerNames(playerSearchPage + 1)"
            >
              →
            </button>
          </div>
        </footer>
      </form>
    </BaseDialog>

    <BaseDialog
      :open="detailOpen"
      size="large"
      :title="detail?.name || '地图画详情'"
      @close="detailOpen = false"
    >
      <section v-if="detail" class="artwork-detail">
        <section class="detail-preview-panel">
          <div class="detail-preview-stage">
            <div class="detail-preview-zoom">
              <button type="button" :disabled="detailPreviewZoom <= 0.5" title="缩小预览" aria-label="缩小预览" @click="detailPreviewZoom = Math.max(0.5, detailPreviewZoom - 0.25)">−</button>
              <span>{{ Math.round(detailPreviewZoom * 100) }}%</span>
              <button type="button" :disabled="detailPreviewZoom >= 2" title="放大预览" aria-label="放大预览" @click="detailPreviewZoom = Math.min(2, detailPreviewZoom + 0.25)">+</button>
              <button type="button" :class="{ active: detailPreviewMirror }" :title="detailPreviewMirror ? '取消水平镜像' : '水平镜像'" :aria-label="detailPreviewMirror ? '取消水平镜像' : '水平镜像'" @click="detailPreviewMirror = !detailPreviewMirror">↔</button>
            </div>
            <img :src="previewUrl(detail)" :alt="detail.name" :style="{ width: `${detailPreviewZoom * 100}%`, transform: detailPreviewMirror ? 'scaleX(-1)' : 'none' }" />
          </div>
          <div class="detail-preview-actions">
            <button class="detail-primary" type="button" @click="downloadPreviewPng">
              下载 PNG
            </button>
            <button type="button" @click="exportArtwork">导出 JSON</button>
            <button type="button" @click="favorite(detail)">
              {{ detail.liked ? "取消收藏" : "收藏" }} {{ detail.like_count }}
            </button>
          </div>
        </section>
        <section class="artwork-detail-meta">
          <header class="detail-heading">
            <div>
              <span>地图画</span><h3>{{ detail.name }}</h3>
            </div>
            <b>{{ detail.price }}</b>
          </header>
          <dl class="detail-facts">
            <div><dt>作者</dt><dd>{{ detail.author }}</dd></div>
            <div><dt>添加者</dt><dd>{{ detail.creator_username }}</dd></div>
            <div><dt>分类</dt><dd>{{ detail.category }}</dd></div>
            <div><dt>可见性</dt><dd>{{ detail.visibility }}</dd></div>
            <div><dt>状态</dt><dd>{{ detail.status }}</dd></div>
            <div><dt>图块</dt><dd>{{ detailTiles.length }} 张</dd></div>
          </dl>
          <section class="detail-tags">
            <span>标签</span><div v-if="tagList(detail).length"><i v-for="tag in tagList(detail)" :key="tag">{{ tag }}</i></div><small v-else>暂无标签</small>
          </section>
          <section class="detail-description">
            <span>说明</span><p>{{ detail.description || "暂无说明" }}</p>
          </section>
          <dl class="detail-stats">
            <div><dt>浏览</dt><dd>{{ detail.view_count }}</dd></div>
            <div><dt>收藏</dt><dd>{{ detail.like_count }}</dd></div>
            <div><dt>来源 PW</dt><dd>{{ detail.source_pw }}</dd></div>
          </dl>
          <div v-if="canManage(detail)" class="detail-manager-actions">
            <button type="button" @click="openMetadata">编辑信息</button>
            <button type="button" @click="openLayoutEditor">重新设计排版</button>
            <button class="danger" type="button" @click="removeArtwork">删除作品</button>
          </div>
        </section>
        <section v-if="detailVersions.length || !canManage(detail)" class="detail-lower">
          <section v-if="detailVersions.length" class="versions">
            <header><strong>版本记录</strong><small>{{ detailVersions.length }} 条</small></header>
            <ol>
              <li v-for="version in detailVersions" :key="version.id">
                <span>r{{ version.revision }}</span><p>{{ version.note }} · {{ version.created_by }} · {{ new Date(version.created_at).toLocaleString() }}</p>
                <button v-if="canManage(detail)" type="button" @click="restoreVersion(version.revision)">恢复</button>
              </li>
            </ol>
          </section>
          <form class="report-form" @submit.prevent="reportArtwork">
            <label>举报作品<input v-model="reportReason" maxlength="300" placeholder="填写举报原因" /></label><button type="submit">提交举报</button>
          </form>
        </section>
      </section>
    </BaseDialog>

    <BaseDialog :open="layoutOpen" size="large" title="重新设计地图画排版" :dismissible="!layoutSaving" @close="!layoutSaving && (layoutOpen = false)">
      <MapArtworkLayoutEditor :tiles="layoutTiles" :saving="layoutSaving" @save="saveLayout" />
    </BaseDialog>

    <BaseDialog
      :open="metadataOpen"
      title="编辑地图画信息"
      @close="metadataOpen = false"
    >
      <form class="metadata-form" @submit.prevent="saveMetadata">
        <label
          >名称<input v-model="metadata.name" maxlength="128" required /></label
        ><label
          >价格<input v-model="metadata.price" maxlength="64" required /></label
        ><label
          >地图画来源<input
            v-model="metadata.source_pw"
            maxlength="128"
            placeholder="例如 /pw spawn"
            required /></label
        ><label
          >作者（多个 ID 用逗号分隔）<input
            v-model="metadata.author"
            maxlength="256"
            placeholder="例如 Alex, Steve"
            required /></label
        ><label
          >说明<textarea
            v-model="metadata.description"
            maxlength="1000"
          /></label
        ><label
          >分类<BaseSelect
            v-model="metadata.category"
            :options="[
              { label: '像素画', value: 'pixel-art' },
              { label: '文字', value: 'text' },
              { label: '建筑参考', value: 'building' },
              { label: '动漫', value: 'anime' },
              { label: '标志', value: 'logo' },
              { label: '其他', value: 'other' },
            ]"
            aria-label="地图画分类"
          /></label
        ><label
          >标签<input
            v-model="metadata.tags"
            maxlength="249"
            placeholder="用逗号分隔" /></label
        ><label
          >可见性<BaseSelect
            v-model="metadata.visibility"
            :options="[
              { label: '公开', value: 'public' },
              { label: '不公开列出', value: 'unlisted' },
              { label: '仅自己', value: 'private' },
            ]"
            aria-label="地图画可见性"
          /></label
        >
        <footer>
          <button type="button" @click="metadataOpen = false">取消</button
          ><button type="submit">保存</button>
        </footer>
      </form>
    </BaseDialog>
  </main>
</template>

<script lang="ts">
export default {
  directives: {
    mapCanvas: {
      mounted(
        canvas: HTMLCanvasElement,
        binding: {
          value: {
            map: { pixels_base64: string; icons: MapIcon[] };
            mosaic: boolean;
            regions: MosaicRegion[];
          };
        },
      ) {
        const source = mapCanvas(
          binding.value.map.pixels_base64,
          binding.value.map.icons,
          1,
          binding.value.mosaic,
          binding.value.regions,
        );
        canvas.width = source.width;
        canvas.height = source.height;
        canvas.getContext("2d")?.drawImage(source, 0, 0);
      },
      updated(
        canvas: HTMLCanvasElement,
        binding: {
          value: {
            map: { pixels_base64: string; icons: MapIcon[] };
            mosaic: boolean;
            regions: MosaicRegion[];
          };
        },
      ) {
        const source = mapCanvas(
          binding.value.map.pixels_base64,
          binding.value.map.icons,
          1,
          binding.value.mosaic,
          binding.value.regions,
        );
        canvas.getContext("2d")?.drawImage(source, 0, 0);
      },
    },
  },
};
</script>

<style scoped>
.shares-page {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 76px 0 0;
  overflow: hidden;
  color: var(--page-text);
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.shares-nav-shell {
  position: fixed;
  z-index: 9;
  top: 0;
  left: 0;
  width: clamp(12px, 3vw, 42px);
  height: 100dvh;
}
.shares-nav {
  position: fixed;
  z-index: 9;
  top: 50%;
  left: 0;
  display: grid;
  gap: 4px;
  width: 76px;
  padding: 6px;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 18px 48px var(--shadow);
  transform: translateY(-50%) translateX(calc(-100% + clamp(12px, 3vw, 42px)));
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}
.shares-nav-shell.is-open .shares-nav {
  transform: translateY(-50%) translateX(0);
}
.shares-nav-toggle {
  position: absolute;
  z-index: 1;
  top: 50%;
  right: -9px;
  display: none;
  place-items: center;
  width: 9px;
  height: 58px;
  padding: 0;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 0;
  border-radius: 0 5px 5px 0;
  transform: translateY(-50%);
}
.shares-nav-item {
  display: grid;
  place-items: center;
  gap: 6px;
  aspect-ratio: 1;
  padding: 6px;
  color: var(--muted-text);
  background: transparent;
  border: 0;
  border-radius: 5px;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
}
.shares-nav-item:hover,
.shares-nav-item.active {
  color: var(--accent);
  background: var(--surface-selected);
}
.shares-nav-icon {
  font-size: 16px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.shares-nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 700;
}
.share-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  overflow: hidden;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 18px 46px var(--shadow);
}
.share-toolbar {
  display: grid;
  grid-template-columns: minmax(150px, auto) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  min-height: 62px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--surface) 34%, var(--panel-bg));
  border-bottom: 1px solid var(--border);
}
.share-summary {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 150px;
  padding-right: 12px;
  border-right: 1px solid var(--border);
}
.share-mark {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  color: var(--accent-contrast);
  background: var(--accent);
  border-radius: 4px;
  font-size: 17px;
}
.share-summary div {
  display: grid;
  gap: 2px;
}
.share-summary strong {
  font-size: 13px;
}
.share-summary small,
.archive-toolbar small {
  color: var(--muted-text);
  font-size: 10px;
}
svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
input {
  min-width: 0;
  height: 38px;
  padding: 0 9px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  outline: 0;
  font: inherit;
  font-size: 12px;
}
input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);
}
button {
  cursor: pointer;
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.48;
}
.pw-search {
  display: grid;
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
}
.pw-search label,
.archive-toolbar label,
.map-filter {
  position: relative;
  display: block;
  min-width: 0;
}
.pw-search svg,
.archive-toolbar label svg,
.map-filter svg {
  position: absolute;
  top: 11px;
  left: 11px;
  width: 16px;
  color: var(--muted-text);
}
.pw-search input {
  box-sizing: border-box;
  width: 100%;
  padding-left: 36px;
  border-radius: 4px 0 0 4px;
}
.pw-search button,
.archive-toolbar form button,
.result-actions button:last-child {
  height: 38px;
  padding: 0 14px;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0 4px 4px 0;
  font-size: 11px;
  font-weight: 750;
}
.resume-button {
  height: 34px;
  padding: 0 10px;
  color: var(--accent);
  background: var(--surface-selected);
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
}
.refresh-button {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  padding: 0;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.refresh-button svg {
  width: 16px;
}
.refresh-button.syncing svg {
  animation: spin 0.8s linear infinite;
}
.share-error,
.dialog-error {
  margin: 0;
  padding: 9px 13px;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 8%, var(--panel-bg));
  border-bottom: 1px solid color-mix(in srgb, var(--danger) 30%, var(--border));
  font-size: 11px;
}
.archive-section {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.archive-toolbar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  min-height: 55px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--surface) 18%, var(--panel-bg));
  border-bottom: 1px solid var(--border);
}
.archive-toolbar > div {
  display: grid;
  gap: 2px;
}
.archive-toolbar strong {
  font-size: 12px;
}
.archive-toolbar input {
  box-sizing: border-box;
  width: 100%;
  padding-left: 34px;
  border-radius: 4px 0 0 4px;
}
.archive-state {
  display: grid;
  flex: 1;
  place-content: center;
  justify-items: center;
  gap: 7px;
  color: var(--muted-text);
  text-align: center;
}
.archive-state strong {
  color: var(--panel-text);
  font-size: 12px;
}
.archive-state small {
  font-size: 10px;
}
.state-code {
  color: var(--accent);
  font:
    750 9px ui-monospace,
    monospace;
  letter-spacing: 0.12em;
}
.mini-spinner {
  width: 20px;
  height: 20px;
  border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.75s linear infinite;
}
.artwork-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(245px, 1fr));
  gap: 9px;
  padding: 10px;
  overflow-y: auto;
}
.artwork-card {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  min-width: 0;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;
}
.artwork-card img {
  display: block;
  width: 88px;
  height: 88px;
  object-fit: contain;
  image-rendering: pixelated;
  background: #151515;
}
.artwork-info {
  display: grid;
  gap: 7px;
  min-width: 0;
  padding: 9px;
}
.artwork-info header,
.artwork-info footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
  min-width: 0;
}
.artwork-info h3 {
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.artwork-info code,
.artwork-info footer {
  color: var(--muted-text);
  font-size: 8px;
}
.artwork-info dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
  margin: 0;
}
.artwork-info dt {
  color: var(--muted-text);
  font-size: 8px;
}
.artwork-info dd {
  margin: 2px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10px;
}
.artwork-info .wide {
  grid-column: 1/-1;
}
.artwork-info footer {
  margin-top: auto;
}
.artwork-info footer button {
  height: 24px;
  padding: 0 7px;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 8px;
}
.archive-pagination,
.map-pagination {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 42px;
  padding: 6px 12px;
  color: var(--muted-text);
  border-top: 1px solid var(--border);
  font-size: 9px;
}
.archive-pagination div,
.map-pagination div {
  display: flex;
  align-items: center;
  gap: 5px;
}
.archive-pagination button,
.map-pagination button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.map-pagination b {
  font-size: 9px;
}
:global(.dialog-content:has(.result-dialog)) {
  display: flex;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}
:global(.dialog-panel:has(.result-dialog)) {
  width: min(1500px, calc(100vw - 28px));
  height: calc(100dvh - 28px);
  max-height: none;
}
.result-dialog {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.result-summary {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  padding: 5px 11px;
  background: color-mix(in srgb, var(--surface) 35%, var(--panel-bg));
  border-bottom: 1px solid var(--border);
}
.result-summary div {
  display: grid;
  gap: 2px;
}
.result-summary strong {
  font-size: 12px;
}
.result-summary span {
  color: var(--muted-text);
  font-size: 10px;
}
.grid-size {
  padding: 4px 7px;
  color: var(--accent);
  background: var(--surface-selected);
  border-radius: 3px;
  font:
    700 9px ui-monospace,
    monospace;
}
.result-workspace {
  display: grid;
  grid-template-columns: minmax(330px, 27%) minmax(0, 1fr);
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}
.result-index {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  border-right: 1px solid var(--border);
  grid-row: 1;
}
.result-index > header {
  display: grid;
  flex: none;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 5px 7px;
  padding: 7px;
  border-bottom: 1px solid var(--border);
}
.map-filter input {
  box-sizing: border-box;
  width: 100%;
  height: 32px;
  padding-left: 32px;
  font-size: 10px;
}
.map-filter svg {
  top: 8px;
  left: 9px;
  width: 13px;
}
.index-actions,
.index-zoom {
  display: flex;
  align-items: center;
  gap: 5px;
}
.index-actions {
  grid-row: 1;
  grid-column: 2;
}
.index-zoom {
  grid-column: 1 / -1;
  padding-top: 0;
  color: var(--muted-text);
  font-size: 9px;
}
.index-zoom span {
  margin-right: auto;
}
.result-index > header button {
  height: 26px;
  padding: 0 7px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 9px;
}
.map-list {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  flex: 1 1 auto;
  align-content: start;
  gap: 5px;
  min-height: 0;
  padding: 6px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.map-item {
  position: relative;
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.map-item.selected {
  border-color: color-mix(in srgb, var(--accent) 65%, var(--border));
  background: var(--surface-selected);
}
.map-item.active {
  box-shadow: inset 2px 0 var(--accent);
}
.map-select {
  display: grid;
  grid-template-columns: calc(44px * var(--index-scale)) minmax(0, 1fr) 18px;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px;
  padding-right: 25px;
  color: var(--panel-text);
  background: transparent;
  border: 0;
  text-align: left;
}
.map-select canvas {
  width: calc(44px * var(--index-scale));
  height: calc(44px * var(--index-scale));
  image-rendering: pixelated;
  background: #151515;
}
.map-select span {
  display: grid;
  min-width: 0;
  gap: 3px;
}
.map-select strong,
.map-select small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.map-select strong {
  font-size: 10px;
}
.map-select small {
  color: var(--muted-text);
  font:
    8px ui-monospace,
    monospace;
}
.map-select i {
  display: grid;
  place-items: center;
  width: 21px;
  height: 21px;
  color: var(--accent);
  font-size: 13px;
  font-style: normal;
}
.map-existing {
  position: absolute;
  top: 3px;
  left: 3px;
  padding: 2px 4px;
  color: var(--accent-contrast);
  background: color-mix(in srgb, var(--accent) 86%, #000);
  border-radius: 2px;
  font-size: 7px;
  font-style: normal;
  font-weight: 700;
  line-height: 1;
}
.map-item.selected .map-select i {
  color: var(--accent-contrast);
  background: var(--accent);
  border-radius: 3px;
}
.map-remove {
  position: absolute;
  top: 4px;
  right: 4px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  color: var(--muted-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 14px;
  line-height: 1;
}
.map-remove:hover {
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 50%, var(--border));
}
.map-pagination {
  flex: none;
  min-height: 36px;
}
.result-preview {
  position: relative;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  grid-row: 1;
  grid-column: 2;
}
.result-preview > header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 38px;
  padding: 5px 10px;
  background: color-mix(in srgb, var(--surface) 20%, var(--panel-bg));
  border-bottom: 1px solid var(--border);
}
.result-preview > header > span {
  font-size: 11px;
  font-weight: 700;
}
.preview-tools {
  display: flex;
  align-items: center;
  gap: 5px;
}
.preview-tools small {
  margin-right: 4px;
  color: var(--muted-text);
  font-size: 9px;
}
.preview-tools button {
  width: 25px;
  height: 25px;
  padding: 0;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 15px;
}
.preview-tools button.active {
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: var(--accent);
}
.preview-tools b {
  width: 34px;
  color: var(--muted-text);
  font:
    9px ui-monospace,
    monospace;
  text-align: center;
}
.dialog-preview {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 0;
  padding: 10px;
  overflow: auto;
  background: repeating-conic-gradient(
      color-mix(in srgb, var(--panel-bg) 70%, transparent) 0 25%,
      var(--surface) 0 50%
    )
    50% / 16px 16px;
}
.map-layout {
  position: relative;
  display: grid;
  gap: 2px;
  padding: 2px;
  background: var(--border);
  box-shadow: 0 8px 24px var(--shadow);
}
.map-layout.mosaic-drawing {
  cursor: crosshair;
}
.map-layout.mosaic-drawing .layout-tile {
  pointer-events: none;
}
.layout-tile {
  position: relative;
  display: block;
  padding: 0;
  overflow: hidden;
  background: #151515;
  border: 0;
  outline: 2px solid transparent;
  outline-offset: -2px;
}
.layout-tile.active {
  outline-color: var(--accent);
}
.layout-tile.dragging {
  opacity: 0.45;
}
.layout-tile canvas {
  display: block;
  image-rendering: pixelated;
}
.layout-tile span {
  position: absolute;
  right: 3px;
  bottom: 3px;
  padding: 2px 3px;
  color: #fff;
  background: rgb(0 0 0 / 0.58);
  border-radius: 2px;
  font:
    8px ui-monospace,
    monospace;
}
.mosaic-region {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  min-width: 18px;
  min-height: 18px;
  padding: 2px;
  overflow: hidden;
  color: #fff;
  background: repeating-conic-gradient(rgb(36 36 36 / 0.84) 0 25%, rgb(90 90 90 / 0.84) 0 50%) 50% / 8px 8px;
  border: 2px solid rgb(255 255 255 / 0.88);
  outline: 1px solid rgb(0 0 0 / 0.72);
  font-size: 8px;
  font-weight: 700;
  text-shadow: 0 1px 2px #000;
  cursor: grab;
  touch-action: none;
}
.map-layout :deep(.mosaic-region-wrap) {
  position: absolute;
  z-index: 3;
}
.mosaic-region:active { cursor: grabbing; }
.mosaic-region.active {
  border-color: var(--accent);
  outline-color: var(--accent);
}
.preview-empty {
  display: grid;
  justify-items: center;
  gap: 7px;
  color: var(--muted-text);
  text-align: center;
}
.preview-empty span {
  color: var(--accent);
  font-size: 38px;
}
.preview-empty strong {
  color: var(--panel-text);
  font-size: 12px;
}
.preview-empty small {
  font-size: 10px;
}
.result-actions {
  position: relative;
  z-index: 2;
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 42px;
  padding: 5px 10px;
  background: var(--panel-bg);
  border-top: 1px solid var(--border);
}
.result-actions > span {
  color: var(--muted-text);
  font-size: 9px;
}
.result-actions > div {
  display: flex;
  gap: 6px;
}
.result-actions button {
  height: 32px;
  padding: 0 10px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
}
.result-actions button:last-child {
  height: 32px;
  border-radius: 4px;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
@media (min-width: 761px) {
  .shares-nav-shell:hover .shares-nav {
    transform: translateY(-50%) translateX(0);
  }
}
@media (max-width: 760px) {
  .shares-page {
    padding-top: 76px;
  }
  .shares-nav-shell {
    width: 0;
    height: 0;
  }
  .shares-nav-toggle {
    display: grid;
  }
  .shares-nav {
    width: 68px;
    padding: 5px;
    transform: translateY(-50%) translateX(calc(-100% + 12px));
  }
  .share-panel {
    margin-top: 0;
  }
  .share-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 7px;
  }
  .share-summary {
    display: none;
  }
  .pw-search {
    grid-column: 1;
  }
  .resume-button {
    grid-row: 2;
    grid-column: 1;
  }
  .refresh-button {
    grid-column: 2;
  }
  .archive-toolbar {
    align-items: stretch;
    flex-direction: column;
  }
  .archive-toolbar form {
    grid-template-columns: 110px minmax(0, 1fr) auto;
  }
  .artwork-grid {
    grid-template-columns: 1fr;
  }
  :global(.dialog-content:has(.result-dialog)) {
    display: block;
    overflow-y: auto;
  }
  .result-workspace {
    grid-template-columns: 1fr;
  }
  .result-index {
    max-height: 300px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .result-preview {
    min-height: 300px;
  }
  .result-actions {
    position: sticky;
    bottom: 0;
    background: var(--panel-bg);
    align-items: stretch;
    flex-direction: column;
  }
  .result-actions > div {
    width: 100%;
  }
  .result-actions button {
    flex: 1;
  }
  .result-actions > span {
    display: none;
  }
}
@media (max-width: 460px) {
  .archive-pagination > span {
    display: none;
  }
  .archive-pagination {
    justify-content: center;
  }
  .result-summary .grid-size {
    display: none;
  }
  .result-preview > header small {
    display: none;
  }
  .result-workspace {
    min-width: 0;
  }
  .artwork-card {
    grid-template-columns: 74px minmax(0, 1fr);
  }
  .artwork-card img {
    width: 74px;
    height: 74px;
  }
}

.share-toolbar {
  grid-template-columns: minmax(150px, auto) minmax(220px, 1fr) auto auto auto;
}
.share-toolbar .archive-search {
  display: grid;
  min-width: 0;
  grid-template-columns: 128px minmax(0, 1fr) auto;
}
.archive-search .archive-search-field :deep(.select-trigger) {
  height: 38px;
  border-radius: 4px 0 0 4px;
}
.archive-search label {
  position: relative;
  display: block;
  min-width: 0;
}
.archive-search svg {
  position: absolute;
  top: 11px;
  left: 11px;
  width: 16px;
  color: var(--muted-text);
}
.archive-search input {
  box-sizing: border-box;
  width: 100%;
  padding-left: 36px;
  border-radius: 0;
}
.archive-search button,
.scan-button {
  height: 38px;
  padding: 0 14px;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0 4px 4px 0;
  font-size: 11px;
  font-weight: 750;
}
.scan-button {
  border-radius: 4px;
}
.landmark-dialog {
  display: grid;
  gap: 12px;
}
.scan-mode {
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 3px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.scan-mode button {
  min-height: 34px;
  color: var(--muted-text);
  background: transparent;
  border: 0;
  border-radius: 3px;
  font-size: 11px;
  font-weight: 700;
}
.scan-mode button.active {
  color: var(--accent-contrast);
  background: var(--accent);
}
.teleport-scan-state {
  display: grid;
  gap: 7px;
  min-height: 120px;
  align-content: center;
  padding: 18px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  text-align: center;
}
.teleport-scan-state strong { font-size: 13px; }
.teleport-scan-state small { color: var(--muted-text); font-size: 10px; line-height: 1.65; }
.landmark-dialog > label {
  display: grid;
  gap: 6px;
  color: var(--panel-text);
  font-size: 12px;
  font-weight: 700;
}
.landmark-dialog > label input {
  box-sizing: border-box;
  width: 100%;
}
.landmark-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
}
.landmark-input-row input {
  border-radius: 4px 0 0 4px;
}
.landmark-input-row button,
.landmark-dialog-actions button:last-child {
  height: 38px;
  padding: 0 12px;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0 4px 4px 0;
  font-size: 11px;
  font-weight: 700;
}
.landmark-error {
  margin: 0;
  color: var(--danger);
  font-size: 11px;
}
.landmark-results {
  display: grid;
  max-height: 300px;
  gap: 6px;
  overflow-y: auto;
}
.landmark-results {
  scrollbar-width: thin;
  scrollbar-color: var(--accent) transparent;
}
.landmark-results::-webkit-scrollbar {
  width: 6px;
}
.landmark-results::-webkit-scrollbar-track {
  background: transparent;
}
.landmark-results::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--accent) 72%, var(--muted-text));
  border: 1px solid var(--panel-bg);
  border-radius: 4px;
}
.landmark-results::-webkit-scrollbar-thumb:hover {
  background: var(--accent);
}
.landmark-results > button {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(100px, 0.8fr);
  gap: 10px;
  padding: 9px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  text-align: left;
}
.landmark-results > button.selected {
  border-color: var(--accent);
  background: var(--surface-selected);
}
.landmark-results span {
  display: grid;
  gap: 3px;
  min-width: 0;
}
.landmark-results strong,
.landmark-results small,
.landmark-results em {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.landmark-results strong {
  font-size: 11px;
}
.landmark-results small,
.landmark-results em {
  color: var(--muted-text);
  font-size: 9px;
  font-style: normal;
}
.landmark-results > p {
  margin: 18px 0;
  color: var(--muted-text);
  font-size: 11px;
  text-align: center;
}
.landmark-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
}
.landmark-dialog-actions button {
  height: 38px;
  padding: 0 12px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}
.landmark-dialog-actions button:last-child {
  border-radius: 4px;
}
.rotation-controls {
  display: grid;
  gap: 5px;
  padding-top: 3px;
  color: var(--muted-text);
  font-size: 9px;
}
.rotation-controls > div {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px;
}
.rotation-controls button {
  height: 28px;
  padding: 0 6px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 9px;
}
.rotation-controls button:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.map-filter-mode {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  color: var(--muted-text);
  font-size: 9px;
}
.map-filter-mode :deep(.select-trigger) {
  height: 28px;
  font-size: 10px;
}
.result-filter-bar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
}
.result-filter-bar .map-filter-mode {
  width: 100%;
}
.result-filter-bar .map-filter {
  grid-column: 1 / -1;
  width: 100%;
}
.result-filter-bar .coordinate-filter {
  grid-column: 1 / -1;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
}
.result-filter-bar .coordinate-filter > label {
  grid-template-columns: 12px 20px minmax(0, 1fr) 20px;
}
.group-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  color: var(--muted-text);
  font-size: 9px;
  cursor: pointer;
  user-select: none;
}
.map-group {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px;
  padding: 5px;
  background: color-mix(in srgb, var(--surface) 35%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 75%, transparent);
  border-radius: 4px;
}
.map-list > .map-group {
  align-self: start;
}
.map-group > header {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 16px;
  padding: 0 2px;
  color: var(--muted-text);
  font-size: 9px;
}
.map-group > header span {
  color: var(--accent);
  font-weight: 700;
}
.map-group > header small {
  font-size: 9px;
}
.coordinate-filter {
  display: grid;
  gap: 4px;
}
.coordinate-filter > label {
  display: grid;
  grid-template-columns: 14px 24px minmax(0, 1fr) 24px;
  align-items: center;
  gap: 3px;
  color: var(--muted-text);
  font:
    700 9px ui-monospace,
    monospace;
}
.coordinate-filter input {
  box-sizing: border-box;
  width: 100%;
  height: 26px;
  min-width: 0;
  padding: 0 5px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  text-align: center;
  font:
    10px ui-monospace,
    monospace;
}
.coordinate-filter button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 26px;
  padding: 0;
  font-size: 13px !important;
}
.result-filter-bar .coordinate-filter button {
  width: 20px;
}
.author-input {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 32px;
}
.author-input input {
  min-width: 0;
  border-radius: 3px 0 0 3px;
}
.author-input button {
  display: grid;
  place-items: center;
  height: 100%;
  padding: 0;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 0;
  border-radius: 0 3px 3px 0;
  font-size: 16px;
}
.author-input button:hover {
  color: var(--accent);
}
.player-search-dialog {
  display: grid;
  gap: 12px;
}
.player-search-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 38px;
}
.player-search-field input {
  box-sizing: border-box;
  width: 100%;
  height: 38px;
  min-width: 0;
  padding: 0 10px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px 0 0 4px;
}
.player-search-field button {
  color: var(--accent-contrast);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0 4px 4px 0;
  font-size: 16px;
}
.player-search-body {
  min-height: 90px;
}
.player-search-error {
  color: var(--danger);
  font-size: 11px;
}
.player-search-state {
  margin: 30px 0;
  color: var(--muted-text);
  font-size: 11px;
  text-align: center;
}
.player-search-results {
  display: grid;
  gap: 3px;
}
.player-search-results button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 34px;
  padding: 0 9px;
  color: var(--panel-text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 3px;
  text-align: left;
}
.player-search-results button:hover {
  background: var(--surface-selected);
  border-color: var(--border);
}
.player-search-results span {
  color: var(--accent);
  font-size: 9px;
}
.player-search-dialog > footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  color: var(--muted-text);
  border-top: 1px solid var(--border);
  font-size: 9px;
}
.player-search-dialog > footer div {
  display: flex;
  gap: 5px;
}
.player-search-dialog > footer button {
  width: 30px;
  height: 30px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
}
@media (max-width: 760px) {
  .share-toolbar {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .archive-search {
    grid-column: 1;
  }
  .scan-button {
    grid-row: 2;
    grid-column: 1;
  }
  .resume-button {
    grid-row: 2;
    grid-column: auto;
  }
  .landmark-results > button {
    grid-template-columns: 1fr;
  }
  .landmark-results em {
    white-space: normal;
  }
}

/* Archive controls are a single responsive tool row rather than a grid that creates empty rows. */
.share-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 6px 12px;
  overflow-x: auto;
}
.share-summary {
  flex: 0 0 190px;
  min-width: 0;
  padding-right: 10px;
}
.share-toolbar .archive-search {
  flex: 1 1 300px;
  min-width: 200px;
  grid-template-columns: 96px minmax(0, 1fr) auto;
}
.archive-search .archive-search-field :deep(.select-trigger),
.archive-search input,
.archive-search button,
.scan-button {
  height: 34px;
}
.archive-search .archive-search-field :deep(.select-trigger) {
  padding-inline: 8px;
}
.archive-controls {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 7px;
}
.archive-controls .archive-select {
  width: 118px;
}
.archive-controls :deep(.select-trigger) {
  height: 34px;
  background: var(--panel-bg);
  font-size: 10px;
}
.archive-scope {
  display: flex;
  align-items: center;
  height: 34px;
  padding: 2px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.archive-scope button {
  height: 26px;
  padding: 0 7px;
  color: var(--muted-text);
  background: transparent;
  border: 0;
  border-radius: 2px;
  white-space: nowrap;
  font-size: 9px;
  font-weight: 700;
}
.archive-scope button:hover {
  color: var(--panel-text);
  background: var(--surface-hover);
}
.archive-scope button.active {
  color: var(--accent-contrast);
  background: var(--accent);
}
.scan-button {
  flex: 0 0 auto;
  white-space: nowrap;
}
.resume-button {
  flex: 0 0 auto;
  height: 38px;
  padding: 0 12px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  white-space: nowrap;
  font-size: 11px;
}
.refresh-button {
  display: grid;
  flex: 0 0 38px;
  place-items: center;
  width: 38px;
  height: 38px;
  padding: 0;
  color: var(--muted-text);
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.refresh-button svg {
  width: 17px;
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.8;
}
.refresh-button:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.archive-section {
  padding: 0;
  overflow: hidden;
}
.archive-section > .artwork-grid {
  flex: 1 1 auto;
  min-height: 0;
  align-content: start;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--accent) 62%, var(--border)) transparent;
}
.archive-section > .artwork-grid::-webkit-scrollbar {
  width: 4px;
}
.archive-section > .artwork-grid::-webkit-scrollbar-track {
  background: transparent;
}
.archive-section > .artwork-grid::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--accent) 62%, var(--border));
  border: 0;
  border-radius: 4px;
}
.archive-section > .artwork-grid::-webkit-scrollbar-thumb:hover {
  background: var(--accent);
}
.archive-section > .archive-state {
  flex: 1 1 auto;
}
.archive-section > .archive-pagination {
  position: relative;
  z-index: 1;
  flex: 0 0 44px;
  min-height: 44px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--surface) 20%, var(--panel-bg));
}
.archive-state {
  display: grid;
  place-content: center;
  gap: 8px;
  min-height: 220px;
  padding: 24px;
  text-align: center;
}
.archive-state strong {
  font-size: 14px;
}
.archive-state small {
  color: var(--muted-text);
  font-size: 11px;
}
.state-code {
  color: var(--accent);
  font:
    700 10px ui-monospace,
    monospace;
  letter-spacing: 0;
}
.artwork-open {
  display: block;
  padding: 0;
  background: transparent;
  border: 0;
  cursor: pointer;
}
.artwork-open img {
  display: block;
}
.artwork-card {
  overflow: hidden;
}
.artwork-info footer {
  align-items: center;
}
.artwork-info footer span {
  margin-right: auto;
  color: var(--muted-text);
  font-size: 9px;
}
.artwork-info footer button {
  height: 28px;
  min-width: 42px;
  padding: 0 8px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 10px;
  white-space: nowrap;
}
@media (max-width: 1000px) {
  .share-toolbar {
    align-content: center;
    flex-wrap: wrap;
  }
  .share-summary {
    flex-basis: 180px;
  }
  .archive-search {
    order: 3;
    flex-basis: 100%;
  }
  .archive-controls { order: 2; }
  .scan-button {
    margin-left: auto;
  }
}
@media (max-width: 760px) {
  .share-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 7px;
    padding: 9px;
  }
  .share-summary {
    display: none;
  }
  .share-toolbar .archive-search {
    grid-column: 1 / -1;
    grid-row: 1;
    min-width: 0;
    grid-template-columns: 110px minmax(0, 1fr) auto;
  }
  .archive-controls {
    grid-column: 1 / -1;
    grid-row: 2;
    width: 100%;
    overflow-x: auto;
  }
  .archive-controls .archive-select {
    flex: 0 0 118px;
  }
  .scan-button {
    grid-column: 1 / 3;
    grid-row: 3;
    margin: 0;
  }
  .resume-button {
    grid-column: 1 / 3;
    grid-row: 4;
  }
  .refresh-button {
    grid-column: 3;
    grid-row: 3;
  }
  .archive-section {
    padding: 10px;
  }
  .archive-state {
    min-height: 180px;
  }
  .artwork-info footer span {
    width: 100%;
    margin: 0;
  }
}

.artwork-info footer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 6px;
  width: 100%;
}
.artwork-info footer span {
  width: auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artwork-info footer button {
  flex: none;
  white-space: nowrap;
}

/* Artwork archive cards use a stable preview column and a persistent action row. */
.artwork-grid {
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 10px;
  padding: 12px;
}
.artwork-card {
  grid-template-columns: 148px minmax(0, 1fr);
  min-height: 176px;
  background: var(--panel-bg);
}
.artwork-open { align-self: stretch; background: #151515; }
.artwork-card img {
  width: 148px;
  height: 176px;
  object-fit: contain;
}
.artwork-info {
  grid-template-rows: auto 1fr auto;
  gap: 7px;
  padding: 10px 11px;
}
.artwork-info header { gap: 10px; }
.artwork-info h3 { font-size: 14px; }
.artwork-info code { flex: none; }
.artwork-info dl { align-content: start; gap: 4px 12px; }
.artwork-info dt { font-size: 9px; }
.artwork-info dd { margin-top: 1px; font-size: 11px; }
.artwork-info footer {
  min-height: 30px;
  padding-top: 7px;
  border-top: 1px solid var(--border);
}
.artwork-info footer span { font-size: 9px; }
.artwork-info footer button {
  height: 30px;
  min-width: 48px;
  padding: 0 10px;
  font-size: 10px;
}


.result-index > header {
  gap: 8px;
  padding: 8px;
}
.index-actions {
  display: grid;
  grid-template-columns: 28px auto minmax(0, 1fr) 28px;
  gap: 5px;
}
.result-index > header .tool-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--muted-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 16px;
  line-height: 1;
}
.result-index > header .tool-icon:hover:not(:disabled) {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--surface-selected);
}
.result-index > header .select-all {
  font-size: 13px;
}
.result-index > header .auto-layout {
  font-size: 15px;
}
.result-index > header .clear-all {
  color: var(--muted-text);
}
.tile-order {
  min-width: 0;
}
.tile-order :deep(.select-trigger) {
  height: 28px;
  padding: 0 7px;
  font-size: 9px;
}
.map-group > header {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto auto;
  gap: 6px;
  min-height: 24px;
  padding: 0 2px;
}
.map-group > header button {
  height: 21px;
  padding: 0 6px;
  color: var(--accent);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--border));
  border-radius: 3px;
  font-size: 9px;
  font-weight: 700;
}
.map-group > header button:hover {
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: var(--accent);
}
.map-group > header .group-remove {
  width: 21px;
  padding: 0;
  color: var(--danger);
  border-color: color-mix(in srgb, var(--danger) 48%, var(--border));
  font-size: 15px;
  line-height: 1;
}
.map-group > header .group-remove:hover {
  color: var(--accent-contrast);
  background: var(--danger);
  border-color: var(--danger);
}

/* The creation form uses the same dark control language as BaseSelect and does not expose a review state. */
.result-actions button:last-child {
  min-width: 96px;
  font-weight: 750;
}
.map-list,
.dialog-preview,
.result-workspace,
.select-options,
.landmark-results,
.player-search-body,
.metadata-form,
.creation-metadata-form {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--accent) 65%, var(--border)) transparent;
}
.map-list::-webkit-scrollbar,
.dialog-preview::-webkit-scrollbar,
.result-workspace::-webkit-scrollbar,
.select-options::-webkit-scrollbar,
.landmark-results::-webkit-scrollbar,
.player-search-body::-webkit-scrollbar,
.metadata-form::-webkit-scrollbar,
.creation-metadata-form::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}
.map-list::-webkit-scrollbar-track,
.dialog-preview::-webkit-scrollbar-track,
.result-workspace::-webkit-scrollbar-track,
.select-options::-webkit-scrollbar-track,
.landmark-results::-webkit-scrollbar-track,
.player-search-body::-webkit-scrollbar-track,
.metadata-form::-webkit-scrollbar-track,
.creation-metadata-form::-webkit-scrollbar-track {
  background: transparent;
}
.map-list::-webkit-scrollbar-thumb,
.dialog-preview::-webkit-scrollbar-thumb,
.result-workspace::-webkit-scrollbar-thumb,
.select-options::-webkit-scrollbar-thumb,
.landmark-results::-webkit-scrollbar-thumb,
.player-search-body::-webkit-scrollbar-thumb,
.metadata-form::-webkit-scrollbar-thumb,
.creation-metadata-form::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--accent) 62%, var(--border));
  border-radius: 99px;
}
.map-list::-webkit-scrollbar-thumb:hover,
.dialog-preview::-webkit-scrollbar-thumb:hover,
.result-workspace::-webkit-scrollbar-thumb:hover,
.landmark-results::-webkit-scrollbar-thumb:hover,
.player-search-body::-webkit-scrollbar-thumb:hover {
  background: var(--accent);
}
.map-item.edited {
  background: color-mix(in srgb, var(--surface) 78%, var(--accent));
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border));
}
.map-item.edited .map-select {
  cursor: pointer;
}
.map-item.edited .map-select i {
  width: auto;
  min-width: 30px;
  color: var(--accent);
  font-size: 8px;
  font-weight: 700;
}
.preview-command-panel {
  position: absolute;
  right: 12px;
  bottom: 12px;
  z-index: 5;
  display: grid;
  justify-items: end;
  gap: 6px;
  max-width: calc(100% - 24px);
}
.edit-creation-metadata {
  height: 29px;
  padding: 0 9px;
  color: var(--panel-text);
  background: color-mix(in srgb, var(--panel-bg) 88%, transparent);
  border: 1px solid var(--border);
  border-radius: 3px;
  box-shadow: 0 4px 14px var(--shadow);
  font-size: 9px;
  font-weight: 700;
  backdrop-filter: blur(5px);
}
.edit-creation-metadata:hover,
.edit-creation-metadata:focus-visible {
  color: var(--accent);
  border-color: var(--accent);
  outline: 0;
}
.tile-quick-editor {
  display: grid;
  grid-template-columns: minmax(78px, 1fr) 42px 42px 28px 28px 28px auto;
  align-items: end;
  gap: 5px;
  width: min(440px, 100%);
  padding: 7px;
  color: var(--panel-text);
  background: color-mix(in srgb, var(--panel-bg) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 82%, var(--accent));
  border-radius: 4px;
  box-shadow: 0 7px 22px var(--shadow);
  backdrop-filter: blur(7px);
}
.tile-quick-editor > span {
  align-self: center;
  overflow: hidden;
  color: var(--muted-text);
  font-size: 9px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.tile-quick-editor label {
  display: grid;
  gap: 3px;
  color: var(--muted-text);
  font-size: 8px;
  font-weight: 700;
}
.tile-quick-editor input {
  box-sizing: border-box;
  width: 100%;
  height: 27px;
  padding: 0 4px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  text-align: center;
  font-size: 10px;
}
.tile-quick-editor input:focus {
  border-color: var(--accent);
  outline: 0;
}
.tile-quick-editor button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 16px;
  line-height: 1;
}
.tile-quick-editor button:hover,
.tile-quick-editor button:focus-visible {
  color: var(--accent);
  border-color: var(--accent);
  outline: 0;
}
.tile-quick-editor .tile-remove:hover,
.tile-quick-editor .tile-remove:focus-visible {
  color: var(--danger);
  border-color: var(--danger);
}
.tile-quick-editor .tile-metadata {
  width: auto;
  padding: 0 8px;
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: var(--accent);
  font-size: 9px;
  font-weight: 700;
}
.tile-quick-editor .tile-metadata:hover,
.tile-quick-editor .tile-metadata:focus-visible {
  color: var(--accent-contrast);
  border-color: var(--accent);
  filter: brightness(1.08);
}
.mosaic-quick-editor {
  display: grid;
  grid-template-columns: minmax(64px, 1fr) repeat(4, 42px) 28px;
  align-items: end;
  gap: 5px;
  width: min(360px, 100%);
  padding: 7px;
  color: var(--panel-text);
  background: color-mix(in srgb, var(--panel-bg) 92%, transparent);
  border: 1px solid color-mix(in srgb, var(--border) 82%, var(--accent));
  border-radius: 4px;
  box-shadow: 0 7px 22px var(--shadow);
  backdrop-filter: blur(7px);
}
.mosaic-quick-editor > span { align-self: center; color: var(--muted-text); font-size: 9px; font-weight: 700; }
.mosaic-quick-editor label { display: grid; gap: 3px; color: var(--muted-text); font-size: 8px; font-weight: 700; }
.mosaic-quick-editor input { box-sizing: border-box; width: 100%; height: 27px; padding: 0 4px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 2px; text-align: center; font-size: 10px; }
.mosaic-quick-editor button { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; color: var(--danger); background: var(--surface); border: 1px solid var(--border); border-radius: 3px; font-size: 16px; }
:global(.dialog-content:has(.artwork-detail)) {
  display: flex;
  padding: 0;
  overflow: hidden;
}
:global(.dialog-panel:has(.artwork-detail)) {
  width: min(1120px, calc(100vw - 32px));
  height: min(760px, calc(100dvh - 32px));
  max-height: none;
}
.artwork-detail {
  display: grid;
  grid-template-columns: minmax(420px, 1.1fr) minmax(300px, 0.9fr);
  grid-template-rows: minmax(0, 1fr) auto;
  flex: 1;
  min-width: 0;
  min-height: 0;
  color: var(--panel-text);
}
.detail-preview-panel {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  background: color-mix(in srgb, var(--surface) 35%, var(--panel-bg));
  border-right: 1px solid var(--border);
}
.detail-preview-stage {
  position: relative;
  display: grid;
  place-items: center;
  min-height: 0;
  padding: 20px;
  overflow: auto;
  background: repeating-conic-gradient(
      color-mix(in srgb, var(--panel-bg) 72%, transparent) 0 25%,
      var(--surface) 0 50%
    )
    50% / 16px 16px;
}
.detail-preview-stage {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--accent) 58%, var(--border)) transparent;
}
.detail-preview-stage::-webkit-scrollbar { width: 4px; height: 4px; }
.detail-preview-stage::-webkit-scrollbar-track { background: transparent; }
.detail-preview-stage::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--accent) 58%, var(--border)); border: 0; border-radius: 4px; }
.detail-preview-stage::-webkit-scrollbar-thumb:hover { background: var(--accent); }
.detail-preview-zoom { position: sticky; z-index: 2; top: 0; display: flex; grid-column: 1; grid-row: 1; justify-self: end; align-self: start; align-items: center; gap: 3px; margin: -12px -12px 0 0; padding: 3px; color: var(--panel-text); background: color-mix(in srgb, var(--panel-bg) 88%, transparent); border: 1px solid var(--border); border-radius: 4px; box-shadow: 0 4px 12px var(--shadow); backdrop-filter: blur(5px); }
.detail-preview-zoom button { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; color: var(--panel-text); background: transparent; border: 0; border-radius: 2px; font-size: 15px; }
.detail-preview-zoom button:hover:not(:disabled), .detail-preview-zoom button.active { color: var(--accent-contrast); background: var(--accent); }
.detail-preview-zoom button:disabled { opacity: .4; }
.detail-preview-zoom span { width: 31px; color: var(--muted-text); font-size: 9px; font-weight: 700; text-align: center; }
.detail-preview-stage > img { grid-column: 1; grid-row: 1; transition: transform .16s ease; transform-origin: center; }
.detail-preview-stage img {
  display: block;
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  box-shadow: 0 12px 30px var(--shadow);
}
.detail-preview-actions {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 6px;
  padding: 9px;
  border-top: 1px solid var(--border);
}
.detail-preview-actions button,
.detail-manager-actions button,
.report-form button,
.versions button {
  height: 32px;
  padding: 0 9px;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
}
.detail-preview-actions button:hover,
.detail-manager-actions button:hover,
.report-form button:hover,
.versions button:hover {
  color: var(--accent);
  border-color: var(--accent);
}
.detail-preview-actions .detail-primary {
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: var(--accent);
}
.detail-preview-actions .detail-primary:hover {
  color: var(--accent-contrast);
  filter: brightness(1.07);
}
.artwork-detail-meta {
  display: grid;
  align-content: start;
  gap: 14px;
  min-width: 0;
  padding: 16px;
  overflow-y: auto;
}
.detail-heading {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 12px;
  padding-bottom: 13px;
  border-bottom: 1px solid var(--border);
}
.detail-heading div {
  min-width: 0;
}
.detail-heading span,
.detail-tags > span,
.detail-description > span {
  display: block;
  color: var(--muted-text);
  font-size: 9px;
  font-weight: 700;
}
.detail-heading h3 {
  margin: 4px 0 0;
  overflow: hidden;
  font-size: 17px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-heading b {
  flex: none;
  padding: 5px 7px;
  color: var(--accent);
  background: var(--surface-selected);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: 3px;
  font-size: 10px;
}
.detail-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 0;
}
.detail-facts div,
.detail-stats div {
  min-width: 0;
}
.detail-facts dt,
.detail-stats dt {
  color: var(--muted-text);
  font-size: 9px;
}
.detail-facts dd,
.detail-stats dd {
  margin: 3px 0 0;
  overflow: hidden;
  color: var(--panel-text);
  font-size: 11px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.detail-tags,
.detail-description {
  display: grid;
  gap: 6px;
}
.detail-tags > div {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.detail-tags i {
  padding: 3px 6px;
  color: var(--accent);
  background: var(--surface-selected);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border));
  border-radius: 3px;
  font-size: 9px;
  font-style: normal;
}
.detail-tags small {
  color: var(--muted-text);
  font-size: 10px;
}
.detail-description p {
  margin: 0;
  color: var(--muted-text);
  font-size: 11px;
  line-height: 1.55;
  white-space: pre-wrap;
}
.detail-stats {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  gap: 12px;
  margin: 0;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}
.detail-manager-actions {
  display: flex;
  gap: 6px;
  padding-top: 2px;
}
.detail-manager-actions .danger {
  color: var(--danger);
}
.detail-manager-actions .danger:hover {
  color: var(--danger);
  border-color: var(--danger);
}
.detail-lower {
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: minmax(0, 1fr) minmax(250px, 0.55fr);
  gap: 14px;
  padding: 11px 16px;
  background: color-mix(in srgb, var(--surface) 18%, var(--panel-bg));
  border-top: 1px solid var(--border);
}
.versions {
  min-width: 0;
}
.versions header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}
.versions strong {
  font-size: 10px;
}
.versions small {
  color: var(--muted-text);
  font-size: 9px;
}
.versions ol {
  display: grid;
  gap: 4px;
  max-height: 82px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.versions li {
  display: grid;
  grid-template-columns: 29px minmax(0, 1fr) auto;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 4px 6px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 3px;
}
.versions li > span {
  color: var(--accent);
  font-size: 9px;
  font-weight: 700;
}
.versions p {
  margin: 0;
  overflow: hidden;
  color: var(--muted-text);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.versions button {
  height: 24px;
  font-size: 9px;
}
.report-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 6px;
  align-items: end;
}
.report-form label {
  display: grid;
  gap: 4px;
  color: var(--muted-text);
  font-size: 9px;
  font-weight: 700;
}
.report-form input {
  height: 32px;
  font-size: 10px;
}
@media (max-width: 760px) {
  :global(.dialog-panel:has(.artwork-detail)) {
    width: calc(100vw - 16px);
    height: calc(100dvh - 16px);
  }
  .artwork-detail {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .detail-preview-panel {
    flex: 0 0 330px;
    min-height: 330px;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .artwork-detail-meta {
    overflow: visible;
  }
  .detail-lower {
    grid-template-columns: 1fr;
  }
}
.duplicate-artwork-dialog {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 16px;
  min-width: min(580px, 100%);
}
.duplicate-preview {
  display: grid;
  place-items: center;
  min-height: 190px;
  padding: 8px;
  background: repeating-conic-gradient(
      color-mix(in srgb, var(--panel-bg) 72%, transparent) 0 25%,
      var(--surface) 0 50%
    )
    50% / 14px 14px;
  border: 1px solid var(--border);
  border-radius: 4px;
}
.duplicate-preview img {
  display: block;
  max-width: 100%;
  max-height: 220px;
  image-rendering: pixelated;
}
.duplicate-copy {
  display: grid;
  align-content: start;
  gap: 9px;
  min-width: 0;
}
.duplicate-copy > span {
  color: var(--accent);
  font-size: 9px;
  font-weight: 700;
}
.duplicate-copy h3 {
  margin: -5px 0 0;
  overflow: hidden;
  font-size: 16px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.duplicate-copy > p {
  margin: 0;
  color: var(--muted-text);
  font-size: 10px;
  line-height: 1.5;
}
.duplicate-copy dl {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 7px 12px;
  margin: 0;
  padding: 9px 0;
  border-top: 1px solid var(--border);
  border-bottom: 1px solid var(--border);
}
.duplicate-copy dl .wide {
  grid-column: 1 / -1;
}
.duplicate-copy dt {
  color: var(--muted-text);
  font-size: 8px;
}
.duplicate-copy dd {
  margin: 2px 0 0;
  overflow: hidden;
  font-size: 10px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.duplicate-copy footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}
.duplicate-copy footer button {
  height: 32px;
  padding: 0 10px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
}
.duplicate-copy footer .duplicate-primary {
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: var(--accent);
}
.metadata-form,
.creation-metadata-form {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  min-width: min(620px, 100%);
}
.creation-metadata-heading,
.creation-description,
.creation-metadata-form footer,
.metadata-form > label:nth-of-type(4),
.metadata-form footer {
  grid-column: 1 / -1;
}
.creation-metadata-heading {
  display: grid;
  gap: 3px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--border);
}
.creation-metadata-heading strong {
  font-size: 12px;
}
.creation-metadata-heading small {
  color: var(--muted-text);
  font-size: 9px;
}
.creation-metadata-form label,
.metadata-form label {
  display: grid;
  gap: 5px;
  color: var(--muted-text);
  font-size: 10px;
  font-weight: 700;
}
.creation-metadata-form input,
.creation-metadata-form :deep(.select-trigger),
.metadata-form input,
.metadata-form :deep(.select-trigger) {
  height: 32px;
  font-size: 11px;
}
.creation-metadata-form :deep(.base-select),
.metadata-form :deep(.base-select) {
  width: 100%;
}
.creation-description > span {
  display: flex;
  justify-content: space-between;
}
.creation-description small {
  color: var(--muted-text);
  font-size: 9px;
  font-weight: 500;
}
.creation-description textarea {
  box-sizing: border-box;
  height: 94px;
  padding: 8px 9px;
  resize: vertical;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 11px;
  line-height: 1.5;
}
.creation-description textarea:focus {
  border-color: var(--accent);
  outline: 0;
}
.creation-metadata-form footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 4px;
}
.creation-metadata-form footer button {
  height: 32px;
  padding: 0 12px;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
}
.metadata-form footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  padding-top: 4px;
}
.metadata-form footer button {
  height: 32px;
  padding: 0 12px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  font-size: 10px;
  font-weight: 700;
}
.metadata-form footer button:last-child {
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: var(--accent);
}
.metadata-form textarea {
  box-sizing: border-box;
  width: 100%;
  height: 94px;
  padding: 8px 9px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 3px;
  resize: vertical;
}
.metadata-form textarea:focus {
  border-color: var(--accent);
  outline: 0;
}
@media (max-width: 560px) {
  .duplicate-artwork-dialog {
    grid-template-columns: 1fr;
  }
  .duplicate-preview {
    min-height: 170px;
  }
  .metadata-form,
  .creation-metadata-form {
    grid-template-columns: 1fr;
  }
  .metadata-form > label,
  .metadata-form > label:nth-of-type(4),
  .metadata-form footer {
    grid-column: 1;
  }
}
.result-index > header .auto-layout {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: auto;
  padding: 0 7px;
  font-size: 9px;
  font-weight: 700;
}
.result-index > header .auto-layout span {
  font-size: 14px;
}
@media (max-width: 760px) {
  :global(.dialog-panel:has(.result-dialog)) {
    width: calc(100vw - 16px);
    height: calc(100dvh - 16px);
  }
  :global(.dialog-content:has(.result-dialog)) {
    display: flex;
    overflow: hidden;
  }
  .result-summary {
    min-height: 36px;
  }
  .result-workspace {
    display: flex;
    flex-direction: column;
    overflow-y: auto;
  }
  .result-index {
    flex: 0 0 300px;
    max-height: none;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .result-preview {
    flex: 0 0 390px;
    min-height: 390px;
  }
  .result-actions {
    position: static;
    flex-direction: row;
  }
  .result-actions > div {
    width: auto;
  }
}
@media (max-width: 460px) {
  .result-summary span {
    max-width: 70vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .result-index > header {
    grid-template-columns: 1fr;
  }
  .index-actions {
    grid-row: auto;
    grid-column: 1;
  }
  .map-group {
    grid-template-columns: 1fr;
  }
  .tile-quick-editor {
    grid-template-columns: minmax(0, 1fr) 42px 42px 28px 28px 28px auto;
    width: 100%;
  }
  .preview-command-panel {
    right: 8px;
    bottom: 8px;
  }
  .result-actions {
    align-items: stretch;
    flex-direction: column;
  }
  .result-actions > div {
    width: 100%;
  }
}
</style>
