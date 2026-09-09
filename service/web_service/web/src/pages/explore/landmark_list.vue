<script lang="ts" setup>
import {computed, onMounted, ref} from 'vue'
import BaseSelect from '../../components/BaseSelect.vue'
import BaseDialog from '../../components/BaseDialog.vue'
import TimeRangePicker, {type TimeRangeValue} from '../../components/TimeRangePicker.vue'
import {getItemIcon} from '../../utils/itemIcon'
import {del, get, patch, post} from '../../utils/request'
import {
  landmarkListRequest,
  type LandmarkFilters,
  type LandmarkListItem,
  type LandmarkSortBy,
  type LandmarkSortOrder,
} from '../../utils/landmark'

const props = defineProps<{admin?: boolean}>()

const sortOptions = ['访问量', '最近更新', '首次收录', '地标名称', '所有者']
const sortKeys: Record<string, LandmarkSortBy> = {
  访问量: 'visits', 最近更新: 'updated_at', 首次收录: 'first_seen_at', 地标名称: 'name', 所有者: 'owner',
}
const landmarks = ref<LandmarkListItem[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const advancedOpen = ref(false)
const keyword = ref('')
const name = ref('')
const owner = ref('')
const itemId = ref('')
const minVisits = ref('')
const maxVisits = ref('')
const updatedTime = ref<TimeRangeValue>({from: '', to: ''})
const sortLabel = ref('访问量')
const sortOrder = ref<LandmarkSortOrder>('desc')
const page = ref(1)
const pageInput = ref('1')
const total = ref(0)
const totalVisits = ref(0)
const totalPages = ref(1)
const hasPrevious = ref(false)
const hasNext = ref(false)
const iconCache = ref<Record<string, string>>({})
const editTarget = ref<LandmarkListItem | null>(null)
const editOpen = ref(false)
const editLoading = ref(false)
const editError = ref('')
const deleteTarget = ref<LandmarkListItem | null>(null)
const deleteOpen = ref(false)
const deleteLoading = ref(false)
const deleteError = ref('')
const updateLoading = ref(false)
const updateResultOpen = ref(false)
const updateResultTitle = ref('')
const updateResultMessage = ref('')
const updateResultFailed = ref(false)
let requestSerial = 0

const hasAdvancedFilters = computed(() => !!(name.value || owner.value || itemId.value || minVisits.value || maxVisits.value || updatedTime.value.from || updatedTime.value.to))
const activeFilterCount = computed(() => [keyword.value, name.value, owner.value, itemId.value, minVisits.value, maxVisits.value].filter(value => value.trim()).length + (updatedTime.value.from || updatedTime.value.to ? 1 : 0))

function currentFilters(): LandmarkFilters {
  return {
    keyword: keyword.value, name: name.value, owner: owner.value, item_id: itemId.value,
    min_visits: minVisits.value, max_visits: maxVisits.value, updated_from: updatedTime.value.from, updated_to: updatedTime.value.to,
    sort_by: sortKeys[sortLabel.value] || 'visits', sort_order: sortOrder.value,
  }
}

async function loadLandmarks(nextPage = 1) {
  const serial = ++requestSerial
  loading.value = true
  error.value = ''
  try {
    const filters = currentFilters()
    const query = new URLSearchParams({page: String(nextPage), limit: '12', sort_by: filters.sort_by, sort_order: filters.sort_order})
    for (const key of ['keyword', 'name', 'owner', 'item_id', 'min_visits', 'max_visits', 'updated_from', 'updated_to'] as const) {
      const value = filters[key]?.trim()
      if (value) query.set(key, value)
    }
    const result = props.admin
      ? await get<{landmarks: LandmarkListItem[]; summary: {total: number; visits: number}; pagination: {page: number; total: number; total_pages: number; has_previous: boolean; has_next: boolean}}>(`/api/admin/landmarks?${query}`)
      : await landmarkListRequest(nextPage, 12, filters)
    if (serial !== requestSerial) return
    landmarks.value = result.landmarks
    page.value = result.pagination.page
    pageInput.value = String(result.pagination.page)
    total.value = result.pagination.total
    totalVisits.value = result.summary.visits
    totalPages.value = result.pagination.total_pages
    hasPrevious.value = result.pagination.has_previous
    hasNext.value = result.pagination.has_next
    loaded.value = true
    void loadIcons(result.landmarks)
  } catch (requestError) {
    if (serial !== requestSerial) return
    landmarks.value = []
    error.value = requestError instanceof Error ? requestError.message : '地标列表加载失败'
  } finally {
    if (serial === requestSerial) loading.value = false
  }
}

async function loadIcons(rows: LandmarkListItem[]) {
  const ids = [...new Set(rows.map(item => item.item_id.trim()).filter(Boolean))]
  const entries = await Promise.all(ids.map(async id => [id.toLocaleLowerCase(), await getItemIcon(id)] as const))
  iconCache.value = {...iconCache.value, ...Object.fromEntries(entries)}
}

function itemIcon(itemId: string) {
  return iconCache.value[itemId.trim().toLocaleLowerCase()] || ''
}

function submitSearch() {
  void loadLandmarks(1)
}

function clearFilters() {
  keyword.value = ''
  name.value = ''
  owner.value = ''
  itemId.value = ''
  minVisits.value = ''
  maxVisits.value = ''
  updatedTime.value = {from: '', to: ''}
  void loadLandmarks(1)
}

function changeSort() {
  void loadLandmarks(1)
}

function toggleSortOrder() {
  sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc'
  changeSort()
}

function goToPage() {
  const requested = Number(pageInput.value)
  if (!Number.isInteger(requested)) {
    pageInput.value = String(page.value)
    return
  }
  void loadLandmarks(Math.min(Math.max(requested, 1), totalPages.value))
}

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value || '未知'
  return new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false}).format(date)
}

