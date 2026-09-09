<script setup lang="ts">
import {onMounted, ref, watch} from 'vue'
import BaseSelect from '../../../components/BaseSelect.vue'
import TimeRangePicker, {type TimeRangeValue} from '../../../components/TimeRangePicker.vue'
import {adminLogMetaRequest, adminLogsRequest, type LogType, type SystemLog} from '../../../utils/logs'

const logs = ref<SystemLog[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const platforms = ref<string[]>(['全部平台'])
const plugins = ref<string[]>(['全部插件'])
const metaError = ref('')
const type = ref('全部级别')
const platform = ref('全部平台')
const plugin = ref('全部插件')
const keyword = ref('')
const timeRange = ref<TimeRangeValue>({from: '', to: ''})
const page = ref(1)
const pageInput = ref('1')
const total = ref(0)
const totalPages = ref(1)
const hasPrevious = ref(false)
const hasNext = ref(false)
let requestSerial = 0

const typeOptions = ['全部级别', '信息', '警告', '错误']
const typeMap: Record<string, LogType | undefined> = {信息: 'info', 警告: 'warn', 错误: 'error'}

function formatTime(value: string) {
  const date = new Date(value.replace(' ', 'T'))
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false}).format(date)
}
function typeLabel(value: LogType) { return value === 'info' ? '信息' : value === 'warn' ? '警告' : '错误' }

async function loadMeta(forPlatform = platform.value) {
  metaError.value = ''
  try {
    const result = await adminLogMetaRequest(forPlatform === '全部平台' ? undefined : forPlatform)
    platforms.value = ['全部平台', ...result.platforms.sort((a, b) => a.localeCompare(b))]
    plugins.value = ['全部插件', ...result.plugins.sort((a, b) => a.localeCompare(b))]
    if (!plugins.value.includes(plugin.value)) plugin.value = '全部插件'
  } catch (requestError) {
    metaError.value = requestError instanceof Error ? requestError.message : '无法加载平台和插件筛选项'
  }
}

async function loadLogs(nextPage = 1) {
  const serial = ++requestSerial
  loading.value = true; error.value = ''
  try {
    const result = await adminLogsRequest(nextPage, 30, {
      platform: platform.value === '全部平台' ? undefined : platform.value,
      plugin: plugin.value === '全部插件' ? undefined : plugin.value,
      type: typeMap[type.value], keyword: keyword.value.trim(), time_from: timeRange.value.from, time_to: timeRange.value.to,
    })
    if (serial !== requestSerial) return
    logs.value = result.logs
    page.value = result.pagination.page; pageInput.value = String(page.value)
    total.value = result.pagination.total; totalPages.value = result.pagination.total_pages
    hasPrevious.value = result.pagination.has_previous; hasNext.value = result.pagination.has_next
    loaded.value = true
  } catch (requestError) {
    if (serial !== requestSerial) return
    logs.value = []
    error.value = requestError instanceof Error ? requestError.message : '日志加载失败'
  } finally { if (serial === requestSerial) loading.value = false }
}

function search() { void loadLogs(1) }
function clearFilters() { type.value = '全部级别'; platform.value = '全部平台'; plugin.value = '全部插件'; keyword.value = ''; timeRange.value = {from: '', to: ''}; search() }
function goToPage() {
  const target = Number(pageInput.value)
  if (!Number.isInteger(target)) { pageInput.value = String(page.value); return }
  void loadLogs(Math.min(Math.max(target, 1), totalPages.value))
}

watch(platform, () => { void loadMeta(); search() })

onMounted(() => { void loadMeta(); void loadLogs() })
</script>

<template>
  <section class="logs-panel">
    <header class="logs-toolbar">
      <div class="log-summary"><span class="log-dot" :class="{loading}"/><div><strong>系统日志</strong><small>{{ loaded ? `${total.toLocaleString()} 条记录` : '正在连接日志库' }}</small></div></div>
      <div class="logs-toolbar-actions"><button :disabled="loading" type="button" @click="loadLogs(page)">{{ loading ? '刷新中' : '刷新' }}</button></div>
    </header>
    <form class="log-filters" @submit.prevent="search">
      <BaseSelect v-model="type" :options="typeOptions" aria-label="日志级别"/>
      <BaseSelect v-model="platform" :options="platforms" aria-label="日志平台"/>
      <BaseSelect v-model="plugin" :options="plugins" aria-label="日志插件"/>
      <input v-model="keyword" aria-label="日志关键词" placeholder="搜索日志内容" type="search"/>
      <TimeRangePicker v-model="timeRange"/>
      <button type="submit">筛选</button><button :disabled="loading" class="clear" type="button" @click="clearFilters">重置</button>
    </form>
    <div v-if="metaError" class="meta-error">筛选项加载失败：{{ metaError }} <button type="button" @click="() => loadMeta()">重新加载</button></div>
    <div class="logs-scroll">
      <div v-if="loading && !loaded" class="log-state"><span class="log-loader"/><strong>正在读取系统日志</strong></div>
      <div v-else-if="error" class="log-state error"><strong>无法读取日志</strong><small>{{ error }}</small><button type="button" @click="loadLogs(page)">重试</button></div>
      <div v-else-if="!logs.length" class="log-state"><strong>没有匹配的日志</strong><small>调整筛选条件后重新查询。</small></div>
      <div v-else class="log-list"><article v-for="entry in logs" :key="entry.id" :class="`type-${entry.type}`" class="log-entry"><time>{{ formatTime(entry.time) }}</time><span class="entry-type">{{ typeLabel(entry.type) }}</span><span class="entry-source">{{ entry.platform }} / {{ entry.plugin }}</span><p>{{ entry.msg }}</p></article></div>
    </div>
    <footer class="logs-pagination"><span>第 {{ page }} / {{ totalPages }} 页</span><div><button :disabled="loading || !hasPrevious" type="button" @click="loadLogs(1)">首页</button><button :disabled="loading || !hasPrevious" type="button" @click="loadLogs(page - 1)">上一页</button><input v-model="pageInput" aria-label="页码" inputmode="numeric" @keydown.enter.prevent="goToPage"><button :disabled="loading" type="button" @click="goToPage">跳转</button><button :disabled="loading || !hasNext" type="button" @click="loadLogs(page + 1)">下一页</button></div></footer>
  </section>
