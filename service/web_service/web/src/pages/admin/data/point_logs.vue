<script setup lang="ts">
import {onMounted, ref} from 'vue'
import TimeRangePicker, {type TimeRangeValue} from '../../../components/TimeRangePicker.vue'
import {get} from '../../../utils/request'

interface PointLog {
  id: number
  game_id: string
  action: 'add' | 'remove'
  num: number
  reason: string
  ext: string | null
  create_at: string
}

interface Pagination { page: number; total: number; total_pages: number; has_previous: boolean; has_next: boolean }

const logs = ref<PointLog[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const username = ref('')
const keyword = ref('')
const ext = ref('')
const timeRange = ref<TimeRangeValue>({from: '', to: ''})
const page = ref(1)
const total = ref(0)
const totalPages = ref(1)
const hasPrevious = ref(false)
const hasNext = ref(false)
let requestSerial = 0

function formatTime(value: string) {
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).format(date)
}

function formatAmount(log: PointLog) {
  return `${log.action === 'add' ? '+' : '-'}${(log.num / 100).toLocaleString('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`
}

async function loadLogs(nextPage = 1) {
  const serial = ++requestSerial
  loading.value = true
  error.value = ''
  const params = new URLSearchParams({page: String(nextPage), limit: '30'})
  if (username.value.trim()) params.set('username', username.value.trim())
  if (keyword.value.trim()) params.set('keyword', keyword.value.trim())
  if (ext.value.trim()) params.set('ext', ext.value.trim())
  if (timeRange.value.from) params.set('create_time_from', timeRange.value.from)
  if (timeRange.value.to) params.set('create_time_to', timeRange.value.to)
  try {
    const result = await get<{logs: PointLog[]; pagination: Pagination}>(`/api/admin/point-logs?${params}`)
    if (serial !== requestSerial) return
    logs.value = result.logs
    page.value = result.pagination.page
    total.value = result.pagination.total
    totalPages.value = result.pagination.total_pages
    hasPrevious.value = result.pagination.has_previous
    hasNext.value = result.pagination.has_next
    loaded.value = true
  } catch (requestError) {
    if (serial !== requestSerial) return
    logs.value = []
    error.value = requestError instanceof Error ? requestError.message : '积分流水加载失败'
  } finally {
    if (serial === requestSerial) loading.value = false
  }
}

function search() { void loadLogs(1) }
function clearFilters() {
  username.value = ''
  keyword.value = ''
  ext.value = ''
  timeRange.value = {from: '', to: ''}
  search()
}

onMounted(() => { void loadLogs() })
</script>

<template>
  <section class="point-logs-panel">
    <header class="point-logs-toolbar">
      <div><strong>积分日志</strong><small>{{ loaded ? `${total.toLocaleString()} 条记录` : '正在读取积分流水' }}</small></div>
      <button :disabled="loading" type="button" @click="loadLogs(page)">{{ loading ? '刷新中' : '刷新' }}</button>
    </header>
    <form class="point-log-filters" @submit.prevent="search">
      <input v-model="username" aria-label="玩家名称" placeholder="玩家名称">
      <input v-model="keyword" aria-label="原因关键词" placeholder="原因关键词">
      <input v-model="ext" aria-label="来源标记" placeholder="来源标记">
      <TimeRangePicker v-model="timeRange"/>
      <button type="submit">筛选</button>
      <button class="plain" :disabled="loading" type="button" @click="clearFilters">重置</button>
    </form>
    <div class="point-log-scroll">
      <div v-if="loading && !loaded" class="point-log-state">正在读取积分流水...</div>
      <div v-else-if="error" class="point-log-state error">{{ error }}<button type="button" @click="loadLogs(page)">重试</button></div>
      <div v-else-if="!logs.length" class="point-log-state">没有匹配的积分记录。</div>
      <div v-else class="point-log-list">
        <article v-for="log in logs" :key="log.id" :class="log.action">
          <time>{{ formatTime(log.create_at) }}</time>
          <strong>{{ log.game_id }}</strong>
          <b>{{ formatAmount(log) }}</b>
          <p>{{ log.reason }}</p>
          <code>{{ log.ext || 'manual' }}</code>
        </article>
      </div>
    </div>
    <footer class="point-log-pagination"><span>第 {{ page }} / {{ totalPages }} 页</span><div><button :disabled="loading || !hasPrevious" type="button" @click="loadLogs(page - 1)">上一页</button><button :disabled="loading || !hasNext" type="button" @click="loadLogs(page + 1)">下一页</button></div></footer>
  </section>
