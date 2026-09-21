<script setup lang="ts">
import {computed, nextTick, onMounted, ref} from 'vue'
import BaseDialog from '../../components/BaseDialog.vue'
import BaseSelect from '../../components/BaseSelect.vue'
import AdminIcon from '../../components/admin/AdminIcon.vue'
import MapArtworkLayoutEditor from '../../components/MapArtworkLayoutEditor.vue'
import {del, download, get, patch, post} from '../../utils/request'
import {useAlertStore} from '../../stores/alert'
import {useAuthStore} from '../../stores/auth'

type ArtworkStatus = 'draft' | 'pending' | 'published' | 'hidden' | 'rejected'
type Artwork = {
  group_id: string; name: string; price: string; author: string; source_pw: string; description: string
  category: string; tags: string[]; creator_username: string; preview_file: string; visibility: string
  status: ArtworkStatus; moderation_reason: string; moderated_by: string | null; moderated_at: string | null
  view_count: number; like_count: number; tile_count: number; open_reports: number; created_at: string; updated_at: string
}
type Report = {id: number; reporter_username: string; reason: string; created_at: string; resolved_at: string | null; resolved_by: string | null}
type Version = {id: number; revision: number; note: string; created_by: string; created_at: string}
type Tile = {id: number; map_id: number; group_position_x: number; group_position_y: number; rotation: number; mirror: number; frame_x: number; frame_y: number; frame_z: number}
type Summary = {total: number; tiles: number; open_reports: number; views: number; likes: number; statuses: Record<string, number>}
type MosaicRegion = {x: number; y: number; width: number; height: number}

const statusOptions = [
  {label: '全部状态', value: ''}, {label: '待审核', value: 'pending'}, {label: '已发布', value: 'published'},
  {label: '已隐藏', value: 'hidden'}, {label: '已拒绝', value: 'rejected'}, {label: '草稿', value: 'draft'},
]
const visibilityOptions = [{label: '全部可见性', value: ''}, {label: '公开', value: 'public'}, {label: '不公开列出', value: 'unlisted'}, {label: '仅作者', value: 'private'}]
const categoryOptions = [{label: '全部分类', value: ''}, {label: '像素画', value: 'pixel-art'}, {label: '文字', value: 'text'}, {label: '建筑参考', value: 'building'}, {label: '动漫', value: 'anime'}, {label: '标志', value: 'logo'}, {label: '其他', value: 'other'}]
const sortOptions = [{label: '最近更新', value: 'updated'}, {label: '最近创建', value: 'created'}, {label: '举报优先', value: 'reports'}, {label: '浏览最多', value: 'views'}, {label: '收藏最多', value: 'likes'}]
const moderationOptions = [{label: '发布', value: 'published'}, {label: '转待审核', value: 'pending'}, {label: '隐藏', value: 'hidden'}, {label: '拒绝', value: 'rejected'}]
const statusLabels: Record<string, string> = {draft: '草稿', pending: '待审核', published: '已发布', hidden: '已隐藏', rejected: '已拒绝'}
const visibilityLabels: Record<string, string> = {public: '公开', unlisted: '不公开列出', private: '仅作者'}
const categoryLabels: Record<string, string> = {'pixel-art': '像素画', text: '文字', building: '建筑参考', anime: '动漫', logo: '标志', other: '其他'}

const artworks = ref<Artwork[]>([])
const summary = ref<Summary>({total: 0, tiles: 0, open_reports: 0, views: 0, likes: 0, statuses: {}})
const loading = ref(false), loaded = ref(false), keyword = ref(''), status = ref(''), visibility = ref(''), category = ref(''), sort = ref('updated'), reportedOnly = ref(false)
const page = ref(1), totalPages = ref(1), total = ref(0), pageInput = ref('1'), pageLimit = ref('20')
const selected = ref(new Set<string>()), bulkStatus = ref('published'), moderationReason = ref(''), mutating = ref(false)
const detailOpen = ref(false), detailLoading = ref(false), detail = ref<Artwork | null>(null), tiles = ref<Tile[]>([]), reports = ref<Report[]>([]), versions = ref<Version[]>([])
const filtersOpen = ref(true), navOpen = ref(false), detailTab = ref<'overview' | 'reports' | 'tiles' | 'versions'>('overview')
const editOpen = ref(false), editSaving = ref(false)
const layoutOpen = ref(false), layoutSaving = ref(false), layoutTiles = ref<any[]>([])
const edit = ref({name: '', price: '', author: '', description: '', category: 'other', visibility: 'public', status: 'published', tags: ''})
const mosaicOpen = ref(false), mosaicLoading = ref(false), mosaicSaving = ref(false), mosaicCanvas = ref<HTMLCanvasElement | null>(null)
const mosaicRegions = ref<MosaicRegion[]>([]), mosaicStrength = ref(18), mosaicStart = ref<{x: number; y: number} | null>(null)
let mosaicImage: HTMLImageElement | null = null
let loadSerial = 0
const alertStore = useAlertStore(), authStore = useAuthStore()

const selectedCount = computed(() => selected.value.size)
const allSelected = computed(() => artworks.value.length > 0 && artworks.value.every(item => selected.value.has(item.group_id)))
const stats = computed(() => [
  {label: '作品总数', value: summary.value.total, note: `${summary.value.statuses.published || 0} 个已发布`, tone: 'accent'},
  {label: '原始图块', value: summary.value.tiles, note: '存储中的地图数据', tone: 'neutral'},
  {label: '待处理举报', value: summary.value.open_reports, note: '需要管理员确认', tone: summary.value.open_reports ? 'danger' : 'success'},
  {label: '累计浏览', value: summary.value.views, note: `${summary.value.likes} 次收藏`, tone: 'neutral'},
])

function previewUrl(artwork: Artwork) { return `/api/map-shares-preview/${artwork.preview_file}?token=${encodeURIComponent(authStore.resourceToken || '')}&v=${encodeURIComponent(artwork.updated_at || '')}` }
function formatDate(value?: string | null) {
  if (!value) return '未记录'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(date)
}
function shortId(value: string) { return `${value.slice(0, 8)}...${value.slice(-4)}` }
function countStatus(value: string) { return summary.value.statuses[value] || 0 }

async function load(nextPage = 1) {
  const serial = ++loadSerial
  loading.value = true
  try {
    const query = new URLSearchParams({page: String(nextPage), limit: pageLimit.value, sort: sort.value})
    if (keyword.value.trim()) query.set('keyword', keyword.value.trim())
    if (status.value) query.set('status', status.value)
    if (visibility.value) query.set('visibility', visibility.value)
    if (category.value) query.set('category', category.value)
    if (reportedOnly.value) query.set('reported', 'true')
    const result = await get<{artworks: Artwork[]; summary: Summary; pagination: {page: number; total: number; total_pages: number}}>(`/api/admin/map-artworks?${query}`)
    if (serial !== loadSerial) return
    artworks.value = result.artworks
    summary.value = result.summary
    page.value = result.pagination.page
    pageInput.value = String(result.pagination.page)
    total.value = result.pagination.total
    totalPages.value = result.pagination.total_pages
    selected.value = new Set([...selected.value].filter(id => result.artworks.some(item => item.group_id === id)))
    loaded.value = true
  } catch (error) {
    if (serial === loadSerial) alertStore.error('读取地图画管理数据失败', error instanceof Error ? error.message : '请稍后重试')
  } finally { if (serial === loadSerial) loading.value = false }
}
function clearFilters() { keyword.value = ''; status.value = ''; visibility.value = ''; category.value = ''; sort.value = 'updated'; reportedOnly.value = false; void load(1) }
function jumpPage() { const value = Math.min(totalPages.value, Math.max(1, Number(pageInput.value) || 1)); void load(value) }
function toggleAll() { selected.value = allSelected.value ? new Set() : new Set(artworks.value.map(item => item.group_id)) }
function toggleSelected(id: string) { const next = new Set(selected.value); next.has(id) ? next.delete(id) : next.add(id); selected.value = next }