</template>

<style scoped>
.logs-panel { display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; margin-top: 10px; overflow: hidden; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 12px 32px var(--shadow); }.logs-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 56px; padding: 8px 12px; border-bottom: 1px solid var(--border); }.log-summary { display: flex; align-items: center; gap: 10px; }.log-dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; box-shadow: 0 0 0 4px var(--success-soft); }.log-dot.loading { background: var(--warning); box-shadow: 0 0 0 4px var(--warning-soft); }.log-summary div { display: grid; gap: 2px; }.log-summary strong { font-size: 14px; }.log-summary small { color: var(--muted-text); font-size: 10px; }.logs-toolbar-actions button, .log-filters > button, .logs-pagination button, .log-state button { height: 34px; padding: 0 10px; color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 4px; font-size: 11px; font-weight: 700; }.log-filters { display: grid; grid-template-columns: 110px minmax(120px, 1fr) minmax(120px, 1fr) minmax(230px, 1.4fr) auto auto; gap: 8px; padding: 9px 12px; border-bottom: 1px solid var(--border); }.log-filters :deep(.range-trigger) { height: 34px; }.log-filters .clear, .logs-pagination button, .log-state button { color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); }.meta-error { display: flex; align-items: center; gap: 8px; padding: 7px 12px; color: var(--danger); background: color-mix(in srgb, var(--danger) 8%, transparent); border-bottom: 1px solid var(--border); font-size: 11px; }.meta-error button { padding: 0; color: inherit; background: transparent; border: 0; text-decoration: underline; font: inherit; }.logs-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--border) transparent; }.log-list { display: grid; align-content: start; }.log-entry { display: grid; grid-template-columns: 135px 54px minmax(150px, 210px) minmax(0, 1fr); gap: 10px; align-items: start; padding: 10px 12px; border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent); font-size: 11px; }.log-entry:hover { background: color-mix(in srgb, var(--surface-hover) 72%, transparent); }.log-entry time, .entry-source { color: var(--muted-text); font-family: ui-monospace, monospace; font-size: 10px; }.entry-source { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.entry-type { width: fit-content; padding: 2px 5px; border-radius: 3px; color: var(--success-text); background: var(--success-soft); font-size: 9px; font-weight: 750; }.type-warn .entry-type { color: var(--warning-text); background: var(--warning-soft); }.type-error .entry-type { color: var(--danger); background: color-mix(in srgb, var(--danger) 14%, transparent); }.log-entry p { min-width: 0; margin: 0; overflow-wrap: anywhere; line-height: 1.5; }.log-state { display: grid; place-content: center; justify-items: center; gap: 8px; min-height: 280px; color: var(--muted-text); text-align: center; font-size: 12px; }.log-state strong { color: var(--panel-text); font-size: 14px; }.log-state.error strong, .log-state.error small { color: var(--danger); }.log-loader { width: 24px; height: 24px; border: 2px solid color-mix(in srgb, var(--accent) 25%, transparent); border-top-color: var(--accent); border-radius: 50%; animation: spin .8s linear infinite; }.logs-pagination { display: flex; flex: 0 0 45px; align-items: center; justify-content: space-between; gap: 10px; min-height: 45px; padding: 6px 12px; color: var(--muted-text); border-top: 1px solid var(--border); font-size: 10px; }.logs-pagination div { display: flex; align-items: center; gap: 5px; }.logs-pagination button { height: 29px; padding: 0 8px; font-size: 10px; }.logs-pagination input { width: 42px; height: 29px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 3px; text-align: center; font-size: 11px; }@keyframes spin { to { transform: rotate(360deg); } }@media (max-width: 900px) { .log-filters { grid-template-columns: repeat(3, minmax(0, 1fr)); }.log-filters :deep(.time-range-picker) { grid-column: span 2; }.log-entry { grid-template-columns: 120px 54px minmax(0, 1fr); }.log-entry p { grid-column: 1 / -1; }.entry-source { text-align: right; } }@media (max-width: 560px) { .log-filters { grid-template-columns: 1fr 1fr; }.log-filters :deep(.time-range-picker) { grid-column: 1 / -1; }.log-filters > button { width: 100%; }.log-entry { grid-template-columns: 1fr auto; gap: 6px; }.log-entry time { grid-column: 1; }.entry-type { grid-column: 2; grid-row: 1; }.entry-source, .log-entry p { grid-column: 1 / -1; }.logs-pagination { align-items: flex-start; flex-direction: column; height: auto; padding-block: 8px; }.logs-pagination div { flex-wrap: wrap; } }
.log-filters { grid-template-columns: 110px minmax(120px, 1fr) minmax(120px, 1fr) minmax(150px, 1fr) minmax(230px, 1.4fr) auto auto; }
.log-filters input { min-width: 0; height: 34px; padding: 0 9px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; font-size: 12px; }
</style>
