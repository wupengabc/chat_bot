<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import BaseSelect from '../../components/BaseSelect.vue'
import BaseDialog from '../../components/BaseDialog.vue'
import {get, getAccessToken} from '../../utils/request'
import {getCachedMapTile, putCachedMapTile, type StoredMapTile} from '../../utils/world-map-cache'

type World = {id: string; name: string; minecraftVersion: string}
type Biome = {id: number; name: string; rgb: [number, number, number] | null}
type WorldResponse = {worlds: World[]; biomes: Biome[]}
type Tile = {key: string; x: number; z: number; span: number; image: HTMLCanvasElement; biomeIds: Uint8Array}
type QueuedTile = {key: string; x: number; z: number; worldId: string; minecraftVersion: string; dimension: string; biomeIds: number[]; session: number}
type TileRequest = QueuedTile & {id: string}

const worlds = ref<World[]>([])
const biomes = ref<Biome[]>([])
const selectedWorld = ref('')
const minecraftVersion = ref('')
const dimension = ref('overworld')
const selectedBiomeIds = ref<number[]>([])
const centerX = ref(0)
const centerZ = ref(0)
const zoom = ref(300)
const loading = ref(true)
const error = ref('')
const canvas = ref<HTMLCanvasElement>()
let socket: WebSocket | undefined
let requestSequence = 0
const activeRequests = new Map<string, TileRequest>()
const cancellingRequestIds = new Set<string>()
let queue: QueuedTile[] = []
let viewSession = 0
let awaitingCancellation = false
let drag: {x: number; y: number; offsetX: number; offsetZ: number} | undefined
let cache = new Map<string, Tile>()
let spans = new Map<string, number>()
const pointer = ref<{x: number; z: number; biome: string} | undefined>()
const biomeDialogOpen = ref(false)
const biomeSearch = ref('')
const showChunkLines = ref(false)
const hydrating = new Set<string>()
const visibleTileIds = new Set<string>()
const maxRetainedOffscreenTiles = 144
const defaultTileSpan = 512
const mapCoordinateLimit = 1_000_000

const selected = computed(() => worlds.value.find(world => world.id === selectedWorld.value))
const dimensionOptions = [{label: '主世界', value: 'overworld'}, {label: '下界', value: 'the_nether'}, {label: '末地', value: 'the_end'}]
const normalizedBiomeIds = computed(() => [...selectedBiomeIds.value].sort((left, right) => left - right))
const viewKey = computed(() => `v12|${selectedWorld.value}|${minecraftVersion.value}|${dimension.value}|${normalizedBiomeIds.value.join(',')}`)
const viewScale = computed(() => 2 ** ((400 - zoom.value) / 100))
const biomeNames = computed(() => new Map(biomes.value.map(biome => [biome.id, biome.name])))
const filteredBiomes = computed(() => {
  const keyword = biomeSearch.value.trim().toLocaleLowerCase()
  return keyword ? biomes.value.filter(biome => biome.name.toLocaleLowerCase().includes(keyword)) : biomes.value
})
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected'
const connectionState = ref<ConnectionState>('disconnected')
const connectionLabel = computed(() => ({connecting: 'WS 连接中', connected: 'WS 已连接', reconnecting: 'WS 重连中', disconnected: 'WS 已断开'}[connectionState.value]))
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let reconnectAttempts = 0
let disposed = false
const pointers = new Map<number, {x: number; y: number}>()
let pinch: {distance: number; zoom: number} | undefined

