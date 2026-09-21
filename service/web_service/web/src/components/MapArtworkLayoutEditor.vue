<script setup lang="ts">
import {computed, ref, watch} from 'vue'
import {mergeMapCanvases, type MapIcon} from '../utils/mapRenderer'

type Tile = {id: number; map_id: number; pixels_base64: string; icons?: MapIcon[]; group_position_x: number; group_position_y: number; rotation: number; mirror: number | boolean}
const props = defineProps<{tiles: Tile[]; saving?: boolean}>()
const emit = defineEmits<{save: [tiles: Array<{id: number; x: number; y: number; rotation: number; mirror: boolean}>, preview: string]}>()

const layout = ref<Array<{id: number; map_id: number; pixels_base64: string; icons: MapIcon[]; x: number; y: number; rotation: number; mirror: boolean}>>([])
const activeId = ref<number | null>(null)
const draggingId = ref<number | null>(null)
const preview = computed(() => layout.value.length ? mergeMapCanvases(layout.value.map(tile => ({base64: tile.pixels_base64, icons: tile.icons, x: tile.x, y: tile.y, rotation: tile.rotation, mirror: tile.mirror})), 1) : null)
const active = computed(() => layout.value.find(tile => tile.id === activeId.value) || layout.value[0] || null)
const bounds = computed(() => {
  if (!layout.value.length) return null
  const minX = Math.min(...layout.value.map(tile => tile.x)), maxX = Math.max(...layout.value.map(tile => tile.x))
  const minY = Math.min(...layout.value.map(tile => tile.y)), maxY = Math.max(...layout.value.map(tile => tile.y))
  return {minX, minY, width: maxX - minX + 3, height: maxY - minY + 3}
})

function reset() {
  layout.value = props.tiles.map(tile => ({id: tile.id, map_id: tile.map_id, pixels_base64: tile.pixels_base64, icons: tile.icons || [], x: tile.group_position_x, y: tile.group_position_y, rotation: tile.rotation, mirror: Boolean(tile.mirror)}))
  activeId.value = layout.value[0]?.id || null
}
function update(axis: 'x' | 'y', value: string) {
  const tile = active.value, number = Number(value)
  if (!tile || !Number.isInteger(number)) return
  if (layout.value.some(item => item.id !== tile.id && item.x === (axis === 'x' ? number : tile.x) && item.y === (axis === 'y' ? number : tile.y))) return
  tile[axis] = number
}
function rotate(step: number) { if (active.value) active.value.rotation = (active.value.rotation + step + 360) % 360 }
function autoLayout() { layout.value.forEach((tile, index) => { tile.x = index % 6; tile.y = Math.floor(index / 6) }) }
function tileImage(tile: typeof layout.value[number]) { return mergeMapCanvases([{base64: tile.pixels_base64, icons: tile.icons, x: 0, y: 0, rotation: tile.rotation, mirror: tile.mirror}], 1).toDataURL('image/png') }
function tileStyle(tile: typeof layout.value[number]) {
  const value = bounds.value
  return value ? {gridColumn: String(tile.x - value.minX + 2), gridRow: String(tile.y - value.minY + 2)} : {}
}
function dropOn(target: typeof layout.value[number]) {
  const source = layout.value.find(tile => tile.id === draggingId.value)
  draggingId.value = null
  if (!source || source.id === target.id) return
  const position = {x: source.x, y: source.y}
  source.x = target.x; source.y = target.y
  target.x = position.x; target.y = position.y
  activeId.value = source.id
}
function dropAt(event: DragEvent) {
  const source = layout.value.find(tile => tile.id === draggingId.value), value = bounds.value
  draggingId.value = null
  if (!source || !value) return
  const target = event.currentTarget as HTMLElement, rect = target.getBoundingClientRect()
  const x = value.minX + Math.floor((event.clientX - rect.left) / 130) - 1, y = value.minY + Math.floor((event.clientY - rect.top) / 130) - 1
  const occupying = layout.value.find(tile => tile.id !== source.id && tile.x === x && tile.y === y)
  if (occupying) { const position = {x: source.x, y: source.y}; source.x = occupying.x; source.y = occupying.y; occupying.x = position.x; occupying.y = position.y }
  else { source.x = x; source.y = y }
  activeId.value = source.id
}
function save() {
  const canvas = preview.value
  if (!canvas) return
  emit('save', layout.value.map(tile => ({id: tile.id, x: tile.x, y: tile.y, rotation: tile.rotation, mirror: tile.mirror})), canvas.toDataURL('image/png'))
}
watch(() => props.tiles, reset, {immediate: true, deep: true})
</script>