async function openDetail(artwork: Artwork) {
  detailOpen.value = true; detailLoading.value = true; detailTab.value = 'overview'; detail.value = artwork; reports.value = []; versions.value = []; tiles.value = []
  try {
    const result = await get<{group: Artwork; tiles: Tile[]; reports: Report[]; versions: Version[]}>(`/api/admin/map-artworks/${artwork.group_id}`)
    detail.value = result.group; tiles.value = result.tiles; reports.value = result.reports; versions.value = result.versions
  } catch (error) { alertStore.error('作品详情读取失败', error instanceof Error ? error.message : '请稍后重试'); detailOpen.value = false }
  finally { detailLoading.value = false }
}
async function refreshDetail() { if (detail.value) await openDetail(detail.value) }
function openEdit() {
  if (!detail.value) return
  edit.value = {name: detail.value.name, price: detail.value.price, author: detail.value.author, description: detail.value.description || '', category: detail.value.category, visibility: detail.value.visibility, status: detail.value.status, tags: detail.value.tags.join(', ')}
  editOpen.value = true
}
async function saveEdit() {
  if (!detail.value || !edit.value.name.trim() || !edit.value.price.trim() || !edit.value.author.trim()) { alertStore.warning('信息不完整', '名称、价格和作者不能为空。'); return }
  editSaving.value = true
  try {
    await patch(`/api/admin/map-artworks/${detail.value.group_id}`, {...edit.value, name: edit.value.name.trim(), price: edit.value.price.trim(), author: edit.value.author.trim(), description: edit.value.description.trim(), tags: edit.value.tags.split(',').map(tag => tag.trim()).filter(Boolean)})
    editOpen.value = false; await refreshDetail(); await load(page.value); alertStore.success('作品信息已更新')
  } catch (error) { alertStore.error('保存失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { editSaving.value = false }
}
async function openLayoutEditor() {
  if (!detail.value) return
  try {
    const result = await get<{tiles: any[]}>(`/api/map-shares/groups/${detail.value.group_id}/layout`)
    layoutTiles.value = result.tiles
    layoutOpen.value = true
  } catch (error) { alertStore.error('无法打开排版编辑器', error instanceof Error ? error.message : '请稍后重试') }
}
async function saveLayout(layout: Array<{id: number; x: number; y: number; rotation: number; mirror: boolean}>, preview: string) {
  if (!detail.value) return
  layoutSaving.value = true
  try {
    await patch(`/api/map-shares/groups/${detail.value.group_id}/layout`, {tiles: layout, preview_png_base64: preview})
    layoutOpen.value = false; await refreshDetail(); await load(page.value); alertStore.success('图块排版已保存')
  } catch (error) { alertStore.error('图块排版保存失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { layoutSaving.value = false }
}
async function moderate(ids: string[], nextStatus: string) {
  if (!ids.length || mutating.value) return
  if (['hidden', 'rejected'].includes(nextStatus) && !moderationReason.value.trim() && !window.confirm('未填写审核说明，仍然继续？')) return
  mutating.value = true
  try {
    const result = await post<{updated: number; failed: Array<{group_id: string; message: string}>}>('/api/admin/map-artworks/moderate', {group_ids: ids, status: nextStatus, reason: moderationReason.value.trim()})
    moderationReason.value = ''; selected.value = new Set(); await load(page.value)
    if (detail.value && ids.includes(detail.value.group_id)) await refreshDetail()
    result.failed?.length ? alertStore.warning('部分作品未更新', `成功 ${result.updated} 个，失败 ${result.failed.length} 个。`) : alertStore.success('审核状态已更新', `${result.updated} 个作品已设为${statusLabels[nextStatus] || nextStatus}。`)
  } catch (error) { alertStore.error('审核操作失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { mutating.value = false }
}
async function removeArtwork(artwork: Artwork) {
  if (!window.confirm(`永久删除“${artwork.name}”及其 ${artwork.tile_count} 个原始图块？此操作不可恢复。`)) return
  mutating.value = true
  try { await del(`/api/admin/map-artworks/${artwork.group_id}`); if (detail.value?.group_id === artwork.group_id) detailOpen.value = false; await load(page.value); alertStore.success('作品已永久删除') }
  catch (error) { alertStore.error('删除失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { mutating.value = false }
}
async function resolveReport(report: Report, resolved: boolean) {
  try { await patch(`/api/admin/map-artworks/reports/${report.id}`, {resolved}); await refreshDetail(); await load(page.value); alertStore.success(resolved ? '举报已标记为处理完成' : '举报已重新打开') }
  catch (error) { alertStore.error('举报状态更新失败', error instanceof Error ? error.message : '请稍后重试') }
}
function exportArtwork() { if (detail.value) void download(`/api/map-shares/groups/${detail.value.group_id}/export`, `map-artwork-${detail.value.group_id}.json`).catch(error => alertStore.error('导出失败', error instanceof Error ? error.message : '请稍后重试')) }

function renderMosaic() {
  const canvas = mosaicCanvas.value
  if (!canvas || !mosaicImage) return
  const context = canvas.getContext('2d')!
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = false
  context.drawImage(mosaicImage, 0, 0, canvas.width, canvas.height)
  for (const region of mosaicRegions.value) {
    const width = Math.max(1, Math.round(region.width)), height = Math.max(1, Math.round(region.height))
    const columns = Math.max(1, Math.ceil(width / mosaicStrength.value)), rows = Math.max(1, Math.ceil(height / mosaicStrength.value))
    const sample = document.createElement('canvas')
    sample.width = columns; sample.height = rows
    const sampleContext = sample.getContext('2d')!
    sampleContext.imageSmoothingEnabled = true
    sampleContext.drawImage(mosaicImage, region.x, region.y, width, height, 0, 0, columns, rows)
    context.imageSmoothingEnabled = false
    context.drawImage(sample, 0, 0, columns, rows, region.x, region.y, width, height)
  }
  context.save()
  context.strokeStyle = 'rgba(255,255,255,.95)'; context.lineWidth = Math.max(1, canvas.width / 600); context.setLineDash([7, 5])
  context.fillStyle = 'rgba(239,68,68,.12)'
  for (const region of mosaicRegions.value) { context.fillRect(region.x, region.y, region.width, region.height); context.strokeRect(region.x, region.y, region.width, region.height) }
  context.restore()
}
function mosaicPoint(event: PointerEvent) {
  const canvas = mosaicCanvas.value
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  return {x: Math.max(0, Math.min(canvas.width, Math.round((event.clientX - rect.left) * canvas.width / rect.width))), y: Math.max(0, Math.min(canvas.height, Math.round((event.clientY - rect.top) * canvas.height / rect.height)))}
}
async function openMosaic() {
  if (!detail.value) return
  mosaicOpen.value = true; mosaicLoading.value = true; mosaicRegions.value = []; mosaicStart.value = null
  await nextTick()
  const image = new Image()
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('预览图加载失败')); image.src = `${previewUrl(detail.value!)}&edit=${Date.now()}` })
    mosaicImage = image
    const canvas = mosaicCanvas.value
    if (!canvas) return
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    renderMosaic()
  } catch (error) { mosaicOpen.value = false; alertStore.error('无法打开打码编辑器', error instanceof Error ? error.message : '预览图加载失败') }
  finally { mosaicLoading.value = false }
}
function startMosaic(event: PointerEvent) {
  if (mosaicLoading.value || mosaicSaving.value) return
  const point = mosaicPoint(event); if (!point) return
  mosaicStart.value = point
  mosaicRegions.value = [...mosaicRegions.value, {...point, width: 1, height: 1}]
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  renderMosaic()
}
function moveMosaic(event: PointerEvent) {
  const start = mosaicStart.value, point = mosaicPoint(event)
  if (!start || !point) return
  const region = {x: Math.min(start.x, point.x), y: Math.min(start.y, point.y), width: Math.max(1, Math.abs(point.x - start.x)), height: Math.max(1, Math.abs(point.y - start.y))}
  mosaicRegions.value = [...mosaicRegions.value.slice(0, -1), region]
  renderMosaic()
}
function finishMosaic(event: PointerEvent) {
  if (!mosaicStart.value) return
  mosaicStart.value = null
  if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
  renderMosaic()
}
function undoMosaic() { mosaicRegions.value = mosaicRegions.value.slice(0, -1); renderMosaic() }
function clearMosaic() { mosaicRegions.value = []; renderMosaic() }
async function saveMosaic() {
  if (!detail.value || !mosaicCanvas.value || !mosaicRegions.value.length) return
  mosaicSaving.value = true
  try {
    renderMosaic()
    const canvas = mosaicCanvas.value
    const context = canvas.getContext('2d')!
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(mosaicImage!, 0, 0, canvas.width, canvas.height)
    for (const region of mosaicRegions.value) {
      const columns = Math.max(1, Math.ceil(region.width / mosaicStrength.value)), rows = Math.max(1, Math.ceil(region.height / mosaicStrength.value))
      const sample = document.createElement('canvas'); sample.width = columns; sample.height = rows
      const sampleContext = sample.getContext('2d')!; sampleContext.drawImage(mosaicImage!, region.x, region.y, region.width, region.height, 0, 0, columns, rows)
      context.imageSmoothingEnabled = false; context.drawImage(sample, 0, 0, columns, rows, region.x, region.y, region.width, region.height)
    }
    const png = canvas.toDataURL('image/png')
    await post(`/api/admin/map-artworks/${detail.value.group_id}/mosaic`, {preview_png_base64: png, region_count: mosaicRegions.value.length})
    mosaicOpen.value = false; await refreshDetail(); await load(page.value); alertStore.success('预览图打码已保存', `${mosaicRegions.value.length} 个区域已处理，原预览已备份。`)
  } catch (error) { renderMosaic(); alertStore.error('打码保存失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { mosaicSaving.value = false }
}

onMounted(() => void load())
</script>

<template>
  <main class="map-admin">
    <div class="share-nav-shell" :class="{'is-open': navOpen}">
      <aside class="share-nav" aria-label="玩家分享管理分类">
        <button class="share-nav-toggle" type="button" :aria-expanded="navOpen" :aria-label="navOpen ? '收起玩家分享导航' : '打开玩家分享导航'" @click="navOpen = !navOpen"><span aria-hidden="true">{{ navOpen ? '‹' : '›' }}</span></button>
        <button class="share-nav-item active" type="button" @click="navOpen = false"><span class="share-nav-icon"><AdminIcon name="share"/></span><span>地图画分享</span></button>
      </aside>
    </div>
    <section class="workspace">
      <header class="share-toolbar">
        <div class="share-summary"><span class="status-dot" :class="{loading}"/><div><strong>玩家分享管理</strong><span>{{ loading ? '正在刷新作品档案' : `共 ${total} 个作品` }}</span></div></div>
        <form class="toolbar-search" @submit.prevent="load(1)"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><input v-model="keyword" autocomplete="off" placeholder="搜索名称、作者、添加者、来源或作品 ID"/><kbd v-if="total">{{ total }}</kbd></form>
        <button class="toolbar-button" :class="{active: filtersOpen}" type="button" @click="filtersOpen = !filtersOpen"><span>筛选</span><b>{{ filtersOpen ? '−' : '+' }}</b></button>
        <RouterLink class="archive-link" to="/shares"><AdminIcon name="share" /><span>玩家档案</span></RouterLink>
        <button class="refresh-button" :class="{syncing: loading}" :disabled="loading" type="button" aria-label="刷新作品列表" @click="load(page)">↻</button>
      </header>

      <Transition name="filter-slide">
        <section v-if="filtersOpen" class="filter-strip">
          <BaseSelect v-model="status" :options="statusOptions" aria-label="状态" @update:model-value="load(1)" />
          <BaseSelect v-model="visibility" :options="visibilityOptions" aria-label="可见性" @update:model-value="load(1)" />
          <BaseSelect v-model="category" :options="categoryOptions" aria-label="分类" @update:model-value="load(1)" />
          <BaseSelect v-model="sort" :options="sortOptions" aria-label="排序" @update:model-value="load(1)" />
          <label class="reported-toggle"><input v-model="reportedOnly" type="checkbox" @change="load(1)"/><span>仅待处理举报</span><b>{{ summary.open_reports }}</b></label>
          <button class="filter-action" type="button" @click="load(1)">应用筛选</button><button class="filter-action muted" type="button" @click="clearFilters">清空</button>
        </section>
      </Transition>

      <div class="stats-line" aria-label="地图画统计"><span v-for="item in stats" :key="item.label" :class="`tone-${item.tone}`">{{ item.label }} <strong>{{ item.value.toLocaleString() }}</strong><small>{{ item.note }}</small></span></div>
      <div class="status-strip"><button v-for="option in statusOptions.slice(1)" :key="option.value" :class="{active: status === option.value}" type="button" @click="status = status === option.value ? '' : option.value; load(1)"><span>{{ option.label }}</span><b>{{ countStatus(option.value) }}</b></button></div>

      <div class="bulk-bar" :class="{active: selectedCount}">
        <label><input :checked="allSelected" type="checkbox" @change="toggleAll"/><span>{{ selectedCount ? `已选择 ${selectedCount} 个作品` : '选择当前页' }}</span></label>
        <template v-if="selectedCount"><BaseSelect v-model="bulkStatus" :options="moderationOptions" aria-label="批量审核状态"/><input v-model="moderationReason" maxlength="500" placeholder="审核说明，隐藏或拒绝时建议填写"/><button class="primary" :disabled="mutating" type="button" @click="moderate([...selected], bulkStatus)">应用审核</button></template>
        <span v-else class="result-count">筛选结果 {{ total }} 个</span>
      </div>

      <div class="artwork-scroll">
        <div v-if="loading && !loaded" class="page-state"><span class="loader"/><strong>正在建立地图画索引</strong><small>读取作品、图块与审核记录</small></div>
        <div v-else-if="!artworks.length" class="page-state"><span class="empty-code">NO MATCH</span><strong>没有符合条件的作品</strong><small>调整筛选条件或等待玩家提交新的地图画。</small></div>
        <section v-else class="artwork-list" :class="{refreshing: loading}">
          <article v-for="artwork in artworks" :key="artwork.group_id" :class="{selected: selected.has(artwork.group_id), reported: artwork.open_reports}">
          <label class="row-check"><input :checked="selected.has(artwork.group_id)" type="checkbox" :aria-label="`选择 ${artwork.name}`" @change="toggleSelected(artwork.group_id)"/></label>
          <button class="preview" type="button" @click="openDetail(artwork)"><img :src="previewUrl(artwork)" :alt="artwork.name"/><span>{{ artwork.tile_count }} TILES</span></button>
          <div class="artwork-main">
            <header><div><span :class="`status status-${artwork.status}`">{{ statusLabels[artwork.status] }}</span><span v-if="artwork.open_reports" class="report-badge">{{ artwork.open_reports }} 条举报</span></div><time>{{ formatDate(artwork.updated_at) }}</time></header>
            <button class="title-button" type="button" @click="openDetail(artwork)"><strong>{{ artwork.name }}</strong><code>{{ shortId(artwork.group_id) }}</code></button>
            <p>{{ artwork.description || '暂无作品说明' }}</p>
            <dl><div><dt>作者</dt><dd>{{ artwork.author }}</dd></div><div><dt>添加者</dt><dd>{{ artwork.creator_username }}</dd></div><div><dt>来源</dt><dd>{{ artwork.source_pw }}</dd></div><div><dt>分类</dt><dd>{{ categoryLabels[artwork.category] || artwork.category }}</dd></div></dl>
            <footer><span>{{ visibilityLabels[artwork.visibility] || artwork.visibility }}</span><span>{{ artwork.view_count }} 浏览</span><span>{{ artwork.like_count }} 收藏</span><span v-if="artwork.moderated_by">审核：{{ artwork.moderated_by }}</span></footer>
          </div>
          <div class="row-actions"><button type="button" @click="openDetail(artwork)">详情</button><button v-if="artwork.status !== 'published'" class="success" :disabled="mutating" type="button" @click="moderate([artwork.group_id], 'published')">发布</button><button v-if="artwork.status !== 'hidden'" :disabled="mutating" type="button" @click="moderate([artwork.group_id], 'hidden')">隐藏</button><button class="danger" :disabled="mutating" type="button" @click="removeArtwork(artwork)">删除</button></div>
          </article>
        </section>
      </div>

      <footer class="pagination"><span>第 {{ page }} / {{ totalPages }} 页 · 共 {{ total }} 项</span><div><BaseSelect v-model="pageLimit" :options="[{label: '20 / 页', value: '20'}, {label: '50 / 页', value: '50'}, {label: '100 / 页', value: '100'}]" aria-label="每页数量" @update:model-value="load(1)"/><button :disabled="page <= 1 || loading" @click="load(page - 1)">上一页</button><input v-model="pageInput" aria-label="页码" @keydown.enter="jumpPage"/><button :disabled="page >= totalPages || loading" @click="load(page + 1)">下一页</button></div></footer>
    </section>

    <BaseDialog :open="detailOpen" size="large" :title="detail?.name || '作品详情'" @close="detailOpen = false">
      <div v-if="detailLoading" class="dialog-state"><span class="loader"/>读取完整作品记录...</div>
      <div v-else-if="detail" class="detail-workspace">
        <header class="detail-head"><div><span :class="`status status-${detail.status}`">{{ statusLabels[detail.status] }}</span><span class="visibility-pill">{{ visibilityLabels[detail.visibility] }}</span><strong>{{ detail.name }}</strong><code>{{ detail.group_id }}</code></div><dl><div><dt>图块</dt><dd>{{ detail.tile_count }}</dd></div><div><dt>浏览</dt><dd>{{ detail.view_count }}</dd></div><div><dt>收藏</dt><dd>{{ detail.like_count }}</dd></div></dl><nav><button :class="{active: detailTab === 'overview'}" @click="detailTab = 'overview'">概览</button><button :class="{active: detailTab === 'reports'}" @click="detailTab = 'reports'">举报 {{ reports.length }}</button><button :class="{active: detailTab === 'tiles'}" @click="detailTab = 'tiles'">图块 {{ tiles.length }}</button><button :class="{active: detailTab === 'versions'}" @click="detailTab = 'versions'">版本 {{ versions.length }}</button></nav></header>
        <div class="detail-columns">
          <aside class="detail-visual"><div class="detail-preview"><img :src="previewUrl(detail)" :alt="detail.name"/><span>{{ detail.tile_count }} 个图块</span></div><div class="detail-actions"><button class="primary" @click="openEdit">编辑信息</button><button @click="openLayoutEditor">重新设计排版</button><button class="mosaic-button" @click="openMosaic">区域打码</button><button @click="exportArtwork">导出 JSON</button><button class="danger" @click="removeArtwork(detail)">永久删除</button></div><dl class="audit-meta"><div><dt>创建时间</dt><dd>{{ formatDate(detail.created_at) }}</dd></div><div><dt>最近更新</dt><dd>{{ formatDate(detail.updated_at) }}</dd></div><div><dt>审核人</dt><dd>{{ detail.moderated_by || '尚未审核' }}</dd></div></dl></aside>
          <section class="detail-content">
            <template v-if="detailTab === 'overview'"><div class="detail-heading"><h2>{{ detail.name }}</h2><p>{{ detail.description || '暂无作品说明' }}</p></div><div class="detail-facts"><div><span>作者</span><strong>{{ detail.author }}</strong></div><div><span>添加者</span><strong>{{ detail.creator_username }}</strong></div><div><span>标价</span><strong>{{ detail.price }}</strong></div><div><span>来源</span><strong>{{ detail.source_pw }}</strong></div><div><span>分类</span><strong>{{ categoryLabels[detail.category] || detail.category }}</strong></div><div><span>可见性</span><strong>{{ visibilityLabels[detail.visibility] }}</strong></div></div><section class="moderation-card"><header><div><strong>审核控制</strong><small>操作会写入版本审计历史</small></div></header><textarea v-model="moderationReason" maxlength="500" placeholder="填写本次审核说明"></textarea><div><button v-for="option in moderationOptions" :key="option.value" :class="{primary: option.value === 'published', danger: option.value === 'rejected'}" :disabled="mutating || detail.status === option.value" @click="moderate([detail.group_id], option.value)">{{ option.label }}</button></div><p v-if="detail.moderation_reason">上次审核说明：{{ detail.moderation_reason }}</p></section></template>
            <section v-else-if="detailTab === 'reports'" class="detail-section"><header><h3>举报记录</h3><span>{{ reports.filter(item => !item.resolved_at).length }} 条待处理</span></header><p v-if="!reports.length" class="empty-line">该作品没有举报记录。</p><article v-for="report in reports" :key="report.id" class="report-row" :class="{resolved: report.resolved_at}"><div><strong>{{ report.reporter_username }}</strong><time>{{ formatDate(report.created_at) }}</time><p>{{ report.reason }}</p></div><button @click="resolveReport(report, !report.resolved_at)">{{ report.resolved_at ? '重新打开' : '标记处理' }}</button></article></section>
            <section v-else-if="detailTab === 'tiles'" class="detail-section"><header><h3>图块检查</h3><span>{{ tiles.length }} 项</span></header><div class="tile-grid"><article v-for="tile in tiles" :key="tile.id"><strong>#{{ tile.map_id }}</strong><span>组合 {{ tile.group_position_x }}, {{ tile.group_position_y }}</span><small>展示框 {{ tile.frame_x }}, {{ tile.frame_y }}, {{ tile.frame_z }}</small><small>{{ tile.rotation }}° · {{ tile.mirror ? '镜像' : '原向' }}</small></article></div></section>
            <section v-else class="detail-section"><header><h3>版本审计</h3><span>{{ versions.length }} 个版本</span></header><div class="version-list"><div v-for="version in versions" :key="version.id"><b>r{{ version.revision }}</b><span><strong>{{ version.note }}</strong><small>{{ version.created_by }} · {{ formatDate(version.created_at) }}</small></span></div></div></section>
          </section>
        </div>
      </div>
    </BaseDialog>

    <BaseDialog :open="layoutOpen" size="large" title="重新设计地图画排版" :dismissible="!layoutSaving" @close="!layoutSaving && (layoutOpen = false)">
      <MapArtworkLayoutEditor :tiles="layoutTiles" :saving="layoutSaving" @save="saveLayout" />
    </BaseDialog>

    <BaseDialog :open="mosaicOpen" size="large" title="预览图区域打码" :dismissible="!mosaicSaving" @close="!mosaicSaving && (mosaicOpen = false)">
      <div class="mosaic-editor">
        <header class="mosaic-toolbar">
          <div><span class="tool-kicker">REDACTION WORKSPACE</span><strong>拖动框选需要隐藏的区域</strong><small>仅处理公开预览图，不修改 Minecraft 地图原始数据。</small></div>
          <label><span>像素块强度</span><input v-model.number="mosaicStrength" type="range" min="6" max="48" step="2" @input="renderMosaic"/><b>{{ mosaicStrength }} px</b></label>
          <div class="mosaic-tools"><button :disabled="!mosaicRegions.length || mosaicSaving" type="button" @click="undoMosaic">撤销</button><button :disabled="!mosaicRegions.length || mosaicSaving" type="button" @click="clearMosaic">清空</button></div>
        </header>
        <section class="mosaic-stage">
          <div v-if="mosaicLoading" class="mosaic-loading"><span class="loader"/>正在准备高分辨率预览...</div>
          <canvas v-show="!mosaicLoading" ref="mosaicCanvas" aria-label="地图画打码画布" @pointerdown="startMosaic" @pointermove="moveMosaic" @pointerup="finishMosaic" @pointercancel="finishMosaic"/>
        </section>
        <footer class="mosaic-footer"><div><strong>{{ mosaicRegions.length }}</strong><span>个打码区域</span><small>保存后原图会进入服务器备份历史</small></div><div><button :disabled="mosaicSaving" type="button" @click="mosaicOpen = false">取消</button><button class="primary" :disabled="mosaicSaving || !mosaicRegions.length" type="button" @click="saveMosaic">{{ mosaicSaving ? '正在安全保存...' : '保存打码预览' }}</button></div></footer>
      </div>
    </BaseDialog>

    <BaseDialog :open="editOpen" title="编辑地图画信息" size="wide" :dismissible="!editSaving" @close="!editSaving && (editOpen = false)">
      <form class="edit-form" @submit.prevent="saveEdit"><div class="field-grid"><label><span>名称</span><input v-model="edit.name" maxlength="128" required/></label><label><span>价格</span><input v-model="edit.price" maxlength="64" required/></label><label><span>作者</span><input v-model="edit.author" maxlength="256" required/></label><label><span>标签</span><input v-model="edit.tags" maxlength="249" placeholder="使用逗号分隔，最多 10 个"/></label><label><span>分类</span><BaseSelect v-model="edit.category" :options="categoryOptions.slice(1)"/></label><label><span>可见性</span><BaseSelect v-model="edit.visibility" :options="visibilityOptions.slice(1)"/></label><label><span>状态</span><BaseSelect v-model="edit.status" :options="statusOptions.slice(1)"/></label></div><label><span>作品说明</span><textarea v-model="edit.description" maxlength="1000" rows="5"></textarea></label><footer><button type="button" @click="editOpen = false">取消</button><button class="primary" :disabled="editSaving" type="submit">{{ editSaving ? '保存中...' : '保存修改' }}</button></footer></form>
    </BaseDialog>
  </main>
</template>

<style scoped>
.map-admin{width:100%;min-height:100vh;padding:80px 0 48px;color:var(--panel-text)}button,input,textarea{font:inherit}.page-header{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-bottom:22px}.eyebrow{display:block;margin-bottom:6px;color:var(--accent);font-size:10px;font-weight:800;letter-spacing:.18em}.page-header h1{margin:0;font-size:25px;letter-spacing:-.04em}.page-header p{margin:5px 0 0;color:var(--muted-text);font-size:13px}.archive-link{display:flex;align-items:center;gap:7px;padding:8px 12px;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:5px;font-size:12px;font-weight:700}.archive-link:hover{border-color:var(--accent)}.archive-link :deep(svg){font-size:14px}.stat-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-bottom:14px}.stat-grid article{position:relative;display:grid;gap:5px;min-height:112px;padding:17px 18px;overflow:hidden;background:color-mix(in srgb,var(--panel-bg) 76%,transparent);border:1px solid var(--border);border-radius:5px}.stat-grid article:before{position:absolute;inset:0 auto 0 0;width:3px;background:var(--border);content:""}.stat-grid .tone-accent:before{background:var(--accent)}.stat-grid .tone-danger:before{background:var(--danger)}.stat-grid .tone-success:before{background:var(--success)}.stat-grid span{color:var(--muted-text);font-size:11px;font-weight:700}.stat-grid strong{font-size:28px;line-height:1}.stat-grid small{color:var(--muted-text);font-size:11px}.workspace{overflow:hidden;background:color-mix(in srgb,var(--panel-bg) 82%,transparent);border:1px solid var(--border);border-radius:5px;box-shadow:0 16px 42px color-mix(in srgb,var(--shadow) 18%,transparent)}.filter-panel{padding:14px 16px 0;border-bottom:1px solid var(--border)}.search-row{display:flex;gap:7px}.search-box{display:flex;flex:1;align-items:center;gap:8px;min-width:180px;padding:0 10px;background:var(--surface);border:1px solid var(--border);border-radius:4px}.search-box:focus-within{border-color:var(--accent)}.search-box svg{width:15px;fill:none;stroke:var(--muted-text);stroke-width:2}.search-box input{width:100%;height:34px;padding:0;color:var(--panel-text);background:transparent;border:0;outline:0}.search-row button,.bulk-bar button,.row-actions button,.detail-actions button,.moderation-card button,.report-row button,.pagination button,.edit-form button{min-height:34px;padding:0 12px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:12px;font-weight:700}.primary{color:var(--accent-contrast)!important;background:var(--accent)!important;border-color:var(--accent)!important}.danger{color:var(--danger)!important}.success{color:var(--success-text)!important}.filters{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr)) auto;gap:7px;margin-top:9px}.reported-toggle{display:flex;align-items:center;gap:7px;min-height:34px;padding:0 9px;background:var(--surface);border:1px solid var(--border);border-radius:4px;color:var(--muted-text);font-size:11px;white-space:nowrap}.reported-toggle b{min-width:20px;padding:2px 5px;margin-left:auto;color:var(--danger);background:color-mix(in srgb,var(--danger) 10%,transparent);border-radius:3px;text-align:center}.status-strip{display:flex;gap:0;margin-top:12px;overflow-x:auto}.status-strip button{display:flex;align-items:center;gap:7px;padding:9px 12px;color:var(--muted-text);background:transparent;border:0;border-bottom:2px solid transparent;font-size:11px}.status-strip button.active{color:var(--accent);border-bottom-color:var(--accent)}.status-strip b{font-size:10px}.bulk-bar{display:flex;align-items:center;gap:8px;min-height:52px;padding:8px 16px;background:color-mix(in srgb,var(--surface) 50%,transparent);border-bottom:1px solid var(--border)}.bulk-bar.active{background:color-mix(in srgb,var(--accent-soft) 42%,transparent)}.bulk-bar>label{display:flex;align-items:center;gap:8px;min-width:145px;font-size:12px;font-weight:700}.bulk-bar>input{flex:1;min-width:180px;height:34px;padding:0 10px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:4px}.result-count{margin-left:auto;color:var(--muted-text);font-size:11px}.artwork-list{display:grid;transition:opacity .2s}.artwork-list.refreshing{opacity:.55;pointer-events:none}.artwork-list>article{position:relative;display:grid;grid-template-columns:26px 112px minmax(0,1fr) auto;gap:14px;min-height:142px;padding:14px 16px;border-bottom:1px solid var(--border);transition:background-color .15s}.artwork-list>article:last-child{border-bottom:0}.artwork-list>article:hover,.artwork-list>article.selected{background:color-mix(in srgb,var(--surface-hover) 56%,transparent)}.artwork-list>article.reported{box-shadow:inset 3px 0 var(--danger)}.row-check{padding-top:4px}.preview{position:relative;width:112px;height:112px;padding:0;overflow:hidden;background:var(--surface);border:1px solid var(--border);border-radius:4px}.preview img{width:100%;height:100%;object-fit:contain;image-rendering:pixelated}.preview span{position:absolute;right:4px;bottom:4px;padding:3px 5px;color:#fff;background:#111c;border-radius:3px;font-size:8px;font-weight:800;letter-spacing:.08em}.artwork-main{display:grid;align-content:start;gap:7px;min-width:0}.artwork-main>header{display:flex;align-items:center;justify-content:space-between;gap:10px}.artwork-main>header>div{display:flex;gap:5px}.artwork-main time{color:var(--muted-text);font-size:10px}.status,.visibility-pill,.report-badge{display:inline-flex;padding:3px 7px;border-radius:3px;font-size:9px;font-weight:800;letter-spacing:.05em}.status-published{color:var(--success-text);background:var(--success-soft)}.status-pending{color:var(--warning-text);background:var(--warning-soft)}.status-hidden{color:var(--muted-text);background:var(--surface)}.status-rejected{color:var(--danger);background:color-mix(in srgb,var(--danger) 11%,transparent)}.status-draft{color:var(--muted-text);background:var(--surface)}.report-badge{color:var(--danger);background:color-mix(in srgb,var(--danger) 11%,transparent)}.title-button{display:flex;align-items:baseline;gap:10px;width:max-content;max-width:100%;padding:0;color:var(--panel-text);background:none;border:0;text-align:left}.title-button strong{overflow:hidden;font-size:16px;text-overflow:ellipsis;white-space:nowrap}.title-button code{color:var(--muted-text);font-size:9px}.artwork-main>p{display:-webkit-box;overflow:hidden;margin:0;color:var(--muted-text);font-size:11px;line-height:1.45;-webkit-box-orient:vertical;-webkit-line-clamp:1}.artwork-main dl{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0}.artwork-main dl div{min-width:0}.artwork-main dt{color:var(--muted-text);font-size:9px}.artwork-main dd{overflow:hidden;margin:2px 0 0;font-size:11px;font-weight:650;text-overflow:ellipsis;white-space:nowrap}.artwork-main footer{display:flex;gap:12px;color:var(--muted-text);font-size:10px}.row-actions{display:flex;flex-direction:column;justify-content:center;gap:6px;width:64px}.row-actions button{min-height:28px;padding:0 8px}.page-state,.dialog-state{display:grid;place-items:center;align-content:center;gap:8px;min-height:280px;color:var(--muted-text);font-size:12px}.page-state strong{color:var(--panel-text);font-size:14px}.page-state small{font-size:11px}.empty-code{color:var(--accent);font-size:10px;font-weight:900;letter-spacing:.16em}.loader{width:22px;height:22px;border:2px solid color-mix(in srgb,var(--accent) 20%,transparent);border-top-color:var(--accent);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.pagination{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:54px;padding:9px 16px;border-top:1px solid var(--border);color:var(--muted-text);font-size:11px}.pagination>div{display:flex;align-items:center;gap:6px}.pagination input{width:42px;height:34px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:4px;text-align:center}.detail-layout{display:grid;grid-template-columns:280px minmax(0,1fr);gap:20px;width:100%;min-height:0}.detail-visual{display:flex;flex-direction:column;gap:12px}.detail-preview{position:relative;display:grid;place-items:center;min-height:270px;padding:12px;background:repeating-conic-gradient(color-mix(in srgb,var(--surface) 75%,transparent) 0 25%,transparent 0 50%) 0/18px 18px;border:1px solid var(--border);border-radius:4px}.detail-preview img{max-width:100%;max-height:340px;image-rendering:pixelated}.detail-preview span{position:absolute;right:8px;bottom:8px;padding:4px 7px;color:#fff;background:#111d;border-radius:3px;font-size:9px;font-weight:800}.detail-actions{display:grid;grid-template-columns:1fr 1fr;gap:6px}.detail-actions .danger{grid-column:1/-1}.audit-meta{display:grid;gap:0;margin:0;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:4px}.audit-meta div{padding:8px 0;border-bottom:1px solid var(--border)}.audit-meta div:last-child{border:0}.audit-meta dt{color:var(--muted-text);font-size:9px}.audit-meta dd{margin:3px 0 0;overflow-wrap:anywhere;font-size:10px}.detail-content{min-width:0;overflow-y:auto;padding-right:4px}.detail-heading>div{display:flex;gap:6px}.visibility-pill{color:var(--accent);background:var(--accent-soft)}.detail-heading h2{margin:10px 0 5px;font-size:22px;letter-spacing:-.035em}.detail-heading p{margin:0;color:var(--muted-text);font-size:12px;line-height:1.6}.detail-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:16px 0}.detail-facts div{display:grid;gap:4px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:4px}.detail-facts span{color:var(--muted-text);font-size:9px}.detail-facts strong{overflow:hidden;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.moderation-card{padding:13px;background:color-mix(in srgb,var(--accent-soft) 28%,transparent);border:1px solid color-mix(in srgb,var(--accent) 32%,var(--border));border-radius:4px}.moderation-card header{display:flex;justify-content:space-between}.moderation-card header div{display:grid;gap:2px}.moderation-card header small{color:var(--muted-text);font-size:9px}.moderation-card textarea{width:100%;height:58px;margin:10px 0 7px;padding:8px;resize:vertical;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:4px;font-size:11px}.moderation-card>div{display:flex;gap:6px}.moderation-card p{margin:8px 0 0;color:var(--muted-text);font-size:10px}.detail-section{margin-top:17px}.detail-section>header{display:flex;align-items:center;justify-content:space-between;padding-bottom:7px;border-bottom:1px solid var(--border)}.detail-section h3{margin:0;font-size:12px}.detail-section>header span{color:var(--muted-text);font-size:9px}.empty-line{color:var(--muted-text);font-size:11px}.report-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)}.report-row.resolved{opacity:.58}.report-row>div{min-width:0}.report-row strong{font-size:11px}.report-row time{margin-left:8px;color:var(--muted-text);font-size:9px}.report-row p{margin:4px 0 0;font-size:11px}.report-row button{flex:none}.tile-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;margin-top:8px}.tile-grid article{display:grid;gap:3px;padding:9px;background:var(--surface);border:1px solid var(--border);border-radius:4px}.tile-grid strong{font-size:11px}.tile-grid span,.tile-grid small{color:var(--muted-text);font-size:9px}.version-list{display:grid}.version-list>div{display:flex;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)}.version-list b{color:var(--accent);font-size:10px}.version-list span{display:grid;gap:2px}.version-list strong{font-size:10px}.version-list small{color:var(--muted-text);font-size:9px}.edit-form{display:grid;gap:14px}.field-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.edit-form label{display:grid;gap:5px}.edit-form label>span{color:var(--muted-text);font-size:10px;font-weight:700}.edit-form input,.edit-form textarea{width:100%;padding:8px 9px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:4px}.edit-form footer{display:flex;justify-content:flex-end;gap:7px}.edit-form button{min-height:34px}
.stat-grid article i{position:absolute;top:11px;right:13px;color:color-mix(in srgb,var(--muted-text) 22%,transparent);font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:22px;font-style:normal;font-weight:900}.stat-grid article:hover{border-color:color-mix(in srgb,var(--accent) 48%,var(--border));transform:translateY(-2px)}.stat-grid article,.preview,.archive-link,.row-actions button{transition:transform .18s ease,border-color .18s ease,background-color .18s ease}.preview:hover{border-color:var(--accent);transform:translateY(-2px)}.row-actions button:hover,.detail-actions button:hover,.moderation-card button:hover{border-color:var(--accent);background:var(--surface-hover)}.mosaic-button{color:var(--warning-text)!important;background:var(--warning-soft)!important;border-color:color-mix(in srgb,var(--warning) 38%,var(--border))!important}.mosaic-editor{display:flex;flex-direction:column;width:100%;min-height:0;background:#111318;border:1px solid #2b3039;border-radius:5px;overflow:hidden}.mosaic-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) minmax(220px,.7fr) auto;align-items:center;gap:20px;padding:14px 16px;color:#edf0f5;background:#171a20;border-bottom:1px solid #2b3039}.mosaic-toolbar>div:first-child{display:grid;gap:3px}.tool-kicker{color:#f0a14a;font-size:8px;font-weight:900;letter-spacing:.16em}.mosaic-toolbar strong{font-size:13px}.mosaic-toolbar small{color:#9199a8;font-size:9px}.mosaic-toolbar>label{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:9px;color:#aab1be;font-size:9px}.mosaic-toolbar input[type=range]{accent-color:#f0a14a}.mosaic-toolbar b{min-width:34px;color:#edf0f5;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.mosaic-tools{display:flex;gap:6px}.mosaic-tools button,.mosaic-footer button{min-height:32px;padding:0 11px;color:#e6e9ee;background:#22262e;border:1px solid #353b46;border-radius:4px;font-size:10px;font-weight:750}.mosaic-tools button:disabled,.mosaic-footer button:disabled{opacity:.45}.mosaic-stage{position:relative;display:grid;flex:1 1 auto;place-items:center;min-height:400px;padding:28px;overflow:auto;background-color:#0c0e12;background-image:linear-gradient(#1e222a 1px,transparent 1px),linear-gradient(90deg,#1e222a 1px,transparent 1px);background-size:24px 24px}.mosaic-stage:after{position:absolute;inset:10px;pointer-events:none;border:1px solid #ffffff10;content:""}.mosaic-stage canvas{display:block;max-width:100%;max-height:520px;cursor:crosshair;image-rendering:pixelated;box-shadow:0 24px 70px #000b;touch-action:none;user-select:none}.mosaic-loading{display:flex;align-items:center;gap:10px;color:#9ca4b1;font-size:11px}.mosaic-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 16px;color:#edf0f5;background:#171a20;border-top:1px solid #2b3039}.mosaic-footer>div:first-child{display:flex;align-items:baseline;gap:6px}.mosaic-footer>div:last-child{display:flex;gap:7px}.mosaic-footer strong{color:#f0a14a;font-size:19px}.mosaic-footer span{font-size:10px;font-weight:700}.mosaic-footer small{margin-left:7px;color:#7f8794;font-size:8px}.mosaic-footer .primary{background:#d9792b!important;border-color:#d9792b!important}.workspace{backdrop-filter:blur(12px)}.filter-panel{background:linear-gradient(135deg,color-mix(in srgb,var(--panel-bg) 94%,transparent),color-mix(in srgb,var(--accent-soft) 16%,transparent))}.artwork-main .title-button:hover strong{color:var(--accent)}
@media(max-width:900px){.stat-grid{grid-template-columns:1fr 1fr}.filters{grid-template-columns:1fr 1fr}.reported-toggle{grid-column:1/-1}.artwork-list>article{grid-template-columns:24px 96px minmax(0,1fr)}.preview{width:96px;height:96px}.row-actions{grid-column:2/-1;flex-direction:row;width:auto;justify-content:flex-end}.detail-layout{grid-template-columns:220px minmax(0,1fr)}.detail-facts{grid-template-columns:1fr 1fr}.mosaic-toolbar{grid-template-columns:1fr}.mosaic-tools{position:absolute;right:34px}.mosaic-stage{min-height:340px}}
@media(max-width:640px){.map-admin{padding:72px 0 24px}.page-header{align-items:flex-start;flex-direction:column}.archive-link{width:100%;justify-content:center}.stat-grid{grid-template-columns:1fr 1fr}.stat-grid article{min-height:92px;padding:13px}.stat-grid strong{font-size:22px}.search-row{flex-wrap:wrap}.search-box{flex-basis:100%}.search-row button{flex:1}.filters{grid-template-columns:1fr}.reported-toggle{grid-column:auto}.bulk-bar{align-items:stretch;flex-direction:column}.bulk-bar>input{width:100%}.artwork-list>article{grid-template-columns:24px 82px minmax(0,1fr);gap:9px;padding:11px}.preview{width:82px;height:82px}.artwork-main dl{grid-template-columns:1fr 1fr}.artwork-main dl div:nth-child(n+3){display:none}.artwork-main footer{flex-wrap:wrap;gap:6px}.row-actions{grid-column:1/-1}.pagination{align-items:stretch;flex-direction:column}.pagination>div{justify-content:space-between}.detail-layout{display:block}.detail-visual{margin-bottom:18px}.detail-preview{min-height:200px}.detail-facts{grid-template-columns:1fr 1fr}.moderation-card>div{flex-wrap:wrap}.field-grid{grid-template-columns:1fr}.mosaic-toolbar{gap:12px}.mosaic-tools{position:static}.mosaic-stage{min-height:260px;padding:12px}.mosaic-footer{align-items:stretch;flex-direction:column}.mosaic-footer>div:first-child{flex-wrap:wrap}.mosaic-footer>div:last-child button{flex:1}}
.map-admin{height:auto;min-height:100%;padding-top:76px;overflow:visible}
@media(max-width:640px){.map-admin{padding-top:72px}}

/* Data-management workspace */
.map-admin {
  position: relative;
  display: flex;
  width: 100%;
  height: 100dvh;
  min-height: 0;
  padding: 86px 0 10px;
  overflow: hidden;
}
.share-nav-shell { position: fixed; z-index: 9; top: 0; left: 0; width: clamp(12px, 3vw, 42px); height: 100dvh; }
.share-nav {
  position: fixed;
  z-index: 9;
  top: 50%;
  left: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
  width: 76px;
  padding: 6px;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 18px 48px var(--shadow);
  transform: translateY(-50%) translateX(calc(-100% + clamp(12px, 3vw, 42px)));
  transition: transform .28s cubic-bezier(.22, 1, .36, 1);
}
.share-nav-shell.is-open .share-nav { transform: translateY(-50%) translateX(0); }
.share-nav-toggle { position: absolute; z-index: 1; top: 50%; right: -9px; display: none; place-items: center; width: 9px; height: 58px; padding: 0; color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 0 5px 5px 0; box-shadow: 0 8px 22px var(--shadow); transform: translateY(-50%); }
.share-nav-toggle span { font-size: 14px; line-height: 1; }
.share-nav-item { position: relative; display: grid; place-items: center; align-content: center; gap: 5px; aspect-ratio: 1; width: 100%; padding: 5px; color: var(--muted-text); background: transparent; border: 0; border-radius: 5px; text-align: center; transition: color .2s ease, background-color .2s ease; }
.share-nav-item:hover { color: var(--panel-text); background: var(--surface-hover); }
.share-nav-item.active { color: var(--accent); background: var(--surface-selected); }
.share-nav-item > span:last-of-type { overflow: hidden; max-width: 100%; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; font-weight: 650; }
.share-nav-item b { position: absolute; top: 3px; right: 4px; min-width: 15px; padding: 1px 3px; color: var(--muted-text); background: var(--surface); border-radius: 5px; font-size: 8px; font-weight: 700; }
.share-nav-item.active b { color: var(--accent); background: var(--panel-bg); }
.share-nav-icon { display: grid; place-items: center; width: 20px; height: 20px; font-size: 14px; }
@media (min-width: 761px) { .share-nav-shell:hover .share-nav { transform: translateY(-50%) translateX(0); } }
.workspace {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 10px 28px color-mix(in srgb, var(--shadow) 28%, transparent);
}
.share-toolbar {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(170px, 1fr) minmax(260px, 520px) auto auto 36px;
  align-items: center;
  gap: 10px;
  min-height: 58px;
  padding: 10px 12px;
  background: color-mix(in srgb, var(--surface) 32%, var(--panel-bg));
  border-bottom: 1px solid var(--border);
}
.share-summary { display: flex; align-items: center; gap: 9px; min-width: 0; }
.share-summary > div { display: grid; gap: 2px; min-width: 0; }
.share-summary strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.share-summary span { color: var(--muted-text); font-size: 11px; }
.status-dot { flex: 0 0 auto; width: 8px; height: 8px; background: var(--success); border-radius: 50%; box-shadow: 0 0 0 3px var(--success-soft); }
.status-dot.loading { background: var(--warning); box-shadow: 0 0 0 3px var(--warning-soft); }
.toolbar-search {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  height: 36px;
  padding: 0 9px;
  color: var(--muted-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
}
.toolbar-search:focus-within { color: var(--accent); border-color: var(--accent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 12%, transparent); }
.toolbar-search svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-linecap: round; stroke-linejoin: round; stroke-width: 2; }
.toolbar-search input { min-width: 0; height: 100%; padding: 0 7px; color: var(--panel-text); background: transparent; border: 0; outline: 0; font-size: 11px; }
.toolbar-search kbd { padding: 2px 6px; color: var(--muted-text); background: var(--surface); border-radius: 3px; font-size: 11px; }
.toolbar-button, .archive-link, .refresh-button, .filter-action {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 36px;
  padding: 0 12px;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
}
.toolbar-button:hover, .archive-link:hover, .refresh-button:hover:not(:disabled), .filter-action:hover { background: var(--surface-hover); border-color: var(--accent); }
.toolbar-button.active { color: var(--accent); background: var(--surface-selected); border-color: color-mix(in srgb, var(--accent) 50%, var(--border)); }
.toolbar-button b { font-size: 16px; font-weight: 500; }
.archive-link { padding: 0 11px; }
.refresh-button { width: 36px; padding: 0; color: var(--muted-text); font-size: 18px; }
.refresh-button.syncing { animation: rotate .8s linear infinite; }
.filter-strip {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
}
.filter-strip > :deep(.base-select) { min-width: 112px; }
.reported-toggle { min-height: 34px; padding: 0 9px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.reported-toggle b { min-width: 20px; padding: 2px 5px; color: var(--danger); background: var(--danger-soft); border-radius: 3px; text-align: center; }
.filter-action { height: 34px; }
.filter-action:first-of-type { color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }
.filter-action.muted { color: var(--muted-text); }
.filter-slide-enter-active, .filter-slide-leave-active { transition: opacity .16s ease, transform .2s ease; }
.filter-slide-enter-from, .filter-slide-leave-to { opacity: 0; transform: translateY(-5px); }
.stats-line {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 0;
  padding: 0;
  color: var(--muted-text);
  border-bottom: 1px solid var(--border);
}
.stats-line > span { position: relative; display: flex; align-items: baseline; gap: 6px; min-height: 38px; padding: 10px 14px 9px 17px; font-size: 11px; }
.stats-line > span::before { position: absolute; top: 12px; bottom: 12px; left: 9px; width: 2px; background: var(--border); content: ''; }
.stats-line > .tone-accent::before { background: var(--accent); }
.stats-line > .tone-danger::before { background: var(--danger); }
.stats-line > .tone-success::before { background: var(--success); }
.stats-line strong { color: var(--panel-text); font-size: 13px; }
.stats-line small { color: var(--muted-text); font-size: 10px; }
.status-strip { flex: 0 0 auto; min-height: 38px; padding: 5px 12px; overflow-x: auto; border-bottom: 1px solid var(--border); }
.status-strip button { min-width: auto; height: 27px; padding: 0 9px; border-radius: 3px; }
.bulk-bar { flex: 0 0 auto; min-height: 44px; padding: 6px 12px; background: color-mix(in srgb, var(--surface) 24%, var(--panel-bg)); }
.bulk-bar.active { background: var(--surface-selected); }
.artwork-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
.artwork-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(430px, 1fr)); gap: 10px; padding: 12px; }
.artwork-list > article {
  grid-template-columns: 22px 108px minmax(0, 1fr);
  gap: 11px;
  align-items: start;
  padding: 12px;
  overflow: hidden;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  transition: background-color .15s ease, border-color .15s ease;
}
.artwork-list > article:hover { background: var(--surface-hover); border-color: var(--accent); }
.artwork-list > article.selected { background: var(--surface-selected); box-shadow: inset 3px 0 var(--accent); }
.artwork-list > article.reported { border-color: color-mix(in srgb, var(--danger) 50%, var(--border)); }
.preview { width: 108px; height: 108px; border-radius: 4px; }
.artwork-main { min-width: 0; }
.artwork-main header { gap: 8px; }
.artwork-main header time { white-space: nowrap; }
.title-button { max-width: 100%; }
.title-button strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.artwork-main p { display: -webkit-box; min-height: 32px; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.artwork-main dl { grid-template-columns: 1fr 1fr; }
.row-actions { grid-column: 2 / -1; flex-direction: row; justify-content: flex-end; width: auto; padding-top: 8px; border-top: 1px solid var(--border); }
.row-actions button { min-width: 58px; height: 29px; }
.page-state { min-height: 100%; }
.page-state small { color: var(--muted-text); }
.pagination { flex: 0 0 44px; min-height: 44px; padding: 6px 12px; background: color-mix(in srgb, var(--surface) 24%, var(--panel-bg)); }
.pagination button, .pagination input { height: 28px; border-radius: 4px; }

/* Detail workspace */
.detail-workspace { display: flex; flex: 1 1 auto; flex-direction: column; width: 100%; min-height: 0; margin: -16px -18px -18px; overflow: hidden; background: var(--panel-bg); }
.detail-head { display: grid; flex: 0 0 auto; grid-template-columns: minmax(220px, 1fr) auto auto; align-items: center; gap: 16px; min-height: 72px; padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--border); }
.detail-head > div { display: grid; grid-template-columns: auto auto minmax(0, 1fr); align-items: center; gap: 6px; min-width: 0; }
.detail-head > div strong { grid-column: 1 / -1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
.detail-head > div code { grid-column: 1 / -1; overflow: hidden; color: var(--muted-text); text-overflow: ellipsis; white-space: nowrap; font-family: inherit; font-size: 10px; }
.detail-head dl { display: flex; gap: 16px; margin: 0; }
.detail-head dl div { display: grid; justify-items: center; gap: 2px; }
.detail-head dt { color: var(--muted-text); font-size: 10px; }
.detail-head dd { margin: 0; font-size: 14px; font-weight: 750; }
.detail-head nav { display: flex; padding: 2px; background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; }
.detail-head nav button { height: 30px; padding: 0 10px; color: var(--muted-text); background: transparent; border: 0; border-radius: 2px; font-size: 11px; }
.detail-head nav button.active { color: var(--panel-text); background: var(--surface-selected); box-shadow: 0 1px 3px color-mix(in srgb, var(--shadow) 25%, transparent); font-weight: 700; }
.detail-columns { display: grid; flex: 1 1 auto; grid-template-columns: minmax(230px, 28%) minmax(0, 1fr); min-height: 0; overflow: hidden; }
.detail-visual { min-height: 0; padding: 14px; overflow-y: auto; background: color-mix(in srgb, var(--surface) 30%, var(--panel-bg)); border-right: 1px solid var(--border); }
.detail-preview { min-height: 220px; }
.detail-actions { grid-template-columns: 1fr 1fr; }
.detail-content { min-height: 0; padding: 18px; overflow-y: auto; }
.detail-heading { padding: 2px 0 14px; }
.detail-heading h2 { font-size: 20px; }
.detail-facts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.detail-section { min-height: 100%; padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.detail-section > header { min-height: 38px; padding: 0; background: transparent; border: 0; border-radius: 0; }
.report-row, .version-list > div { background: var(--panel-bg); border: 1px solid var(--border); }
.report-row { align-items: center; gap: 18px; min-height: 92px; padding: 14px 16px; }
.report-row > div { display: grid; grid-template-columns: auto 1fr; align-items: baseline; gap: 6px 12px; min-width: 0; }
.report-row strong { font-size: 12px; }
.report-row time { color: var(--muted-text); font-size: 10px; }
.report-row p { grid-column: 1 / -1; margin: 0; color: var(--panel-text); font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.report-row > button { flex: 0 0 auto; min-width: 96px; height: 34px; padding: 0 12px; }
.tile-grid { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); padding: 0; border: 0; }
.tile-grid article { background: var(--surface); }
.empty-line { min-height: 180px; margin: 0; padding: 14px; background: var(--panel-bg); border: 1px solid var(--border); }

.edit-form { gap: 16px; }
.edit-form > label, .field-grid > label { gap: 7px; }
.edit-form input, .edit-form textarea { background: var(--surface); border-radius: 4px; }
.edit-form footer { padding-top: 12px; border-top: 1px solid var(--border); }
.mosaic-editor { min-height: min(620px, calc(100dvh - 100px)); }

@keyframes rotate { to { transform: rotate(360deg); } }
@media (max-width: 1050px) {
  .share-toolbar { grid-template-columns: minmax(160px, 1fr) minmax(220px, 1.5fr) auto 36px; }
  .archive-link { width: 36px; padding: 0; }
  .archive-link span { display: none; }
  .artwork-list { grid-template-columns: 1fr; }
  .detail-head { grid-template-columns: 1fr auto; }
  .detail-head nav { grid-column: 1 / -1; }
}
@media (max-width: 760px) {
  .map-admin { padding-top: 76px; }
  .share-nav-shell { width: 0; height: 0; }
  .share-nav-toggle { display: grid; }
  .share-nav { width: 68px; padding: 5px; transform: translateY(-50%) translateX(calc(-100% + 12px)); }
  .share-nav-shell.is-open .share-nav { transform: translateY(-50%) translateX(0); }
  .share-toolbar { grid-template-columns: minmax(0, 1fr) auto 36px; }
  .share-summary, .toolbar-search { grid-column: 1 / -1; }
  .filter-strip { align-items: stretch; }
  .filter-strip > :deep(*) { flex: 1 1 140px; }
  .stats-line small { display: none; }
  .detail-head { grid-template-columns: 1fr; }
  .detail-head dl { justify-content: space-between; }
  .detail-head nav { grid-column: auto; overflow-x: auto; }
  .detail-columns { display: block; overflow-y: auto; }
  .detail-visual { overflow: visible; border-right: 0; border-bottom: 1px solid var(--border); }
  .detail-content { overflow: visible; }
  .detail-facts { grid-template-columns: 1fr 1fr; }
  .report-row { align-items: stretch; flex-direction: column; gap: 12px; }
  .report-row > button { align-self: flex-end; }
}
@media (max-width: 560px) {
  .map-admin { padding-top: 72px; padding-bottom: 0; }
  .workspace { border-right: 0; border-left: 0; border-radius: 0; }
  .share-toolbar { gap: 7px; padding: 9px; }
  .toolbar-button { padding: 0 10px; }
  .filter-strip > * { flex: 1 1 100%; width: 100%; }
  .stats-line { flex-wrap: nowrap; overflow-x: auto; }
  .stats-line > span { flex: 0 0 auto; }
  .status-strip { padding-right: 8px; padding-left: 8px; }
  .bulk-bar { align-items: stretch; flex-direction: column; }
  .bulk-bar > input { width: 100%; }
  .artwork-list { padding: 8px; }
  .artwork-list > article { grid-template-columns: 22px 80px minmax(0, 1fr); gap: 8px; padding: 9px; }
  .preview { width: 80px; height: 80px; }
  .artwork-main dl, .artwork-main p { display: none; }
  .artwork-main footer { gap: 5px; }
  .row-actions { grid-column: 1 / -1; justify-content: stretch; }
  .row-actions button { flex: 1; min-width: 0; }
  .pagination { align-items: stretch; flex-direction: column; flex-basis: auto; }
  .pagination > div { justify-content: space-between; }
  .detail-workspace { margin: 0; overflow: visible; }
  .detail-head nav button { flex: 1 0 auto; }
  .detail-preview { min-height: 190px; }
  .detail-facts { grid-template-columns: 1fr 1fr; }
  .moderation-card > div { flex-wrap: wrap; }
  .mosaic-editor { min-height: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .share-nav, .filter-slide-enter-active, .filter-slide-leave-active, .artwork-list > article, .preview, .archive-link, .row-actions button { transition-duration: .01ms; }
  .refresh-button.syncing, .loader { animation-duration: .01ms; animation-iteration-count: 1; }
}
</style>