function tileKey(key: string, x: number, z: number) { return `${key}|${x}|${z}` }
function tileInBounds(x: number, z: number, span: number) {
  return x >= -mapCoordinateLimit && z >= -mapCoordinateLimit && x + span <= mapCoordinateLimit && z + span <= mapCoordinateLimit
}
function clampCenter(value: number) { return Math.max(-mapCoordinateLimit, Math.min(mapCoordinateLimit, value)) }
function pruneMemoryCache() {
  let removable = cache.size - visibleTileIds.size - maxRetainedOffscreenTiles
  if (removable <= 0) return
  for (const id of cache.keys()) {
    if (visibleTileIds.has(id)) continue
    cache.delete(id)
    if (--removable <= 0) return
  }
}
function canvasSize() {
  const target = canvas.value
  if (!target) return null
  const rect = target.getBoundingClientRect()
  const ratio = window.devicePixelRatio || 1
  const width = Math.max(1, Math.round(rect.width * ratio)), height = Math.max(1, Math.round(rect.height * ratio))
  if (target.width !== width || target.height !== height) { target.width = width; target.height = height }
  return {target, width: rect.width, height: rect.height, ratio}
}

function drawMap() {
  const size = canvasSize()
  if (!size) return
  const context = size.target.getContext('2d')
  if (!context) return
  context.setTransform(size.ratio, 0, 0, size.ratio, 0, 0)
  context.fillStyle = '#172116'
  context.fillRect(0, 0, size.width, size.height)
  context.imageSmoothingEnabled = false
  const span = spans.get(viewKey.value)
  if (!span) return
  const pixelsPerBlock = viewScale.value
  const offsetX = drag?.offsetX || 0, offsetZ = drag?.offsetZ || 0
  for (const tile of cache.values()) {
    if (tile.key !== viewKey.value || !tileInBounds(tile.x, tile.z, tile.span)) continue
    const left = size.width / 2 + (tile.x - centerX.value) * pixelsPerBlock + offsetX
    const top = size.height / 2 + (tile.z - centerZ.value) * pixelsPerBlock + offsetZ
    context.drawImage(tile.image, left, top, span * pixelsPerBlock, span * pixelsPerBlock)
  }
  if (showChunkLines.value) drawChunkLines(context, size.width, size.height, pixelsPerBlock, offsetX, offsetZ)
}

function drawChunkLines(context: CanvasRenderingContext2D, width: number, height: number, pixelsPerBlock: number, offsetX: number, offsetZ: number) {
  const chunkPixels = 16 * pixelsPerBlock
  if (chunkPixels < 1) return
  const density = Math.max(1, Math.ceil(4 / chunkPixels))
  const blockStep = 16 * density
  const step = blockStep * pixelsPerBlock
  const leftWorld = centerX.value - (width / 2 + offsetX) / pixelsPerBlock
  const topWorld = centerZ.value - (height / 2 + offsetZ) / pixelsPerBlock
  const firstX = Math.floor(leftWorld / blockStep) * blockStep
  const firstZ = Math.floor(topWorld / blockStep) * blockStep
  const startX = width / 2 + (firstX - centerX.value) * pixelsPerBlock + offsetX
  const startZ = height / 2 + (firstZ - centerZ.value) * pixelsPerBlock + offsetZ
  context.save()
  context.strokeStyle = density === 1 ? 'rgb(232 255 223 / .58)' : 'rgb(232 255 223 / .36)'
  context.lineWidth = 1
  context.beginPath()
  for (let x = startX; x <= width; x += step) { context.moveTo(Math.round(x) + .5, 0); context.lineTo(Math.round(x) + .5, height) }
  for (let z = startZ; z <= height; z += step) { context.moveTo(0, Math.round(z) + .5); context.lineTo(width, Math.round(z) + .5) }
  context.stroke()
  context.restore()
}

function tileFromStored(tile: StoredMapTile): Tile | undefined {
  if (tile.pixels.byteLength !== tile.width * tile.height * 4 || tile.biomeIds.byteLength !== tile.width * tile.height) return undefined
  const image = document.createElement('canvas')
  image.width = tile.width
  image.height = tile.height
  const context = image.getContext('2d')
  if (!context) return undefined
  context.putImageData(new ImageData(new Uint8ClampedArray(tile.pixels), tile.width, tile.height), 0, 0)
  return {key: tile.key, x: tile.x, z: tile.z, span: tile.span, image, biomeIds: new Uint8Array(tile.biomeIds)}
}