<template>
  <section class="layout-editor">
    <header><div><strong>重新设计图块排版</strong><small>选择图块后调整坐标、旋转或镜像；预览会随即更新。</small></div><button type="button" @click="autoLayout">自动网格</button></header>
    <div class="layout-body">
      <div class="tile-index"><button v-for="tile in layout" :key="tile.id" type="button" :class="{active: activeId === tile.id}" @click="activeId = tile.id"><span>#{{ tile.map_id }}</span><small>{{ tile.x }}, {{ tile.y }}</small></button></div>
      <div class="layout-preview"><div v-if="bounds" class="layout-grid" :style="{gridTemplateColumns: `repeat(${bounds.width}, 128px)`, gridTemplateRows: `repeat(${bounds.height}, 128px)`}" @dragover.prevent @drop.prevent="dropAt"><button v-for="tile in layout" :key="tile.id" :style="tileStyle(tile)" :class="{active: activeId === tile.id, dragging: draggingId === tile.id}" class="layout-tile" draggable="true" type="button" @click="activeId = tile.id" @dragstart="draggingId = tile.id" @dragend="draggingId = null" @dragover.prevent @drop.prevent.stop="dropOn(tile)"><img :src="tileImage(tile)" :alt="`图块 ${tile.map_id}`"/><span>#{{ tile.map_id }}</span></button></div></div>
      <aside v-if="active" class="layout-tools"><strong>图块 #{{ active.map_id }}</strong><label>X<input :value="active.x" type="number" @change="update('x', ($event.target as HTMLInputElement).value)"/></label><label>Y<input :value="active.y" type="number" @change="update('y', ($event.target as HTMLInputElement).value)"/></label><div><button type="button" @click="rotate(-90)">左转</button><button type="button" @click="rotate(90)">右转</button></div><button type="button" :class="{active: active.mirror}" @click="active.mirror = !active.mirror">水平镜像</button></aside>
    </div>
    <footer><button type="button" @click="reset">恢复原排版</button><button class="primary" type="button" :disabled="saving" @click="save">{{ saving ? '保存中...' : '保存排版' }}</button></footer>
  </section>
</template>

<style scoped>
.layout-editor{display:grid;grid-template-rows:auto minmax(0,1fr) auto;min-height:560px;color:var(--panel-text);border:1px solid var(--border);border-radius:5px;overflow:hidden}.layout-editor>header,.layout-editor>footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 14px;background:var(--surface);border-bottom:1px solid var(--border)}.layout-editor>header div{display:grid;gap:2px}.layout-editor strong{font-size:12px}.layout-editor small{color:var(--muted-text);font-size:10px}.layout-editor button{min-height:32px;padding:0 10px;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:4px;font:inherit;font-size:11px;font-weight:700}.layout-editor button:hover,.layout-editor button.active{border-color:var(--accent);background:var(--surface-selected);color:var(--accent)}.layout-body{display:grid;grid-template-areas:'preview' 'tools' 'index';grid-template-columns:minmax(0,1fr);min-height:0;overflow:hidden}.layout-preview{grid-area:preview;min-height:380px;padding:18px;overflow:auto;background:repeating-conic-gradient(#f4f7fb 0 25%,#eaf0f8 0 50%) 50% / 18px 18px}.layout-grid{display:grid;gap:2px;min-width:max-content;min-height:max-content;padding:96px;background:rgb(255 255 255 / .32)}.layout-tile{position:relative;width:128px;min-height:128px;padding:0!important;overflow:hidden;border-radius:0!important;cursor:grab}.layout-tile:active{cursor:grabbing}.layout-tile.dragging{opacity:.42}.layout-tile img{display:block;width:128px;height:128px;image-rendering:pixelated}.layout-tile span{position:absolute;right:3px;bottom:3px;padding:2px 4px;color:#fff;background:rgb(0 0 0 / .58);font-size:9px}.layout-tools{grid-area:tools;display:flex;align-items:end;gap:8px;padding:10px 14px;background:var(--surface);border-top:1px solid var(--border)}.layout-tools>strong{margin-right:auto;align-self:center}.layout-tools label{display:grid;gap:4px;min-width:96px;color:var(--muted-text);font-size:10px;font-weight:700}.layout-tools input{height:32px;padding:0 8px;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:4px;font:inherit}.layout-tools>div{display:flex;gap:6px}.tile-index{grid-area:index;display:flex;gap:6px;max-height:88px;padding:8px 14px;overflow-x:auto;overflow-y:hidden;background:var(--panel-bg);border-top:1px solid var(--border)}.tile-index button{display:grid;flex:0 0 98px;grid-template-columns:auto 1fr;align-items:center;gap:2px 6px;min-height:54px;padding:6px;text-align:left}.tile-index span{font-size:11px}.tile-index small{grid-column:2}.layout-editor>footer{justify-content:flex-end;border-top:1px solid var(--border);border-bottom:0}.layout-editor .primary{color:var(--accent-contrast);background:var(--accent);border-color:var(--accent)}@media(max-width:720px){.layout-editor{min-height:0}.layout-editor>header{align-items:flex-start;flex-direction:column}.layout-preview{min-height:300px;padding:12px}.layout-grid{padding:48px}.layout-tools{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.layout-tools>strong{grid-column:1/-1}.layout-tools>div{justify-content:flex-end}.layout-tools>button{grid-column:1/-1}.tile-index{padding-inline:10px}}
</style>