function displayValue(value: string, fallback = '未记录') {
  return value && value.toLocaleLowerCase() !== 'none' ? value : fallback
}

function cardInitial(landmark: LandmarkListItem) {
  return landmark.name.trim().slice(0, 1).toLocaleUpperCase() || 'L'
}

function openEdit(landmark: LandmarkListItem) { editTarget.value = {...landmark}; editError.value = ''; editOpen.value = true }
function openDelete(landmark: LandmarkListItem) { deleteTarget.value = landmark; deleteError.value = ''; deleteOpen.value = true }
async function saveEdit() {
  const landmark = editTarget.value
  if (!landmark || editLoading.value) return
  editLoading.value = true; editError.value = ''
  try {
    await patch(`/api/admin/landmarks/${landmark.id}`, {name: landmark.name, owner: landmark.owner, description: landmark.description, visits: landmark.visits, price: landmark.price, item_id: landmark.item_id})
    editOpen.value = false
    await loadLandmarks(page.value)
  } catch (error) { editError.value = error instanceof Error ? error.message : '保存失败' } finally { editLoading.value = false }
}
async function confirmDelete() {
  const landmark = deleteTarget.value
  if (!landmark || deleteLoading.value) return
  deleteLoading.value = true; deleteError.value = ''
  try {
    await del(`/api/admin/landmarks/${landmark.id}`)
    deleteOpen.value = false
    await loadLandmarks(landmarks.value.length === 1 && page.value > 1 ? page.value - 1 : page.value)
  } catch (error) { deleteError.value = error instanceof Error ? error.message : '删除失败' } finally { deleteLoading.value = false }
}
async function updateAll() {
  if (updateLoading.value) return
  updateLoading.value = true
  try {
    const response = await post<{result: {pages: number; total: number}}>('/api/admin/landmarks/update', {})
    updateResultTitle.value = '地标全局更新完成'
    updateResultMessage.value = `已写入 ${response.result.pages} 页地标，当前共 ${response.result.total} 条记录。`
    updateResultFailed.value = false
    updateResultOpen.value = true
    await loadLandmarks(1)
  } catch (error) {
    updateResultTitle.value = '地标全局更新失败'
    updateResultMessage.value = error instanceof Error ? error.message : '全局更新失败'
    updateResultFailed.value = true
    updateResultOpen.value = true
  } finally { updateLoading.value = false }
}
function closeLandmarkUpdateProgress() {}

onMounted(() => void loadLandmarks())
</script>