function hydrateTile(key: string, x: number, z: number, session: number) {
  if (!tileInBounds(x, z, spans.get(key) || defaultTileSpan)) return
  const id = tileKey(key, x, z)
  if (cache.has(id) || hydrating.has(id)) return
  hydrating.add(id)
  void getCachedMapTile(id).then(stored => {
    const tile = stored && tileFromStored(stored)
    if (session !== viewSession) return
    if (tile) {
      spans.set(tile.key, tile.span)
      cache.set(id, tile)
      drawMap()
      ensureTiles()
    } else queueTile(key, x, z, session)
  }).catch(() => { if (session === viewSession) queueTile(key, x, z, session) }).finally(() => {
    hydrating.delete(id)
    requestNext()
  })
}

function requestNext() {
  if (awaitingCancellation || !socket || socket.readyState !== WebSocket.OPEN) return
  while (activeRequests.size < 4 && queue.length) {
    const request = queue.shift()!
    if (request.session !== viewSession) continue
    if (!tileInBounds(request.x, request.z, spans.get(request.key) || defaultTileSpan)) continue
    const active: TileRequest = {id: String(++requestSequence), ...request}
    activeRequests.set(active.id, active)
    socket.send(JSON.stringify({type: 'map', requestId: active.id, worldId: active.worldId, dimension: active.dimension, x: active.x, z: active.z, biomeIds: active.biomeIds}))
  }
}

function queueTile(key: string, x: number, z: number, session: number) {
  if (!tileInBounds(x, z, spans.get(key) || defaultTileSpan)) return
  const id = tileKey(key, x, z)
  if (cache.has(id) || [...activeRequests.values()].some(item => item.key === key && item.x === x && item.z === z) || queue.some(item => item.key === key && item.x === x && item.z === z)) return
  queue.push({key, x, z, worldId: selectedWorld.value, minecraftVersion: minecraftVersion.value, dimension: dimension.value, biomeIds: [...normalizedBiomeIds.value], session})
}

function ensureTiles(session = viewSession) {
  if (session !== viewSession) return
  const key = viewKey.value
  const span = spans.get(key) || defaultTileSpan
  spans.set(key, span)
  visibleTileIds.clear()
  const originX = Math.floor(centerX.value / span) * span
  const originZ = Math.floor(centerZ.value / span) * span
  const size = canvasSize()
  const visibleX = Math.ceil((size?.width || 512) / (span * viewScale.value) / 2) + 1
  const visibleZ = Math.ceil((size?.height || 512) / (span * viewScale.value) / 2) + 1
  const candidates: Array<{x: number; z: number}> = []
  for (let z = -visibleZ; z <= visibleZ; z++) for (let x = -visibleX; x <= visibleX; x++) {
    const candidate = {x: originX + x * span, z: originZ + z * span}
    if (tileInBounds(candidate.x, candidate.z, span)) candidates.push(candidate)
  }
  candidates.sort((left, right) => Math.abs(left.x - centerX.value) + Math.abs(left.z - centerZ.value) - Math.abs(right.x - centerX.value) - Math.abs(right.z - centerZ.value))
  for (const tile of candidates) {
    visibleTileIds.add(tileKey(key, tile.x, tile.z))
    hydrateTile(key, tile.x, tile.z, session)
  }
  pruneMemoryCache()
  loading.value = !cache.has(tileKey(key, originX, originZ))
  requestNext()
}

function resetView() {
  viewSession++
  const requestIds = [...activeRequests.keys()]
  if (requestIds.length && socket?.readyState === WebSocket.OPEN) {
    for (const requestId of requestIds) cancellingRequestIds.add(requestId)
    socket.send(JSON.stringify({type: 'cancel', requestIds}))
    awaitingCancellation = true
  }
  activeRequests.clear()
    queue = []
  error.value = ''
  ensureTiles(viewSession)
  drawMap()
}