</template>

<style scoped>
.point-logs-panel { display:flex; flex:1 1 auto; flex-direction:column; min-height:0; margin-top:10px; overflow:hidden; color:var(--panel-text); background:var(--panel-bg); border:1px solid var(--border); border-radius:5px; box-shadow:0 12px 32px var(--shadow); }
.point-logs-toolbar, .point-log-pagination { display:flex; flex:0 0 auto; align-items:center; justify-content:space-between; gap:12px; min-height:56px; padding:8px 12px; border-bottom:1px solid var(--border); }.point-logs-toolbar div { display:grid; gap:2px; }.point-logs-toolbar strong { font-size:14px; }.point-logs-toolbar small, .point-log-pagination { color:var(--muted-text); font-size:10px; }
.point-logs-toolbar button, .point-log-filters button, .point-log-pagination button, .point-log-state button { height:34px; padding:0 10px; color:var(--accent-contrast); background:var(--accent); border:0; border-radius:4px; font-size:11px; font-weight:700; }.point-log-filters { display:grid; grid-template-columns:minmax(120px, .8fr) minmax(120px, 1fr) minmax(120px, 1fr) minmax(230px, 1.4fr) auto auto; gap:8px; padding:9px 12px; border-bottom:1px solid var(--border); }.point-log-filters input { min-width:0; height:34px; padding:0 9px; color:var(--panel-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font-size:12px; }.point-log-filters :deep(.range-trigger) { height:34px; }.plain, .point-log-pagination button, .point-log-state button { color:var(--panel-text)!important; background:var(--surface)!important; border:1px solid var(--border)!important; }
.point-log-scroll { flex:1 1 auto; min-height:0; overflow-y:auto; }.point-log-list { display:grid; align-content:start; }.point-log-list article { display:grid; grid-template-columns:150px minmax(110px, .8fr) 100px minmax(180px, 1.5fr) minmax(120px, .9fr); gap:12px; align-items:center; padding:11px 12px; border-bottom:1px solid var(--border); font-size:12px; }.point-log-list time, .point-log-list code { overflow:hidden; color:var(--muted-text); text-overflow:ellipsis; white-space:nowrap; font-size:10px; }.point-log-list strong, .point-log-list p { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.point-log-list p { margin:0; }.point-log-list b { font-size:13px; }.point-log-list article.add b { color:var(--success-text); }.point-log-list article.remove b { color:var(--danger); }.point-log-state { display:grid; place-content:center; justify-items:center; gap:8px; min-height:220px; padding:24px; color:var(--muted-text); text-align:center; font-size:12px; }.point-log-state.error { color:var(--danger); }.point-log-pagination { flex:0 0 48px; min-height:48px; border-top:1px solid var(--border); border-bottom:0; }.point-log-pagination div { display:flex; gap:6px; }
@media (max-width:900px) { .point-log-filters { grid-template-columns:repeat(3, minmax(0, 1fr)); }.point-log-filters :deep(.time-range-picker) { grid-column:span 2; }.point-log-list article { grid-template-columns:130px minmax(100px, 1fr) 90px minmax(160px, 1fr); }.point-log-list code { grid-column:2 / -1; } }
@media (max-width:600px) { .point-log-filters { grid-template-columns:1fr 1fr; }.point-log-filters :deep(.time-range-picker) { grid-column:1 / -1; }.point-log-list article { grid-template-columns:1fr auto; gap:6px 10px; }.point-log-list time { grid-column:1; }.point-log-list strong { grid-column:1; }.point-log-list b { grid-column:2; grid-row:1 / span 2; }.point-log-list p, .point-log-list code { grid-column:1 / -1; }.point-log-pagination { align-items:flex-start; flex-direction:column; padding-block:8px; } }
</style>