<template>
  <section class="landmark-panel">
    <header class="landmark-toolbar">
      <div class="archive-summary">
        <span class="map-mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></span>
        <div><strong>世界地标</strong><small>{{ loaded ? `${total.toLocaleString()} 处` : '等待同步' }}</small></div>
      </div>
      <form class="quick-search" @submit.prevent="submitSearch">
        <label><span class="sr-only">综合查询</span><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg><input v-model="keyword" autocomplete="off" maxlength="256" placeholder="搜索名称、描述、所有者、物品或价格"/></label>
        <button class="search-button" type="submit" :disabled="loading">查询</button>
      </form>
        <div class="toolbar-actions">
          <button v-if="props.admin" class="update-all-button" type="button" :disabled="loading || updateLoading" @click="updateAll">{{ updateLoading ? '更新中...' : '全局更新' }}</button>
        <button class="advanced-button" :class="{active: advancedOpen || hasAdvancedFilters}" type="button" @click="advancedOpen = !advancedOpen">筛选<span v-if="activeFilterCount">{{ activeFilterCount }}</span></button>
        <button class="refresh-button" :class="{syncing: loading}" type="button" :disabled="loading" title="刷新地标" aria-label="刷新地标" @click="loadLandmarks(page)"><svg viewBox="0 0 24 24"><path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5m-5 4a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5"/></svg></button>
      </div>
    </header>

    <Transition name="filters">
      <form v-if="advancedOpen" class="advanced-filters" @submit.prevent="submitSearch">
        <label><span>地标名称</span><input v-model="name" maxlength="128" autocomplete="off" placeholder="包含关键词"/></label>
        <label><span>所有者</span><input v-model="owner" maxlength="64" autocomplete="off" placeholder="玩家 ID"/></label>
        <label><span>展示物品</span><input v-model="itemId" maxlength="256" autocomplete="off" placeholder="物品 ID"/></label>
        <fieldset><legend>访问次数</legend><input v-model="minVisits" type="number" min="0" step="1" placeholder="最低"/><i>至</i><input v-model="maxVisits" type="number" min="0" step="1" placeholder="最高"/></fieldset>
        <div class="updated-filter"><span>更新时间</span><TimeRangePicker v-model="updatedTime"/></div>
        <div class="advanced-actions"><button type="submit">应用</button><button type="button" :disabled="!activeFilterCount" @click="clearFilters">清除全部</button></div>
      </form>
    </Transition>

    <div class="result-bar">
      <div class="result-stats"><span><b>{{ total.toLocaleString() }}</b> 匹配地标</span><span><b>{{ totalVisits.toLocaleString() }}</b> 累计访问</span></div>
      <div class="sort-controls"><span>排序</span><BaseSelect v-model="sortLabel" :options="sortOptions" aria-label="地标排序字段" @update:model-value="changeSort"/><button type="button" :title="sortOrder === 'desc' ? '当前降序，点击改为升序' : '当前升序，点击改为降序'" :aria-label="sortOrder === 'desc' ? '切换为升序' : '切换为降序'" @click="toggleSortOrder"><svg viewBox="0 0 24 24"><path d="m3 16 4 4 4-4M7 20V4m14 4-4-4-4 4m4-4v16"/></svg><span>{{ sortOrder === 'desc' ? '降序' : '升序' }}</span></button></div>
    </div>

    <div class="landmark-scroll">
      <Transition mode="out-in" name="landmark-page">
        <div :key="`${page}-${sortLabel}-${sortOrder}`" class="landmark-page">
          <div v-if="loading && !landmarks.length" class="landmark-state"><span class="radar" aria-hidden="true"><i/></span><strong>正在检索世界地标</strong><small>读取地标名称、主人与访问记录</small></div>
          <div v-else-if="error" class="landmark-state"><span class="state-code">NO SIGNAL</span><strong>暂时无法读取地标</strong><small>{{ error }}</small><button type="button" @click="loadLandmarks(page)">重新尝试</button></div>
          <div v-else-if="!landmarks.length" class="landmark-state"><span class="state-code">NO MATCH</span><strong>没有匹配的地标</strong><small>调整关键词或高级筛选条件后重新查询。</small><button v-if="activeFilterCount" type="button" @click="clearFilters">清除筛选</button></div>
          <div v-else class="landmark-grid">
            <article v-for="(landmark, index) in landmarks" :key="landmark.id" class="landmark-card" :style="{animationDelay: `${Math.min(index * 35, 280)}ms`}">
              <header class="card-head">
                <span class="card-index">{{ String((page - 1) * 12 + index + 1).padStart(2, '0') }}</span>
                <span class="owner-tag"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>{{ displayValue(landmark.owner, '未知主人') }}</span>
              </header>
              <div class="card-title-row">
                <div class="landmark-mark"><span>{{ cardInitial(landmark) }}</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg></div>
                <div><h2>{{ displayValue(landmark.name, '未命名地标') }}</h2><span>地标档案 #{{ landmark.id }}</span></div>
              </div>
              <p class="card-description">{{ displayValue(landmark.description, '暂无地标描述') }}</p>
              <div class="display-item"><div class="item-visual"><img v-if="itemIcon(landmark.item_id)" :src="itemIcon(landmark.item_id)" alt="" loading="lazy"/><svg v-else aria-hidden="true" viewBox="0 0 24 24"><path d="M12 22V12m8.27 6.27L22 20m-1-9.5V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l.98-.56"/><path d="m3.3 7 8.7 5 8.7-5"/></svg></div><div><span>展示物品</span><strong>{{ displayValue(landmark.item_id, '未设置展示物品') }}</strong></div></div>
              <dl class="card-metrics"><div><dt><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>访问</dt><dd>{{ landmark.visits.toLocaleString() }}</dd></div><div><dt><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="8" cy="8" r="5"/><path d="M12 12 19 19m-4 0h4v-4"/></svg>传送价格</dt><dd>{{ displayValue(landmark.price, '免费') }}</dd></div></dl>
               <footer class="card-footer"><span><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>更新 {{ formatDate(landmark.updated_at) }}</span><span>收录 {{ formatDate(landmark.first_seen_at) }}</span></footer>
               <div v-if="props.admin" class="admin-card-actions"><button type="button" @click="openEdit(landmark)">编辑</button><button class="delete-action" type="button" @click="openDelete(landmark)">删除</button></div>
            </article>
          </div>
        </div>
      </Transition>
    </div>

    <footer class="landmark-pagination"><span>第 {{ page }} / {{ totalPages }} 页</span><div><button class="edge-page" type="button" :disabled="loading || !hasPrevious" @click="loadLandmarks(1)">首页</button><button type="button" :disabled="loading || !hasPrevious" aria-label="上一页" @click="loadLandmarks(page - 1)">←</button><label><span>第</span><input v-model="pageInput" inputmode="numeric" aria-label="页码" @keydown.enter.prevent="goToPage"/><span>页</span></label><button class="page-go" type="button" :disabled="loading" @click="goToPage">跳转</button><button type="button" :disabled="loading || !hasNext" aria-label="下一页" @click="loadLandmarks(page + 1)">→</button><button class="edge-page" type="button" :disabled="loading || !hasNext" @click="loadLandmarks(totalPages)">末页</button></div></footer>
    <BaseDialog :open="updateResultOpen" :title="updateResultTitle" @close="updateResultOpen = false"><div class="update-result" :class="{error: updateResultFailed}"><strong>{{ updateResultFailed ? '未完成更新' : '地标档案已更新' }}</strong><p>{{ updateResultMessage }}</p><div><button type="button" @click="updateResultOpen = false">知道了</button></div></div></BaseDialog>
    <BaseDialog :open="updateLoading" title="正在全局更新地标" @close="closeLandmarkUpdateProgress"><div class="landmark-update-progress"><span class="radar" aria-hidden="true"><i/></span><strong>正在读取全部地标</strong><p>pw 插件正在通过 Bot 分页读取服务器地标，最多需要 10 分钟。</p></div></BaseDialog>
    <BaseDialog :open="editOpen" title="编辑地标" @close="editOpen = false"><form v-if="editTarget" class="admin-edit-form" @submit.prevent="saveEdit"><label>名称<input v-model.trim="editTarget.name" maxlength="128" required></label><label>所有者<input v-model.trim="editTarget.owner" maxlength="64" required></label><label>展示物品<input v-model.trim="editTarget.item_id" maxlength="256" required></label><label>价格<input v-model.trim="editTarget.price" maxlength="128" required></label><label>访问量<input v-model.number="editTarget.visits" min="0" type="number" required></label><label class="wide">描述<textarea v-model.trim="editTarget.description" maxlength="2000" rows="4" /></label><small v-if="editError">{{ editError }}</small><div><button type="button" @click="editOpen = false">取消</button><button :disabled="editLoading" type="submit">{{ editLoading ? '保存中...' : '保存' }}</button></div></form></BaseDialog>
    <BaseDialog :open="deleteOpen" title="确认删除地标" @close="deleteOpen = false"><div class="admin-confirm"><strong>{{ deleteTarget?.name }}</strong><p>将永久删除该地标档案，无法恢复。</p><small v-if="deleteError">{{ deleteError }}</small><div><button type="button" @click="deleteOpen = false">取消</button><button class="danger" :disabled="deleteLoading" type="button" @click="confirmDelete">{{ deleteLoading ? '删除中...' : '确认删除' }}</button></div></div></BaseDialog>
  </section>