function scheduleReconnect() {
  if (disposed || reconnectTimer || !selectedWorld.value) return
  connectionState.value = 'reconnecting'
  const delay = Math.min(15_000, 750 * 2 ** Math.min(reconnectAttempts++, 5))
  reconnectTimer = setTimeout(() => { reconnectTimer = undefined; connect() }, delay)
}

function connect() {
  if (disposed || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return
  const token = getAccessToken()
  if (!token) { error.value = '需要有效登录'; loading.value = false; connectionState.value = 'disconnected'; return }
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const connection = new WebSocket(`${protocol}//${location.host}/api/worlds/socket`)
  socket = connection
  connectionState.value = reconnectAttempts ? 'reconnecting' : 'connecting'
  connection.binaryType = 'arraybuffer'
  connection.onopen = () => { if (socket === connection) connection.send(JSON.stringify({type: 'authenticate', token})) }
  connection.onmessage = async event => {
    if (socket !== connection) return
    if (typeof event.data === 'string') {
      let message: {type: string; requestId?: string; width?: number; height?: number; span?: number; x?: number; z?: number; pixelBytes?: number; message?: string}
      try { message = JSON.parse(event.data) } catch { return }
      if (message.type === 'authenticated') { reconnectAttempts = 0; connectionState.value = 'connected'; error.value = ''; resetView(); return }
      if (message.type === 'cancelled' && message.requestId) {
        cancellingRequestIds.delete(message.requestId)
        if (!cancellingRequestIds.size) { awaitingCancellation = false; ensureTiles(); requestNext() }
        return
      }
      if (message.type === 'error') {
        if (message.requestId && cancellingRequestIds.delete(message.requestId)) {
          if (!cancellingRequestIds.size) { awaitingCancellation = false; ensureTiles(); requestNext() }
          return
        }
        if (message.requestId) activeRequests.delete(message.requestId)
        error.value = message.message || '地图加载失败'; loading.value = false; requestNext(); return
      }
      return
    }
    if (!(event.data instanceof ArrayBuffer) || event.data.byteLength < 28) return
    const frame = new DataView(event.data)
    if (frame.getUint32(0, false) !== 0x574d4150 || frame.getUint8(4) !== 1) return
    const requestIdBytes = frame.getUint8(5)
    const width = frame.getUint16(6, true), height = frame.getUint16(8, true)
    const span = frame.getUint32(12, true), x = frame.getInt32(16, true), z = frame.getInt32(20, true)
    const pixelBytes = frame.getUint32(24, true), payloadOffset = 28 + requestIdBytes
    if (!requestIdBytes || !width || !height || pixelBytes !== width * height * 4 || event.data.byteLength !== payloadOffset + pixelBytes + width * height) return
    const requestId = new TextDecoder().decode(new Uint8Array(event.data, 28, requestIdBytes))
    const request = activeRequests.get(requestId)
    if (!request) return
    await nextTick()
    const image = document.createElement('canvas')
    image.width = width; image.height = height
    image.getContext('2d')?.putImageData(new ImageData(new Uint8ClampedArray(event.data, payloadOffset, pixelBytes), width, height), 0, 0)
    spans.set(request.key, span)
    const id = tileKey(request.key, x, z)
    const biomeIds = new Uint8Array(event.data.slice(payloadOffset + pixelBytes))
    cache.set(id, {key: request.key, x, z, span, image, biomeIds})
    pruneMemoryCache()
    void putCachedMapTile({id, key: request.key, x, z, span, width, height, pixels: event.data.slice(payloadOffset, payloadOffset + pixelBytes), biomeIds: biomeIds.buffer, updatedAt: Date.now()}).catch(() => {})
    activeRequests.delete(request.id); loading.value = false
    drawMap(); ensureTiles()
  }
  connection.onerror = () => { connection.close() }
  connection.onclose = () => {
    if (socket !== connection) return
    socket = undefined
    activeRequests.clear(); cancellingRequestIds.clear(); awaitingCancellation = false
    loading.value = false
    scheduleReconnect()
  }
}

async function loadWorlds() {
  loading.value = true; error.value = ''
  try {
    const response = await get<WorldResponse>('/api/worlds')
    worlds.value = response.worlds; biomes.value = response.biomes
    selectedWorld.value = worlds.value[0]?.id || ''
    minecraftVersion.value = selected.value?.minecraftVersion || ''
    if (!selectedWorld.value) { error.value = '当前没有可用世界'; loading.value = false; return }
    connect()
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '世界地图不可用'; loading.value = false }
}

function zoomBy(delta: number) { const next = Math.min(800, Math.max(0, zoom.value + delta)); if (next !== zoom.value) zoom.value = next }
function handleWheel(event: WheelEvent) { event.preventDefault(); zoomBy(event.deltaY < 0 ? -25 : 25) }
function pointerDistance() {
  const [first, second] = [...pointers.values()]
  return first && second ? Math.hypot(second.x - first.x, second.y - first.y) : 0
}
function startDrag(event: PointerEvent) {
  if (event.pointerType === 'mouse' && event.button !== 0) return
  pointers.set(event.pointerId, {x: event.clientX, y: event.clientY})
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  if (pointers.size >= 2) {
    drag = undefined
    pinch = {distance: Math.max(1, pointerDistance()), zoom: zoom.value}
  } else drag = {x: event.clientX, y: event.clientY, offsetX: 0, offsetZ: 0}
}
function updatePointer(event: PointerEvent) {
  const stage = event.currentTarget as HTMLElement
  const rect = stage.getBoundingClientRect(), span = spans.get(viewKey.value)
  if (!span) return
  const worldX = Math.floor(centerX.value + (event.clientX - rect.left - rect.width / 2 - (drag?.offsetX || 0)) / viewScale.value)
  const worldZ = Math.floor(centerZ.value + (event.clientY - rect.top - rect.height / 2 - (drag?.offsetZ || 0)) / viewScale.value)
  if (Math.abs(worldX) > mapCoordinateLimit || Math.abs(worldZ) > mapCoordinateLimit) { pointer.value = {x: worldX, z: worldZ, biome: '超出地图范围'}; return }
  const tile = cache.get(tileKey(viewKey.value, Math.floor(worldX / span) * span, Math.floor(worldZ / span) * span))
  if (!tile) { pointer.value = {x: worldX, z: worldZ, biome: '正在加载'}; return }
  const pixelX = Math.max(0, Math.min(tile.image.width - 1, Math.floor((worldX - tile.x) / tile.span * tile.image.width)))
  const pixelZ = Math.max(0, Math.min(tile.image.height - 1, Math.floor((worldZ - tile.z) / tile.span * tile.image.height)))
  const biomeId = tile.biomeIds[pixelZ * tile.image.width + pixelX]
  pointer.value = {x: worldX, z: worldZ, biome: biomeId === undefined ? '未知群系' : biomeNames.value.get(biomeId) || '未知群系'}
}
function updateDrag(event: PointerEvent) {
  if (pointers.has(event.pointerId)) pointers.set(event.pointerId, {x: event.clientX, y: event.clientY})
  if (pinch && pointers.size >= 2) {
    const distance = Math.max(1, pointerDistance())
    zoom.value = Math.min(800, Math.max(0, Math.round((pinch.zoom - Math.log2(distance / pinch.distance) * 100) / 25) * 25))
    return
  }
  updatePointer(event)
  if (!drag) return
  drag.offsetX = event.clientX - drag.x; drag.offsetZ = event.clientY - drag.y; drawMap()
}
function endDrag(event?: PointerEvent) {
  if (event) pointers.delete(event.pointerId)
  if (pinch) {
    if (pointers.size >= 2) return
    pinch = undefined; drag = undefined; drawMap(); ensureTiles(); return
  }
  if (!drag) return
  const span = spans.get(viewKey.value)
  if (span) { centerX.value = clampCenter(Math.round(centerX.value - drag.offsetX / viewScale.value)); centerZ.value = clampCenter(Math.round(centerZ.value - drag.offsetZ / viewScale.value)) }
  drag = undefined; drawMap(); ensureTiles()
}
function toggleBiome(id: number) { selectedBiomeIds.value = selectedBiomeIds.value.includes(id) ? selectedBiomeIds.value.filter(value => value !== id) : [...selectedBiomeIds.value, id] }
function resetBiomeFilter() { selectedBiomeIds.value = [] }
function selectFilteredBiomes() { selectedBiomeIds.value = [...new Set([...selectedBiomeIds.value, ...filteredBiomes.value.map(biome => biome.id)])] }

watch(selectedWorld, worldId => { const world = worlds.value.find(item => item.id === worldId); if (world) minecraftVersion.value = world.minecraftVersion })
watch([minecraftVersion, dimension, selectedBiomeIds], () => { if (socket && selectedWorld.value && minecraftVersion.value) resetView() }, {deep: true})
watch(zoom, () => { drawMap(); ensureTiles() })
watch(showChunkLines, drawMap)
onMounted(() => { void loadWorlds(); window.addEventListener('resize', drawMap) })
onBeforeUnmount(() => { disposed = true; if (reconnectTimer) clearTimeout(reconnectTimer); socket?.close(); window.removeEventListener('resize', drawMap) })
</script>

<template>
  <section class="world-map-panel">
    <header class="map-toolbar">
      <div class="map-title">
        <strong>世界地图</strong>
        <small v-if="selected">{{ selected.name }} · {{ minecraftVersion.replace('java_', 'Java ').replaceAll('_', '.') }}</small>
      </div>
      <div class="map-controls">
        <div class="map-selects">
          <BaseSelect v-model="selectedWorld" aria-label="选择世界" :options="worlds.map(world => ({label: world.name, value: world.id}))" />
          <BaseSelect v-model="dimension" aria-label="选择维度" :options="dimensionOptions" />
        </div>
        <button class="biome-trigger" type="button" :aria-label="`群系筛选，已选 ${selectedBiomeIds.length} 项`" @click="biomeDialogOpen = true">群系筛选<b v-if="selectedBiomeIds.length">{{ selectedBiomeIds.length }}</b></button>
        <label class="zoom-control"><span>缩放</span><input v-model.number="zoom" min="0" max="800" step="25" type="number"></label>
        <button class="tool-button" :class="{active: showChunkLines}" type="button" title="显示每 16×16 方块的区块线" @click="showChunkLines = !showChunkLines">区块线</button>
        <button class="tool-button" type="button" @click="resetView">刷新</button>
      </div>
      <i class="socket-status" :class="connectionState"><b />{{ connectionLabel }}</i>
    </header>
    <div v-if="error" class="map-state error"><strong>无法显示世界地图</strong><span>{{ error }}</span></div>
    <div v-else class="map-stage" :aria-busy="loading" @wheel="handleWheel" @pointerdown="startDrag" @pointermove="updateDrag" @pointerup="endDrag" @pointercancel="endDrag" @pointerleave="pointer = undefined"><canvas ref="canvas" class="map-image" aria-label="世界地图" /><p v-if="pointer">{{ pointer.x }}, {{ pointer.z }} · {{ pointer.biome }}</p><p v-else>移动鼠标查看坐标与群系</p></div>
    <BaseDialog :open="biomeDialogOpen" title="群系筛选" size="wide" @close="biomeDialogOpen = false"><div class="biome-dialog-tools"><label><span>搜索</span><input v-model="biomeSearch" type="search" autocomplete="off" placeholder="输入群系名称"></label><span>{{ selectedBiomeIds.length }} 已选</span><button type="button" @click="selectFilteredBiomes">全选当前</button><button type="button" @click="resetBiomeFilter">清空</button></div><div class="biome-options"><label v-for="biome in filteredBiomes" :key="biome.id" :class="{selected: selectedBiomeIds.includes(biome.id)}"><input :checked="selectedBiomeIds.includes(biome.id)" type="checkbox" @change="toggleBiome(biome.id)"><i :style="{backgroundColor: biome.rgb ? `rgb(${biome.rgb.join(', ')})` : '#4e7a47'}" /><span>{{ biome.name }}</span></label><p v-if="!filteredBiomes.length" class="biome-empty">没有匹配的群系</p></div></BaseDialog>
  </section>
</template>

<style scoped>
.world-map-panel { display:flex; flex:1; flex-direction:column; min-height:0; color:var(--panel-text); background:var(--panel-bg); border:1px solid var(--border); border-radius:5px; overflow:hidden; }.biome-dialog-tools { display:flex; align-items:end; gap:7px; margin-bottom:12px; }.biome-dialog-tools label { display:grid; flex:1; gap:4px; color:var(--muted-text); font-size:10px; }.biome-dialog-tools input { width:100%; height:31px; box-sizing:border-box; padding:0 8px; color:var(--panel-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font:inherit; font-size:11px; }.biome-dialog-tools > span { padding-bottom:8px; color:var(--muted-text); font-size:10px; white-space:nowrap; }.biome-options { display:flex; flex-wrap:wrap; max-height:380px; gap:6px; overflow:auto; }.biome-options label { display:flex; align-items:center; gap:5px; min-height:28px; padding:0 9px; color:var(--muted-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font-size:10px; cursor:pointer; transition:border-color .15s ease, background .15s ease, color .15s ease; }.biome-options label:hover { border-color:var(--accent); color:var(--panel-text); }.biome-options label.selected { color:var(--accent-contrast); background:var(--accent); border-color:var(--accent); }.biome-options input { position:absolute; width:1px; height:1px; opacity:0; }.biome-options i { width:7px; height:7px; border-radius:50%; box-shadow:0 0 0 1px rgb(0 0 0 / .16); }.biome-empty { width:100%; margin:30px 0; color:var(--muted-text); text-align:center; font-size:12px; }.map-stage { position:relative; display:grid; flex:1; min-height:360px; overflow:hidden; background:#172116; cursor:grab; touch-action:none; }.map-stage:active { cursor:grabbing; }.map-state { display:grid; place-content:center; gap:6px; min-height:220px; color:var(--muted-text); text-align:center; font-size:12px; }.map-stage > .map-state { position:absolute; inset:0; z-index:2; background:color-mix(in srgb, #172116 82%, transparent); }.map-state.error { color:var(--danger); background:color-mix(in srgb, var(--danger) 6%, var(--panel-bg)); }.map-stage p { position:absolute; right:10px; bottom:0; z-index:2; margin:0; padding:5px 7px; color:#e8f3e5; background:rgb(0 0 0 / .55); border-radius:3px; font-size:10px; pointer-events:none; }.map-nav { position:absolute; bottom:12px; left:14px; z-index:2; display:grid; grid-template-columns:repeat(3, 39px); gap:4px; }.map-nav button { width:39px; padding:0; color:#e8f3e5; background:rgb(0 0 0 / .42); }.map-nav button:first-child { grid-column:2; }.map-nav button:nth-child(2) { grid-column:1; }.map-nav button:nth-child(3) { grid-column:3; }.map-nav button:last-child { grid-column:2; }.map-image { width:100%; height:100%; min-width:0; min-height:0; image-rendering:pixelated; pointer-events:none; }
.map-toolbar { position:relative; display:flex; align-items:center; justify-content:space-between; gap:12px; height:48px; min-height:48px; box-sizing:border-box; padding:0 12px; border-bottom:1px solid var(--border); }
.map-title { display:flex; align-items:center; gap:10px; min-width:0; }.map-title strong { font-size:14px; line-height:1; white-space:nowrap; }.map-title small { color:var(--muted-text); font-size:11px; padding-left:10px; border-left:1px solid var(--border); }
.socket-status { flex-shrink:0; display:flex; align-items:center; gap:5px; color:var(--muted-text); font-style:normal; font-size:10px; white-space:nowrap; }.socket-status b { width:6px; height:6px; background:var(--muted-text); border-radius:50%; }.socket-status.connected { color:var(--success); }.socket-status.connected b { background:var(--success); box-shadow:0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent); }.socket-status.connecting, .socket-status.reconnecting { color:var(--warning); }.socket-status.connecting b, .socket-status.reconnecting b { background:var(--warning); box-shadow:0 0 0 3px color-mix(in srgb, var(--warning) 18%, transparent); }
.map-controls { display:flex; align-items:center; gap:6px; flex:1; justify-content:flex-end; }
.map-selects { display:grid; grid-template-columns:150px 118px; gap:8px; }.map-selects :deep(.base-select) { min-width:0; }.map-selects :deep(.select-trigger) { height:32px; padding:0 10px; background:var(--surface); border:1px solid var(--border); border-radius:4px; font-size:12px; }.map-selects :deep(.select-trigger span) { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.map-selects :deep(.select-trigger:hover), .map-selects :deep(.select-trigger[aria-expanded="true"]) { background:var(--surface-hover); border-color:var(--accent); }
.map-controls .biome-trigger, .map-controls .tool-button { position:relative; height:32px; min-height:32px; padding:0 12px; color:var(--panel-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font-family:inherit; font-size:12px; font-weight:600; line-height:1; white-space:nowrap; transition:background .15s ease, border-color .15s ease, color .15s ease; }.map-controls .biome-trigger:hover, .map-controls .tool-button:hover { color:var(--panel-text); background:var(--surface-hover); border-color:var(--accent); }.map-controls .biome-trigger b { position:absolute; top:-5px; right:-5px; display:grid; min-width:14px; height:14px; place-items:center; color:var(--accent-contrast); background:var(--accent); border-radius:50%; font:700 8px sans-serif; }.map-controls button.active { color:var(--accent-contrast); background:var(--accent); border-color:var(--accent); }
.zoom-control { display:flex; align-items:center; gap:7px; height:32px; box-sizing:border-box; padding:0 4px 0 10px; color:var(--muted-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font-size:11px; white-space:nowrap; }.zoom-control input { width:44px; height:24px; box-sizing:border-box; padding:0 4px; color:var(--panel-text); background:var(--panel-bg); border:0; border-left:1px solid var(--border); text-align:center; font-size:11px; }.zoom-control input:focus { outline:1px solid var(--accent); outline-offset:-1px; }
.map-stage { touch-action:none; }
.biome-dialog-tools { display:grid; grid-template-columns:minmax(0, 1fr) auto auto auto; align-items:end; gap:8px; }.biome-dialog-tools label { min-width:0; font-size:11px; }.biome-dialog-tools input { height:34px; padding:0 10px; font-family:inherit; font-size:12px; }.biome-dialog-tools > span { align-self:center; padding:16px 2px 0; font-size:11px; }.biome-dialog-tools button { height:34px; padding:0 12px; color:var(--panel-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font-family:inherit; font-size:12px; font-weight:600; line-height:1; white-space:nowrap; cursor:pointer; transition:background .15s ease, border-color .15s ease; }.biome-dialog-tools button:hover { background:var(--surface-hover); border-color:var(--accent); }
@media (max-width:1000px) { .map-toolbar { flex-wrap:wrap; height:auto; min-height:0; padding:7px 12px; gap:8px; }.map-controls { flex:1 1 100%; justify-content:flex-start; } }
@media (max-width:760px) { .map-controls { flex-wrap:wrap; }.map-selects { grid-template-columns:1fr; width:100%; gap:6px; }.map-controls .biome-trigger, .map-controls .tool-button, .zoom-control { flex:1 1 auto; justify-content:center; }.biome-dialog-tools { grid-template-columns:1fr 1fr; }.biome-dialog-tools label { grid-column:1 / -1; }.biome-dialog-tools > span { align-self:center; padding:0; }.map-stage { min-height:440px; } }
</style>