</template>

<style scoped>
.landmark-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; margin-top: 10px; overflow: hidden; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 18px 46px var(--shadow); }
.landmark-toolbar { position: relative; z-index: 8; display: grid; grid-template-columns: auto minmax(260px, 1fr) auto; align-items: center; gap: 12px; min-height: 58px; padding: 9px 11px; border-bottom: 1px solid var(--border); }
.archive-summary { display: flex; align-items: center; gap: 9px; min-width: 130px; padding-right: 12px; border-right: 1px solid var(--border); }
.map-mark { display: grid; place-items: center; width: 32px; height: 32px; color: var(--accent-contrast); background: var(--accent); border-radius: 4px; }
.map-mark svg { width: 17px; }
.archive-summary > div { display: grid; gap: 2px; }.archive-summary strong { font-size: 11px; }.archive-summary small { color: var(--muted-text); font-size: 9px; }
svg { fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.quick-search { display: grid; grid-template-columns: minmax(0, 1fr) auto; min-width: 0; }
.quick-search label { position: relative; min-width: 0; }.quick-search label svg { position: absolute; top: 10px; left: 10px; width: 15px; color: var(--muted-text); }
input { min-width: 0; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; outline: none; font-size: 11px; }
input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent); }input::placeholder { color: var(--muted-text); opacity: .75; }
.quick-search input { width: 100%; height: 36px; padding: 0 10px 0 33px; border-radius: 4px 0 0 4px; }.search-button { height: 36px; padding: 0 15px; color: var(--accent-contrast); background: var(--accent); border: 1px solid var(--accent); border-radius: 0 4px 4px 0; font-size: 10px; font-weight: 750; }
.toolbar-actions { display: flex; gap: 6px; }.toolbar-actions button { height: 34px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }.advanced-button { min-width: 58px; padding: 0 9px; font-size: 10px; font-weight: 700; }.advanced-button.active { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 62%, var(--border)); }.advanced-button span { display: inline-grid; place-items: center; min-width: 15px; height: 15px; margin-left: 5px; color: var(--accent-contrast); background: var(--accent); border-radius: 8px; font-size: 8px; }.refresh-button { display: grid; place-items: center; width: 34px; padding: 0; }.refresh-button svg { width: 15px; }.refresh-button.syncing svg { animation: spin .8s linear infinite; }button:disabled { cursor: not-allowed; opacity: .45; }
.update-all-button { padding: 0 10px; color: var(--accent-contrast) !important; background: var(--accent) !important; border-color: var(--accent) !important; font-size: 10px; font-weight: 750; white-space: nowrap; }
.advanced-filters { position: relative; z-index: 7; display: grid; grid-template-columns: repeat(3, minmax(100px, .7fr)) minmax(190px, 1fr) minmax(240px, 1.2fr) auto; align-items: end; gap: 8px; padding: 10px 11px; background: color-mix(in srgb, var(--surface) 72%, var(--panel-bg)); border-bottom: 1px solid var(--border); }
.advanced-filters label { display: grid; gap: 5px; min-width: 0; color: var(--muted-text); font-size: 9px; font-weight: 700; }.advanced-filters label input { width: 100%; height: 32px; padding: 0 8px; }
.advanced-filters fieldset { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 5px; min-width: 0; margin: 0; padding: 0; border: 0; }.advanced-filters legend { margin-bottom: 5px; padding: 0; color: var(--muted-text); font-size: 9px; font-weight: 700; }.advanced-filters fieldset input { width: 100%; height: 32px; padding: 0 6px; }.advanced-filters fieldset i { color: var(--muted-text); font-size: 8px; font-style: normal; }
.updated-filter { display: grid; gap: 5px; min-width: 0; color: var(--muted-text); font-size: 9px; font-weight: 700; }.updated-filter :deep(.range-trigger) { height: 32px; }
.advanced-actions { display: flex; gap: 5px; }.advanced-actions button { height: 32px; padding: 0 9px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; font-size: 9px; font-weight: 700; }.advanced-actions button:first-child { color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }
.filters-enter-active, .filters-leave-active { transition: opacity .14s ease, transform .18s ease; transform-origin: top; }.filters-enter-from, .filters-leave-to { opacity: 0; transform: scaleY(.9); }
.result-bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 42px; padding: 5px 12px; border-bottom: 1px solid var(--border); }.result-stats { display: flex; gap: 16px; color: var(--muted-text); font-size: 9px; }.result-stats b { color: var(--panel-text); }.sort-controls { display: flex; align-items: center; gap: 6px; color: var(--muted-text); font-size: 9px; }.sort-controls :deep(.base-select) { width: 92px; }.sort-controls button { display: flex; align-items: center; gap: 5px; height: 34px; padding: 0 8px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 3px; font-size: 9px; }.sort-controls button:hover { border-color: var(--accent); }.sort-controls button svg { width: 13px; }
.landmark-scroll { flex: 1 1 auto; min-height: 0; padding: 10px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--accent) 65%, var(--muted-text)) transparent; }.landmark-scroll::-webkit-scrollbar { width: 4px; }.landmark-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--accent) 65%, var(--muted-text)); border-radius: 4px; }.landmark-page { min-height: 100%; }.landmark-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(245px, 1fr)); gap: 8px; align-content: start; }
.landmark-card { display: flex; flex-direction: column; min-width: 0; min-height: 230px; padding: 10px; background: var(--surface); border: 1px solid var(--border); border-radius: 5px; animation: card-enter .32s cubic-bezier(.22, 1, .36, 1) both; transition: background-color .18s ease, border-color .18s ease, transform .18s ease; }.landmark-card:hover { background: var(--surface-hover); border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); transform: translateY(-2px); }.card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 16px; }.card-index { color: var(--muted-text); font: 700 8px ui-monospace, monospace; }.owner-tag { display: flex; align-items: center; gap: 4px; min-width: 0; overflow: hidden; color: var(--accent); text-overflow: ellipsis; white-space: nowrap; font-size: 8px; }.owner-tag svg { flex: 0 0 auto; width: 11px; }.card-title-row { display: grid; grid-template-columns: 34px minmax(0, 1fr); align-items: center; gap: 8px; min-width: 0; margin-top: 8px; }.landmark-mark { position: relative; display: grid; place-items: center; width: 34px; height: 34px; color: var(--accent); background: var(--surface-selected); border: 1px solid color-mix(in srgb, var(--accent) 28%, var(--border)); border-radius: 4px; }.landmark-mark span { color: color-mix(in srgb, var(--accent) 36%, transparent); font-size: 20px; font-weight: 800; line-height: 1; }.landmark-mark svg { position: absolute; width: 17px; }.card-title-row > div:nth-child(2) { min-width: 0; }.card-title-row h2 { margin: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }.card-title-row > div > span { display: block; margin-top: 3px; color: var(--muted-text); font: 7px ui-monospace, monospace; }.card-description { display: -webkit-box; min-height: 32px; margin: 9px 0; overflow: hidden; color: var(--muted-text); font-size: 9px; line-height: 1.45; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.display-item { display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 7px; min-width: 0; padding: 6px; background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; }.item-visual { display: grid; place-items: center; width: 28px; height: 28px; background: var(--surface-selected); border-radius: 3px; }.item-visual img { width: 24px; height: 24px; object-fit: contain; image-rendering: pixelated; }.item-visual svg { width: 15px; color: var(--muted-text); }.display-item div:last-child { min-width: 0; }.display-item span, .display-item strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.display-item span { color: var(--muted-text); font-size: 7px; }.display-item strong { margin-top: 2px; font: 8px ui-monospace, monospace; }
.card-metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; margin: 8px 0 0; background: var(--border); border: 1px solid var(--border); border-radius: 4px; overflow: hidden; }.card-metrics div { min-width: 0; padding: 6px 7px; background: var(--panel-bg); }.card-metrics dt { display: flex; align-items: center; gap: 4px; color: var(--muted-text); font-size: 7px; }.card-metrics dt svg { width: 11px; }.card-metrics dd { margin: 4px 0 0; overflow: hidden; color: var(--panel-text); text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 750; }.card-footer { display: flex; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 8px; color: var(--muted-text); border-top: 1px solid var(--border); font-size: 7px; }.card-footer span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.card-footer span:first-child { display: flex; align-items: center; gap: 4px; }.card-footer svg { flex: 0 0 auto; width: 10px; }
.admin-card-actions { display: flex; justify-content: flex-end; gap: 5px; margin-top: 7px; }.admin-card-actions button { height: 25px; padding: 0 8px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 3px; font-size: 9px; font-weight: 700; }.admin-card-actions .delete-action { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 55%, var(--border)); }.update-result { display: grid; gap: 10px; }.update-result strong { color: var(--success-text); font-size: 14px; }.update-result.error strong { color: var(--danger); }.update-result p { margin: 0; color: var(--muted-text); font-size: 13px; line-height: 1.65; }.update-result > div { display: flex; justify-content: flex-end; }.update-result button { height: 34px; padding: 0 12px; color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 4px; font-size: 12px; font-weight: 700; }
.landmark-update-progress { display: grid; justify-items: center; gap: 10px; padding: 8px 0; text-align: center; }.landmark-update-progress strong { font-size: 14px; }.landmark-update-progress p { max-width: 290px; margin: 0; color: var(--muted-text); font-size: 12px; line-height: 1.6; }
.admin-edit-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }.admin-edit-form label { display: grid; gap: 5px; color: var(--muted-text); font-size: 12px; }.admin-edit-form input, .admin-edit-form textarea { box-sizing: border-box; width: 100%; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }.admin-edit-form input { height: 34px; padding: 0 8px; }.admin-edit-form textarea { padding: 8px; resize: vertical; }.admin-edit-form .wide, .admin-edit-form > small, .admin-edit-form > div { grid-column: 1 / -1; }.admin-edit-form > small, .admin-confirm > small { color: var(--danger); font-size: 12px; }.admin-edit-form > div, .admin-confirm > div { display: flex; justify-content: flex-end; gap: 8px; }.admin-edit-form button, .admin-confirm button { height: 34px; padding: 0 12px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; font-weight: 700; }.admin-edit-form button[type="submit"], .admin-confirm button.danger { color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }.admin-confirm { display: grid; gap: 10px; }.admin-confirm p { margin: 0; color: var(--muted-text); font-size: 13px; line-height: 1.6; }.admin-confirm button.danger { background: var(--danger); border-color: var(--danger); }
.landmark-state { display: grid; place-content: center; justify-items: center; gap: 7px; min-height: 320px; height: 100%; color: var(--muted-text); text-align: center; }.landmark-state strong { color: var(--panel-text); font-size: 13px; }.landmark-state small { max-width: 300px; font-size: 10px; line-height: 1.5; }.state-code { color: var(--accent); font: 750 8px ui-monospace, monospace; letter-spacing: .12em; }.landmark-state button { margin-top: 6px; padding: 8px 12px; color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 4px; font-size: 10px; font-weight: 700; }.radar { position: relative; width: 50px; height: 50px; border: 1px solid var(--border); border-radius: 50%; background: var(--surface); }.radar::before, .radar::after { content: ''; position: absolute; background: var(--border); }.radar::before { top: 50%; left: 5px; right: 5px; height: 1px; }.radar::after { top: 5px; bottom: 5px; left: 50%; width: 1px; }.radar i { position: absolute; inset: 5px; border-top: 2px solid var(--accent); border-radius: 50%; animation: spin 1s linear infinite; }
.landmark-pagination { display: flex; flex: 0 0 45px; align-items: center; justify-content: space-between; min-height: 45px; padding: 7px 12px; color: var(--muted-text); border-top: 1px solid var(--border); font-size: 9px; }.landmark-pagination > div { display: flex; align-items: center; gap: 5px; }.landmark-pagination button { display: grid; place-items: center; width: 30px; height: 30px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; font-size: 16px; }.landmark-pagination button:hover:not(:disabled) { color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }.landmark-pagination .edge-page, .landmark-pagination .page-go { width: auto; padding: 0 8px; font-size: 9px; }.landmark-pagination label { display: flex; align-items: center; gap: 4px; }.landmark-pagination input { width: 44px; height: 30px; padding: 0 4px; text-align: center; }
.landmark-page-enter-active, .landmark-page-leave-active { transition: opacity .15s ease, transform .2s ease; }.landmark-page-enter-from { opacity: 0; transform: translateX(10px); }.landmark-page-leave-to { opacity: 0; transform: translateX(-6px); }.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
.landmark-toolbar { min-height: 64px; padding: 12px 14px; background: color-mix(in srgb, var(--surface) 34%, var(--panel-bg)); }.archive-summary { min-width: 150px; }.archive-summary strong { font-size: 14px; }.archive-summary small { font-size: 11px; }.quick-search label svg { top: 12px; width: 16px; }.quick-search input { height: 40px; padding-left: 36px; font-size: 13px; }.search-button { height: 40px; padding: 0 18px; font-size: 12px; }.toolbar-actions button { height: 40px; }.advanced-button { min-width: 72px; padding: 0 12px; font-size: 12px; }.advanced-button span { min-width: 17px; height: 17px; font-size: 10px; }.refresh-button { width: 40px; }.refresh-button svg { width: 17px; }.advanced-filters { grid-template-columns: repeat(3, minmax(150px, 1fr)) minmax(210px, 1fr) minmax(260px, 1.2fr) auto; gap: 10px; padding: 12px 14px; background: color-mix(in srgb, var(--surface) 58%, var(--panel-bg)); }.advanced-filters label, .advanced-filters legend, .updated-filter { font-size: 12px; }.advanced-filters label input, .advanced-filters fieldset input { height: 38px; font-size: 13px; }.updated-filter :deep(.range-trigger) { height: 38px; }.advanced-actions button { height: 38px; padding: 0 12px; font-size: 12px; }.result-bar { min-height: 46px; padding: 7px 14px; background: color-mix(in srgb, var(--surface) 18%, var(--panel-bg)); }.result-stats, .sort-controls, .sort-controls button { font-size: 12px; }.landmark-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }.landmark-card { min-height: 272px; padding: 14px; }.card-head { min-height: 22px; }.card-index, .owner-tag, .card-title-row > div > span, .display-item span, .card-metrics dt, .card-footer { font-size: 10px; }.owner-tag svg { width: 13px; }.card-title-row { grid-template-columns: 42px minmax(0, 1fr); gap: 10px; margin-top: 11px; }.landmark-mark { width: 42px; height: 42px; }.landmark-mark span { font-size: 24px; }.landmark-mark svg { width: 21px; }.card-title-row h2 { font-size: 17px; }.card-description { min-height: 42px; margin: 11px 0; font-size: 12px; line-height: 1.55; }.display-item { grid-template-columns: 34px minmax(0, 1fr); gap: 9px; padding: 8px; }.item-visual { width: 34px; height: 34px; }.item-visual img { width: 29px; height: 29px; }.item-visual svg { width: 18px; }.display-item strong { font-size: 12px; }.card-metrics { margin-top: 10px; }.card-metrics div { padding: 8px 9px; }.card-metrics dt svg { width: 13px; }.card-metrics dd { font-size: 15px; }.card-footer { padding-top: 10px; }.card-footer svg { width: 12px; }.landmark-pagination, .landmark-pagination .edge-page, .landmark-pagination .page-go { font-size: 11px; }
.landmark-toolbar { height: 48px; min-height: 48px; box-sizing: border-box; padding: 6px 10px; gap: 8px; }.archive-summary { min-width: 130px; }.archive-summary strong { font-size: 12px; }.archive-summary small { font-size: 9px; }.quick-search label svg { top: 9px; width: 14px; }.quick-search input, .search-button, .toolbar-actions button { height: 34px; }.quick-search input { padding-left: 32px; font-size: 11px; }.search-button { padding: 0 12px; font-size: 10px; }.advanced-button { min-width: 58px; padding: 0 9px; font-size: 10px; }.advanced-button span { min-width: 15px; height: 15px; font-size: 8px; }.refresh-button { width: 34px; }.refresh-button svg { width: 15px; }.advanced-filters { gap: 7px; padding: 7px 10px; }.advanced-filters label, .advanced-filters legend, .updated-filter { font-size: 9px; }.advanced-filters label input, .advanced-filters fieldset input, .updated-filter :deep(.range-trigger), .advanced-actions button { height: 32px; font-size: 10px; }.advanced-actions button { padding: 0 9px; }.result-bar { min-height: 38px; padding: 4px 10px; }.result-stats, .sort-controls, .sort-controls button { font-size: 10px; }
@keyframes spin { to { transform: rotate(360deg); } } @keyframes card-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (max-width: 1100px) { .advanced-filters { grid-template-columns: repeat(3, minmax(0, 1fr)); }.advanced-actions { justify-content: end; }.landmark-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 720px) { .landmark-toolbar { grid-template-columns: minmax(0, 1fr) auto; }.archive-summary { display: none; }.quick-search { grid-column: 1; }.toolbar-actions { grid-column: 2; }.advanced-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); }.advanced-filters fieldset, .updated-filter, .advanced-actions { grid-column: span 2; }.result-bar { align-items: flex-start; }.result-stats { display: grid; gap: 3px; }.landmark-scroll { padding-inline: 8px; } }
@media (max-width: 480px) { .landmark-toolbar { gap: 6px; padding: 8px; }.advanced-button { width: 40px; min-width: 40px; padding: 0; font-size: 0; }.advanced-button::before { content: '⌁'; font-size: 17px; }.advanced-button span { position: absolute; margin: -25px 0 0 25px; }.advanced-filters { grid-template-columns: minmax(0, 1fr); }.advanced-filters fieldset, .updated-filter, .advanced-actions { grid-column: auto; }.result-stats span:last-child, .sort-controls > span, .sort-controls button span { display: none; }.sort-controls :deep(.base-select) { width: 88px; }.sort-controls button { width: 40px; padding: 0; justify-content: center; }.landmark-grid { grid-template-columns: minmax(0, 1fr); }.landmark-card { min-height: 260px; }.card-footer span:last-child { display: none; }.landmark-pagination > span { display: none; }.landmark-pagination > div { width: 100%; justify-content: center; }.landmark-pagination label span { display: none; }.landmark-pagination .edge-page { padding-inline: 6px; } }
@media (max-width: 480px) { .update-all-button { width: auto; padding: 0 8px; font-size: 9px; }.admin-edit-form { grid-template-columns: 1fr; }.admin-edit-form .wide, .admin-edit-form > small, .admin-edit-form > div { grid-column: auto; } }
@media (prefers-reduced-motion: reduce) { .refresh-button.syncing svg, .radar i, .landmark-card { animation: none; }.landmark-card { transition: none; }.filters-enter-active, .filters-leave-active, .landmark-page-enter-active, .landmark-page-leave-active { transition-duration: .01ms; }.landmark-page-enter-from, .landmark-page-leave-to { transform: none; } }
/* Shared exploration title bar dimensions. */
.landmark-toolbar { height: 50.57px !important; min-height: 50.57px !important; max-height: 50.57px !important; box-sizing: border-box; padding: 6px 12px; overflow: hidden; align-items: center !important; }
.archive-summary, .quick-search, .toolbar-actions { align-self: center; }
.archive-summary strong, .archive-summary small { line-height: 1.1; }
.map-mark { width: 28px; height: 28px; }.map-mark svg { width: 15px; }
.quick-search input, .search-button, .toolbar-actions button { height: 30px !important; min-height: 30px !important; max-height: 30px !important; box-sizing: border-box; }
.quick-search label svg { top: 8px; width: 14px; }.refresh-button { width: 30px; }
.search-button { padding-inline: 10px; }.advanced-button { min-width: 52px; padding-inline: 7px; }
.update-all-button { padding-inline: 8px; }
.toolbar-actions { gap: 5px; }
.archive-summary { gap: 7px; padding-right: 9px; }
.map-mark { width: 26px; height: 26px; }.map-mark svg { width: 14px; }
</style>
