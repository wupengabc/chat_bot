<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BaseDialog from '../../components/BaseDialog.vue'
import BaseSelect from '../../components/BaseSelect.vue'
import AdminIcon from '../../components/admin/AdminIcon.vue'
import ConfigFields from './settings/ConfigFields.vue'
import { useAuthStore } from '../../stores/auth'
import { useAlertStore } from '../../stores/alert'
import { del, get, post, request } from '../../utils/request'

type Section = 'modules' | 'maintenance' | 'audits' | 'config' | 'backup' | 'security'
type ModuleType = 'plugin' | 'chat_adapter' | 'game_adapter' | 'storage'

interface ModuleResponse {
  modules: {
    plugins: Array<{ type: 'plugin'; name: string; state: 'running' | 'stopped'; instances: string[]; adapters: string[] }>
    chat_adapters: Array<{ type: 'chat_adapter'; name: string; state: 'running' | 'stopped'; instances: Array<{ name: string; status: string }> }>
    game_adapters: Array<{ type: 'game_adapter'; name: string; state: 'running' | 'stopped'; instances: Array<{ name: string; status: string }> }>
    storages: Array<{ type: 'storage'; name: string; state: 'running' | 'stopped' }>
  }
}
interface AuditEntry { id: number; time: string; actor: string; action: string; target: string; detail: string; ip: string; result: 'success' | 'failed' }
interface ConfigSummary { id: string; name: string; description: string; path: string; instances: number }
interface KugouPlaylist { id: string; name: string; cover: string; trackCount: number; syncedAt: string | null }
interface KugouCache { user: Record<string, unknown> | null; vip: Record<string, unknown> | null; playlists: KugouPlaylist[]; playlistsSyncedAt: string | null }
interface KugouTrack { hash?: string; filehash?: string; name?: string; filename?: string; songname?: string; singername?: string; cover?: string; timelen?: number; language?: string; singerinfo?: Array<{ name?: string }> }
interface ConfigDetail extends ConfigSummary { template: Record<string, any>; configs: Array<Record<string, any>>; singleton?: boolean; authentication?: Record<string, { account?: { authenticated?: boolean; userid?: string | null } }>; kugou?: Record<string, KugouCache> }
interface Backup { id: string; created_at: string; created_by: string; files: number; bytes: number }
interface WorldMapCache { files: number; bytes: number }

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const alertStore = useAlertStore()
const isOwner = computed(() => authStore.user?.role === 'owner')
const isAdmin = computed(() => authStore.user?.role === 'admin' || isOwner.value)
const allSections: Array<{ id: Section; label: string; icon: 'activity' | 'server' | 'settings' | 'file-text' }> = [
  { id: 'modules', label: '模块管理', icon: 'server' },
  { id: 'maintenance', label: '维护操作', icon: 'settings' },
  { id: 'audits', label: '操作审计', icon: 'file-text' },
  { id: 'config', label: '配置中心', icon: 'settings' },
  { id: 'backup', label: '备份恢复', icon: 'server' },
  { id: 'security', label: '安全设置', icon: 'settings' },
]
const visibleSections = computed(() => allSections.filter(item => isAdmin.value || !['config', 'backup', 'security'].includes(item.id)))
const sectionIds = new Set<Section>(allSections.map(item => item.id))
const activeSection = ref<Section>('modules')
const modulesLoading = ref(false)
const auditLoading = ref(false)
const modules = ref<ModuleResponse['modules'] | null>(null)
const audits = ref<AuditEntry[]>([])
const auditPage = ref(1)
const auditPageInput = ref('1')
const auditTotal = ref(0)
const auditPageSize = 30
const configSummaries = ref<ConfigSummary[]>([])
const configDetail = ref<ConfigDetail | null>(null)
const selectedConfigId = ref('')
const selectedInstance = ref('')
const configValues = ref<Record<string, any>>({})
const configLoading = ref(false)
const configDetailLoading = ref(false)
const configSaving = ref(false)
const backups = ref<Backup[]>([])
const backupsLoading = ref(false)
const backupCreating = ref(false)
const navOpen = ref(false)
const navShell = ref<HTMLElement | null>(null)
const activeModuleType = ref<ModuleType>('plugin')
const instanceDialog = ref<'create' | 'rename' | null>(null)
const instanceNameInput = ref('')
const instanceSubmitting = ref(false)
const confirmAction = ref<{ title: string; text: string; run: () => Promise<void> } | null>(null)
const runningAction = ref(false)
const kugouSyncing = ref('')
const kugouTracks = ref<KugouTrack[] | null>(null)
const kugouTrackPlaylist = ref('')
const kugouTracksLoading = ref(false)
const kugouTrackPlaylistId = ref('')
const kugouTrackPage = ref(1)
const kugouTrackTotal = ref(0)
const kugouTrackTotalPages = ref(1)
const kugouTrackPageSize = 30
const worldMapCache = ref<WorldMapCache | null>(null)
const worldMapCacheLoading = ref(false)
let configRequestId = 0
let moduleRefreshTimer: ReturnType<typeof setInterval> | null = null

function parseSection(value: unknown): Section {
  const section = typeof value === 'string' && sectionIds.has(value as Section) ? value as Section : 'modules'
  if (section === 'config' && !isAdmin.value) return 'modules'
  return !isOwner.value && ['backup', 'security'].includes(section) ? 'modules' : section
}

function selectSection(section: Section) {
  activeSection.value = section
  navOpen.value = false
  void router.push({ query: { ...route.query, section } })
  void loadSection(section)
}

function closeNavOutside(event: MouseEvent) {
  if (navShell.value && !navShell.value.contains(event.target as Node)) navOpen.value = false
}

function refreshVisibleModules() {
  if (!document.hidden && activeSection.value === 'modules') void loadModules()
}

async function loadModules() {
  if (modulesLoading.value) return
  modulesLoading.value = true
  try {
    modules.value = (await get<ModuleResponse>('/api/admin/system/modules')).modules
  } catch (error) {
    alertStore.error('模块信息加载失败', error instanceof Error ? error.message : '请稍后重试')
  } finally {
    modulesLoading.value = false
  }
}

const auditTotalPages = computed(() => Math.max(1, Math.ceil(auditTotal.value / auditPageSize)))
const hasPreviousAuditPage = computed(() => auditPage.value > 1)
const hasNextAuditPage = computed(() => auditPage.value < auditTotalPages.value)

async function loadAudits(nextPage = auditPage.value) {
  const page = Math.min(Math.max(Math.floor(nextPage) || 1, 1), auditTotalPages.value)
  auditLoading.value = true
  try {
    const result = await get<{ total: number; entries: AuditEntry[] }>(`/api/admin/system/audits?page=${page}&page_size=${auditPageSize}`)
    auditTotal.value = result.total
    auditPage.value = Math.min(page, Math.max(1, Math.ceil(result.total / auditPageSize)))
    auditPageInput.value = String(auditPage.value)
    audits.value = result.entries
  } catch (error) {
    alertStore.error('审计记录加载失败', error instanceof Error ? error.message : '请稍后重试')
  } finally {
    auditLoading.value = false
  }
}

function goToAuditPage() {
  const page = Number(auditPageInput.value)
  void loadAudits(Number.isFinite(page) ? page : auditPage.value)
}

async function loadSection(section = activeSection.value) {
  if (section === 'modules') await loadModules()
  if (section === 'audits') await loadAudits()
  if (section === 'config' && isAdmin.value) await loadConfigs()
  if (section === 'backup' && isOwner.value) await loadBackups()
}

async function loadBackups() {
  backupsLoading.value = true
  try { backups.value = (await get<{ backups: Backup[] }>('/api/admin/system/backups')).backups }
  catch (error) { alertStore.error('备份列表加载失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { backupsLoading.value = false }
}

async function createBackup() {
  if (backupCreating.value) return
  backupCreating.value = true
  try {
    const result = await post<{ backup: Backup }>('/api/admin/system/backups', {})
    alertStore.success('备份已创建', `${result.backup.files} 个文件，${formatBytes(result.backup.bytes)}`)
    await loadBackups()
  } catch (error) { alertStore.error('创建备份失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { backupCreating.value = false }
}

function queueDeleteBackup(backup: Backup) {
  confirmAction.value = {
    title: '确认删除备份',
    text: `删除 ${backup.id} 后无法恢复。`,
    async run() {
      await del(`/api/admin/system/backups/${encodeURIComponent(backup.id)}`)
      alertStore.success('备份已删除', backup.id)
      await loadBackups()
    },
  }
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

async function loadConfigs() {
  configLoading.value = true
  try {
    configSummaries.value = (await get<{ configs: ConfigSummary[] }>('/api/admin/system/configs')).configs
    const firstConfig = configSummaries.value[0]
    if (!selectedConfigId.value && firstConfig) await selectConfig(firstConfig.id)
  } catch (error) {
    alertStore.error('配置列表加载失败', error instanceof Error ? error.message : '请稍后重试')
  } finally { configLoading.value = false }
}

async function selectConfig(id: string) {
  const requestId = ++configRequestId
  selectedConfigId.value = id
  selectedInstance.value = ''
  configValues.value = {}
  configDetail.value = null
  worldMapCache.value = null
  configDetailLoading.value = true
  try {
    const detail = (await get<{ config: ConfigDetail }>(`/api/admin/system/configs/${encodeURIComponent(id)}`)).config
    if (requestId !== configRequestId) return
    configDetail.value = detail
    selectedInstance.value = detail.configs[0]?.name || ''
    selectInstance(selectedInstance.value)
    if (detail.path === 'service/world_map/config.json') void loadWorldMapCache()
  } catch (error) {
    if (requestId === configRequestId) alertStore.error('配置详情加载失败', error instanceof Error ? error.message : '请稍后重试')
  } finally {
    if (requestId === configRequestId) configDetailLoading.value = false
  }
}

async function loadWorldMapCache() {
  worldMapCacheLoading.value = true
  try {
    worldMapCache.value = (await get<{ cache: WorldMapCache }>('/api/admin/world-map/cache')).cache
  } catch (error) {
    alertStore.error('地图缓存状态加载失败', error instanceof Error ? error.message : '请稍后重试')
  } finally {
    worldMapCacheLoading.value = false
  }
}

function queueClearWorldMapCache() {
  confirmAction.value = {
    title: '确认清除永久地图缓存',
    text: '将删除服务端已生成的全部地图区块。用户再次访问时需要重新计算，此操作无法恢复。',
    async run() {
      const result = await del<{ cleared: WorldMapCache }>('/api/admin/world-map/cache')
      alertStore.success('永久地图缓存已清除', `已删除 ${result.cleared.files} 个文件，释放 ${formatBytes(result.cleared.bytes)}`)
      await loadWorldMapCache()
    },
  }
}

function selectInstance(name: string) {
  selectedInstance.value = name
  const instance = configDetail.value?.configs.find(item => item.name === name) || {}
  configValues.value = JSON.parse(JSON.stringify(instance))
}

async function saveConfig() {
  if (!configDetail.value || !selectedInstance.value || configSaving.value) return
  configSaving.value = true
  try {
    const result = await request<{ message: string }>(`/api/admin/system/configs/${encodeURIComponent(configDetail.value.id)}`, { method: 'PATCH', body: JSON.stringify({ name: selectedInstance.value, new_name: configValues.value.name, values: configValues.value }) })
    alertStore.success('配置已保存', result.message)
    await selectConfig(configDetail.value.id)
  } catch (error) {
    alertStore.error('配置保存失败', error instanceof Error ? error.message : '请检查输入内容')
  } finally { configSaving.value = false }
}

function kugouCache(): KugouCache | null { return configDetail.value?.kugou?.[selectedInstance.value] ?? null }
function kugouLoggedIn(): boolean { return Boolean(configDetail.value?.authentication?.[selectedInstance.value]?.account?.authenticated) }
function formatSyncTime(value: string | null | undefined) {
  if (!value) return '尚未同步'
  const time = new Date(value)
  return Number.isNaN(time.getTime()) ? '尚未同步' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(time)
}
function kugouTrackTitle(track: KugouTrack) { return track.name || track.songname || track.filename || '未命名歌曲' }
function kugouTrackArtist(track: KugouTrack) { return track.singerinfo?.map(item => item.name).filter(Boolean).join(' / ') || track.singername || '未知歌手' }
function kugouTrackDuration(value: number | undefined) {
  const seconds = Math.round((value || 0) / 1000)
  return seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : '--:--'
}
async function syncKugou(kind: 'account' | 'playlists' | 'tracks', playlistId?: string) {
  if (!configDetail.value || !selectedInstance.value || kugouSyncing.value) return
  kugouSyncing.value = playlistId ? `tracks:${playlistId}` : kind
  try {
    const base = `/api/admin/system/configs/${encodeURIComponent(configDetail.value.id)}/kugou`
    if (kind === 'account') await post(`${base}/account`, { name: selectedInstance.value })
    else if (kind === 'playlists') await post(`${base}/playlists`, { name: selectedInstance.value })
    else await post(`${base}/playlists/${encodeURIComponent(playlistId || '')}/tracks`, { name: selectedInstance.value })
    alertStore.success(kind === 'account' ? '账号信息已同步' : kind === 'playlists' ? '歌单列表已同步' : '歌单歌曲已同步')
    await selectConfig(configDetail.value.id)
  } catch (error) { alertStore.error('酷狗同步失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { kugouSyncing.value = '' }
}

async function viewKugouTracks(playlist: KugouPlaylist, page = 1) {
  if (!configDetail.value || !selectedInstance.value || kugouTracksLoading.value) return
  kugouTracksLoading.value = true
  kugouTrackPlaylist.value = playlist.name
  kugouTrackPlaylistId.value = playlist.id
  kugouTracks.value = null
  try {
    const base = `/api/admin/system/configs/${encodeURIComponent(configDetail.value.id)}/kugou/playlists/${encodeURIComponent(playlist.id)}/tracks`
    const result = await get<{ tracks: KugouTrack[]; pagination: { page: number; total: number; total_pages: number } }>(`${base}?name=${encodeURIComponent(selectedInstance.value)}&page=${page}&page_size=${kugouTrackPageSize}`)
    kugouTracks.value = result.tracks
    kugouTrackPage.value = result.pagination.page
    kugouTrackTotal.value = result.pagination.total
    kugouTrackTotalPages.value = result.pagination.total_pages
  } catch (error) { alertStore.error('读取歌单歌曲失败', error instanceof Error ? error.message : '请先同步歌曲') }
  finally { kugouTracksLoading.value = false }
}

function loadKugouTrackPage(page: number) {
  if (!kugouTrackPlaylistId.value) return
  void viewKugouTracks({ id: kugouTrackPlaylistId.value, name: kugouTrackPlaylist.value, cover: '', trackCount: kugouTrackTotal.value, syncedAt: null }, page)
}

async function setNavbarPlaylist(playlist: KugouPlaylist) {
  if (!configDetail.value || configSaving.value) return
  configValues.value.navbarPlaylistId = playlist.id
  await saveConfig()
  alertStore.success('导航播放器已更新', `仅播放“${playlist.name}”的已同步歌曲`)
}

function queueClearKugouMediaCache() {
  if (!configDetail.value) return
  const id = configDetail.value.id
  confirmAction.value = {
    title: '确认清理媒体缓存',
    text: '将删除已下载的歌曲和歌词缓存，歌单与歌曲列表缓存不会受影响。',
    async run() {
      const result = await del<{ files: number; bytes: number }>(`/api/admin/system/configs/${encodeURIComponent(id)}/kugou/media-cache`)
      alertStore.success('媒体缓存已清理', `已删除 ${result.files} 个文件，释放 ${formatBytes(result.bytes)}`)
    },
  }
}

function openInstanceDialog(mode: 'create' | 'rename') {
  instanceDialog.value = mode
  instanceNameInput.value = mode === 'rename' ? selectedInstance.value : ''
}

async function submitInstanceDialog() {
  if (!configDetail.value || !instanceDialog.value || instanceSubmitting.value) return
  const name = instanceNameInput.value.trim()
  if (!name) {
    alertStore.warning('实例名称不能为空')
    return
  }
  instanceSubmitting.value = true
  try {
    if (instanceDialog.value === 'create') {
      const result = await post<{ message: string }>(`/api/admin/system/configs/${encodeURIComponent(configDetail.value.id)}/instances`, { name })
      alertStore.success('实例已新增', result.message)
    } else {
      const result = await request<{ message: string }>(`/api/admin/system/configs/${encodeURIComponent(configDetail.value.id)}`, { method: 'PATCH', body: JSON.stringify({ name: selectedInstance.value, new_name: name, values: configValues.value }) })
      alertStore.success('实例已重命名', result.message)
    }
    const id = configDetail.value.id
    instanceDialog.value = null
    await selectConfig(id)
    if (instanceDialog.value === null && name) selectInstance(name)
  } catch (error) {
    alertStore.error('实例操作失败', error instanceof Error ? error.message : '请检查实例名称')
  } finally { instanceSubmitting.value = false }
}

function queueDeleteInstance() {
  if (!configDetail.value || configDetail.value.configs.length <= 1) return
  const id = configDetail.value.id
  const name = selectedInstance.value
  confirmAction.value = {
    title: '确认删除配置实例',
    text: `删除实例 ${name} 后无法恢复。`,
    async run() {
      await del(`/api/admin/system/configs/${encodeURIComponent(id)}/instances/${encodeURIComponent(name)}`)
      alertStore.success('实例已删除', name)
      await selectConfig(id)
    },
  }
}

function queueReload(type: ModuleType, name: string) {
  const label = name === 'all' ? '全部同类模块' : name
  confirmAction.value = {
    title: '确认重载',
    text: `重载 ${label} 会短暂中断相关服务。`,
    async run() {
      await post(`/api/admin/system/modules/${type}/${encodeURIComponent(name)}/reload`, {})
      alertStore.success('模块已重载', label)
      await loadModules()
    },
  }
}

function queueUnload(type: ModuleType, name: string) {
  confirmAction.value = {
    title: '确认卸载模块',
    text: `卸载 ${name} 会停止所有关联实例，模块不会接收后续事件，直到手动开启。`,
    async run() {
      await post(`/api/admin/system/modules/${type}/${encodeURIComponent(name)}/unload`, {})
      alertStore.success('模块已卸载', name)
      await loadModules()
    },
  }
}

function queueMaintenance(kind: 'update' | 'restart') {
  const restart = kind === 'restart'
  confirmAction.value = {
    title: restart ? '确认重启服务' : '确认检查更新',
    text: restart ? '服务会暂时不可用，launcher 将自动拉起应用。' : 'launcher 会检查远程仓库，并在发现变更时同步更新。',
    async run() {
      await post(`/api/admin/system/maintenance/${kind}`, {})
      alertStore.success(restart ? '已请求重启' : '已请求检查更新', restart ? '服务将在数秒后恢复。' : '请稍后在系统日志中查看结果。')
    },
  }
}

async function executeConfirmed() {
  if (!confirmAction.value || runningAction.value) return
  runningAction.value = true
  try {
    await confirmAction.value.run()
    confirmAction.value = null
  } catch (error) {
    alertStore.error('操作失败', error instanceof Error ? error.message : '请稍后重试')
  } finally {
    runningAction.value = false
  }
}

function formatModuleInstances(item: ModuleResponse['modules']['chat_adapters'][number] | ModuleResponse['modules']['game_adapters'][number]) {
  return item.instances.map(instance => `${instance.name} · ${instance.status}`).join('，') || '无实例'
}

function moduleCount(items: Array<{ state: string }>) {
  return items.filter(item => item.state === 'running').length
}

function moduleDisplayState(item: any, type: ModuleType): 'running' | 'connecting' | 'stopped' {
  if (type !== 'chat_adapter' && type !== 'game_adapter') return item.state === 'running' ? 'running' : 'stopped'
  if (item.state !== 'running') return 'stopped'
  const statuses = Array.isArray(item.instances) ? item.instances.map((instance: any) => instance?.status) : []
  if (statuses.some((status: string) => status === 'running')) return 'running'
  if (statuses.some((status: string) => status === 'connecting')) return 'connecting'
  return 'stopped'
}

function moduleDisplayLabel(item: any, type: ModuleType): string {
  if (item.state !== 'running') return '已卸载'
  if (type !== 'chat_adapter' && type !== 'game_adapter') return '运行中'
  const state = moduleDisplayState(item, type)
  return state === 'running' ? '已连接' : state === 'connecting' ? '连接中' : '离线'
}

const moduleGroups = computed(() => [
  { id: 'plugin' as const, label: '插件', short: 'PLUGIN', items: modules.value?.plugins ?? [] },
  { id: 'chat_adapter' as const, label: '聊天适配器', short: 'CHAT', items: modules.value?.chat_adapters ?? [] },
  { id: 'game_adapter' as const, label: '游戏适配器', short: 'GAME', items: modules.value?.game_adapters ?? [] },
  { id: 'storage' as const, label: '存储', short: 'STORE', items: modules.value?.storages ?? [] },
])

const activeModuleGroup = computed(() => moduleGroups.value.find(group => group.id === activeModuleType.value) ?? moduleGroups.value[0])
const configInstanceNames = computed(() => configDetail.value?.configs.map(item => item.name) ?? [])

function moduleDescription(item: any, type: ModuleType) {
  if (type === 'plugin') {
    const instances = Array.isArray(item.instances) ? item.instances : []
    const names = instances.map((instance: unknown) => {
      if (typeof instance === 'string') return instance
      if (instance && typeof instance === 'object' && 'name' in instance && typeof instance.name === 'string') return instance.name
      return ''
    }).filter(Boolean)
    return names.length ? names.join('，') : instances.length ? `${instances.length} 个已启动实例` : '暂无已启动实例'
  }
  if (type === 'storage') return item.state === 'running' ? '已注册存储服务' : '等待手动开启'
  return formatModuleInstances(item)
}

function moduleDetail(item: any, type: ModuleType) {
  if (type === 'plugin') return item.adapters.join(' / ') || '未订阅适配器'
  if (type === 'storage') return '数据与事件存储模块'
  return type === 'chat_adapter' ? '聊天事件适配器' : '游戏事件适配器'
}

watch(() => route.query.section, value => {
  const section = parseSection(value)
  if (activeSection.value !== section) {
    activeSection.value = section
    void loadSection(section)
  }
})
watch(isAdmin, () => {
  const section = parseSection(activeSection.value)
  if (section !== activeSection.value) selectSection(section)
})
onMounted(() => {
  activeSection.value = parseSection(route.query.section)
  if (route.query.section !== activeSection.value) void router.replace({ query: { ...route.query, section: activeSection.value } })
  document.addEventListener('mousedown', closeNavOutside)
  document.addEventListener('visibilitychange', refreshVisibleModules)
  moduleRefreshTimer = setInterval(refreshVisibleModules, 15000)
  void loadSection()
})
onBeforeUnmount(() => {
  document.removeEventListener('mousedown', closeNavOutside)
  document.removeEventListener('visibilitychange', refreshVisibleModules)
  if (moduleRefreshTimer) clearInterval(moduleRefreshTimer)
})
</script>

<template>
  <section class="system-page">
    <div :class="{ 'is-open': navOpen }" class="system-nav-shell" ref="navShell">
      <nav class="system-nav" aria-label="系统管理分类">
        <button :aria-expanded="navOpen" aria-label="打开系统管理导航" class="system-nav-toggle" type="button" @click="navOpen = !navOpen"><span aria-hidden="true">{{ navOpen ? '‹' : '›' }}</span></button>
        <button v-for="section in visibleSections" :key="section.id" type="button" :aria-current="activeSection === section.id ? 'page' : undefined" :class="{ active: activeSection === section.id }" class="system-nav-item" @click="selectSection(section.id)">
          <span class="system-nav-icon"><AdminIcon :name="section.icon" /></span>
          <span class="system-nav-label">{{ section.label }}</span>
        </button>
      </nav>
    </div>

    <main class="system-workspace" :class="{ 'modules-workspace': activeSection === 'modules', 'config-workspace': activeSection === 'config' }">
      <template v-if="activeSection === 'modules'">
        <section class="module-console">
          <header class="console-toolbar"><div class="runtime-label"><span /><strong>运行单元</strong><small>{{ moduleCount(modules?.plugins || []) + moduleCount(modules?.chat_adapters || []) + moduleCount(modules?.game_adapters || []) + moduleCount(modules?.storages || []) }} 个已启动</small></div><div class="runtime-metrics"><span>插件 <strong>{{ moduleCount(modules?.plugins || []) }} / {{ modules?.plugins.length ?? 0 }}</strong></span><span>适配器 <strong>{{ moduleCount(modules?.chat_adapters || []) + moduleCount(modules?.game_adapters || []) }} / {{ (modules?.chat_adapters.length ?? 0) + (modules?.game_adapters.length ?? 0) }}</strong></span><span>存储 <strong>{{ moduleCount(modules?.storages || []) }} / {{ modules?.storages.length ?? 0 }}</strong></span></div><button class="console-refresh" type="button" aria-label="刷新模块状态" title="刷新模块状态" :class="{ spinning: modulesLoading }" :disabled="modulesLoading" @click="loadModules"><span aria-hidden="true">↻</span></button></header>
          <div v-if="modulesLoading" class="console-state"><span class="console-loader" />正在读取运行时注册表</div>
          <div v-else class="module-split">
            <aside class="module-type-nav" aria-label="模块分类">
              <button v-for="group in moduleGroups" :key="group.id" type="button" :class="{ active: activeModuleType === group.id }" @click="activeModuleType = group.id"><span class="type-mark" :class="group.id" /><span>{{ group.label }}</span><small>{{ moduleCount(group.items) }} / {{ group.items.length }}</small></button>
            </aside>
            <section v-if="activeModuleGroup" class="module-type-content">
              <header class="module-list-heading"><div><span class="category-line" :class="activeModuleGroup.id" /><div><h2>{{ activeModuleGroup.label }}</h2><small>{{ moduleCount(activeModuleGroup.items) }} / {{ activeModuleGroup.items.length }} 个模块运行中</small></div></div><button type="button" @click="queueReload(activeModuleGroup.id, 'all')">重载全部</button></header>
              <div class="module-card-grid"><article v-for="item in activeModuleGroup.items" :key="item.name" class="module-card" :class="item.state"><div class="card-top"><span class="state-badge" :class="moduleDisplayState(item, activeModuleGroup.id)"><i />{{ moduleDisplayLabel(item, activeModuleGroup.id) }}</span><span class="card-type">{{ activeModuleGroup.short }}</span></div><strong>{{ item.name }}</strong><p>{{ moduleDescription(item, activeModuleGroup.id) }}</p><small>{{ moduleDetail(item, activeModuleGroup.id) }}</small><footer><button v-if="item.state === 'stopped'" class="start" type="button" @click="queueReload(activeModuleGroup.id, item.name)">开启模块</button><template v-else><button type="button" @click="queueReload(activeModuleGroup.id, item.name)">重载</button><button class="unload" type="button" @click="queueUnload(activeModuleGroup.id, item.name)">卸载</button></template></footer></article><p v-if="!activeModuleGroup.items.length" class="empty-card">未发现{{ activeModuleGroup.label }}配置</p></div>
            </section>
          </div>
        </section>
      </template>

      <template v-else-if="activeSection === 'maintenance'">
        <section class="panel maintenance"><div><h2>更新服务</h2><p>通过本机 launcher 请求检查远程仓库并应用变更。</p></div><button type="button" @click="queueMaintenance('update')">检查更新</button></section>
        <section class="panel maintenance danger-zone"><div><h2>重启服务</h2><p>应用进程退出后由 launcher 自动恢复，期间服务会短暂不可用。</p></div><button type="button" @click="queueMaintenance('restart')">重启服务</button></section>
      </template>

      <template v-else-if="activeSection === 'audits'">
        <section class="panel audit-panel"><div class="panel-heading"><h2>操作审计</h2><span v-if="auditLoading" class="muted">加载中</span></div><div class="audit-table"><div class="audit-head"><span>时间</span><span>操作者</span><span>操作</span><span>目标</span><span>结果</span></div><div v-for="entry in audits" :key="entry.id" class="audit-row"><span>{{ entry.time }}</span><span>{{ entry.actor }}</span><span>{{ entry.action }}</span><span :title="entry.detail">{{ entry.target }}</span><span :class="entry.result">{{ entry.result === 'success' ? '成功' : '失败' }}</span></div><p v-if="!auditLoading && audits.length === 0" class="state">暂无管理操作记录</p></div><footer v-if="auditTotal" class="audit-pagination"><span>第 {{ auditPage }} / {{ auditTotalPages }} 页，共 {{ auditTotal }} 条</span><div><button type="button" :disabled="auditLoading || !hasPreviousAuditPage" @click="loadAudits(1)">首页</button><button type="button" :disabled="auditLoading || !hasPreviousAuditPage" @click="loadAudits(auditPage - 1)">上一页</button><input v-model="auditPageInput" aria-label="审计页码" inputmode="numeric" @keydown.enter.prevent="goToAuditPage"><button type="button" :disabled="auditLoading" @click="goToAuditPage">跳转</button><button type="button" :disabled="auditLoading || !hasNextAuditPage" @click="loadAudits(auditPage + 1)">下一页</button><button type="button" :disabled="auditLoading || !hasNextAuditPage" @click="loadAudits(auditTotalPages)">末页</button></div></footer></section>
      </template>

      <template v-else-if="activeSection === 'config' && isAdmin">
        <section class="panel config-panel">
          <div v-if="configLoading" class="config-loading muted">加载中</div>
          <div v-if="configSummaries.length" class="config-layout">
            <aside class="config-list">
              <button v-for="item in configSummaries" :key="item.id" type="button" :class="{ active: selectedConfigId === item.id }" @click="selectConfig(item.id)"><strong>{{ item.name }}</strong><small>{{ item.path }}</small></button>
            </aside>
            <div v-if="configDetail" class="config-editor">
              <div class="config-editor-scroll">
                <div class="editor-heading"><div><h3>{{ configDetail.name }}</h3><p>{{ configDetail.description || configDetail.path }}</p></div><button v-if="!configDetail.singleton" class="instance-add" type="button" @click="openInstanceDialog('create')"><span aria-hidden="true" />新增实例</button></div>
                <div v-if="!configDetail.singleton" class="instance-toolbar"><label><span>配置实例</span><BaseSelect v-model="selectedInstance" aria-label="配置实例" :options="configInstanceNames" @update:model-value="selectInstance" /></label><div><button type="button" @click="openInstanceDialog('rename')">重命名</button><button class="instance-delete" type="button" :disabled="configDetail.configs.length <= 1" title="至少保留一个配置实例" @click="queueDeleteInstance">删除</button></div></div>
                 <div v-if="configDetail.singleton || selectedInstance" :key="`${configDetail.id}:${selectedInstance}`" class="config-form config-switch"><ConfigFields :template="configDetail.template" :model="configValues" :config-id="configDetail.id" :instance-name="selectedInstance" :authenticated="configDetail.authentication?.[selectedInstance]?.account?.authenticated" :account-id="configDetail.authentication?.[selectedInstance]?.account?.userid" @authenticated="selectConfig(configDetail!.id)" @logged-out="selectConfig(configDetail!.id)" /></div>
                 <div v-else class="config-empty-state">暂无配置实例，请先新增一个实例。</div>
                <section v-if="configDetail.path === 'service/world_map/config.json'" class="world-map-cache">
                  <div><span>服务端永久缓存</span><strong>{{ worldMapCacheLoading ? '读取中' : `${worldMapCache?.files || 0} 个区块` }}</strong><small>{{ worldMapCacheLoading ? '正在统计缓存文件' : `磁盘占用 ${formatBytes(worldMapCache?.bytes || 0)}` }}</small></div>
                  <button class="danger-action" type="button" :disabled="worldMapCacheLoading || !worldMapCache?.files" @click="queueClearWorldMapCache">清除永久缓存</button>
                </section>
                <section v-if="configDetail.path === 'service/kugou/config.json' && kugouLoggedIn()" class="kugou-sync">
                  <header class="kugou-heading"><div><span>酷狗音乐</span><h4>账号与歌单缓存</h4></div><div class="kugou-actions"><button type="button" :disabled="Boolean(kugouSyncing)" @click="syncKugou('account')">{{ kugouSyncing === 'account' ? '刷新中' : '刷新账号' }}</button><button class="save-button" type="button" :disabled="Boolean(kugouSyncing)" @click="syncKugou('playlists')">{{ kugouSyncing === 'playlists' ? '同步中' : '同步歌单' }}</button></div></header>
                  <div class="kugou-summary"><span>本地运行时缓存</span><span>歌单 {{ kugouCache()?.playlists?.length || 0 }} 个</span><span>更新于 {{ formatSyncTime(kugouCache()?.playlistsSyncedAt) }}</span><button type="button" @click="queueClearKugouMediaCache">清理媒体缓存</button></div>
                  <div v-if="kugouCache()?.playlists?.length" class="kugou-playlists"><article v-for="playlist in kugouCache()?.playlists" :key="playlist.id" class="kugou-playlist"><img v-if="playlist.cover" :src="playlist.cover" alt=""><span v-else class="playlist-cover-fallback" aria-hidden="true">♪</span><div><strong :title="playlist.name">{{ playlist.name }}</strong><small>{{ playlist.trackCount }} 首歌曲</small><small>{{ playlist.syncedAt ? `已同步 ${formatSyncTime(playlist.syncedAt)}` : '歌曲尚未同步' }}</small></div><footer><button type="button" :disabled="Boolean(kugouSyncing)" @click="syncKugou('tracks', playlist.id)">{{ kugouSyncing === `tracks:${playlist.id}` ? '同步中' : playlist.syncedAt ? '重新同步' : '同步歌曲' }}</button><template v-if="playlist.syncedAt"><button type="button" @click="viewKugouTracks(playlist)">查看歌曲</button><button :class="{ selected: configValues.navbarPlaylistId === playlist.id }" type="button" @click="setNavbarPlaylist(playlist)">{{ configValues.navbarPlaylistId === playlist.id ? '导航歌单' : '设为导航歌单' }}</button></template></footer></article></div>
                  <p v-else class="kugou-empty">尚未读取到歌单。点击“同步歌单”从酷狗账号重新获取。</p>
                </section>
              </div>
              <div class="editor-actions"><span>{{ configSaving ? '正在保存配置…' : '保存后自动热更新模块' }}</span><div><button type="button" :disabled="configSaving" @click="selectInstance(selectedInstance)">还原</button><button class="save-button" type="button" :disabled="configSaving" @click="saveConfig">{{ configSaving ? '保存中' : '保存配置' }}</button></div></div>
            </div>
            <div v-else class="config-detail-loader" role="status"><span /><p>{{ configDetailLoading ? '正在加载配置' : '请选择配置' }}</p></div>
          </div>
          <p v-else-if="!configLoading" class="state">没有找到可管理的模板配置。配置文件必须存在且包含 config_template。</p>
        </section>
      </template>

      <template v-else-if="activeSection === 'backup' && isOwner">
        <section class="panel">
          <div class="panel-heading"><div><h2>备份快照</h2><p class="panel-copy">快照包含实际配置、Storage 数据库和运行态文件。恢复功能将在受 launcher 协调的停机流程中开放。</p></div><button class="save-button" type="button" :disabled="backupCreating" @click="createBackup">{{ backupCreating ? '创建中' : '创建备份' }}</button></div>
          <div v-if="backupsLoading" class="state">加载中</div>
          <div v-else class="backup-list">
            <div v-for="backup in backups" :key="backup.id" class="backup-row"><div><strong>{{ backup.id }}</strong><small>{{ backup.created_at }} · {{ backup.created_by }} · {{ backup.files }} 个文件 · {{ formatBytes(backup.bytes) }}</small></div><button class="delete-button" type="button" @click="queueDeleteBackup(backup)">删除</button></div>
            <p v-if="!backups.length" class="state">暂无备份快照</p>
          </div>
        </section>
      </template>

      <section v-else class="panel restricted-panel"><h2>{{ allSections.find(item => item.id === activeSection)?.label }}</h2><p>该分区仅所有者可访问，后续将提供备份恢复和安全会话管理。</p></section>
    </main>

    <BaseDialog :open="Boolean(confirmAction)" :title="confirmAction?.title || ''" @close="!runningAction && (confirmAction = null)">
      <p class="dialog-text">{{ confirmAction?.text }}</p>
      <div class="dialog-actions"><button type="button" :disabled="runningAction" @click="confirmAction = null">取消</button><button class="danger-action" type="button" :disabled="runningAction" @click="executeConfirmed">{{ runningAction ? '执行中' : '确认执行' }}</button></div>
    </BaseDialog>

    <BaseDialog :open="Boolean(instanceDialog)" :title="instanceDialog === 'create' ? '新增配置实例' : '重命名配置实例'" @close="!instanceSubmitting && (instanceDialog = null)">
      <form class="instance-dialog" @submit.prevent="submitInstanceDialog"><label>实例名称<input v-model="instanceNameInput" autocomplete="off" autofocus maxlength="64" placeholder="例如 default 或 config-2"></label><p>支持字母、数字、下划线、短横线和点。新增实例会采用模板默认值。</p><div class="dialog-actions"><button type="button" :disabled="instanceSubmitting" @click="instanceDialog = null">取消</button><button class="primary-action" type="submit" :disabled="instanceSubmitting">{{ instanceSubmitting ? '提交中' : '确认' }}</button></div></form>
    </BaseDialog>
    <BaseDialog :open="Boolean(kugouTracks || kugouTracksLoading)" size="large" :title="`${kugouTrackPlaylist} · ${kugouTrackTotal} 首歌曲`" @close="!kugouTracksLoading && (kugouTracks = null)">
      <section class="kugou-track-browser"><div class="kugou-track-list"><p v-if="kugouTracksLoading">正在读取本地歌曲缓存</p><p v-else-if="!kugouTracks?.length">该歌单尚未同步歌曲。</p><article v-for="(track, index) in kugouTracks" :key="track.hash || track.filehash || index"><span class="track-index">{{ (kugouTrackPage - 1) * kugouTrackPageSize + index + 1 }}</span><img v-if="track.cover" :src="track.cover.replace('{size}', '60')" alt=""><span v-else class="track-cover" aria-hidden="true">♪</span><div><strong :title="kugouTrackTitle(track)">{{ kugouTrackTitle(track) }}</strong><small>{{ kugouTrackArtist(track) }}</small></div><aside><span>{{ track.language || '未知语言' }}</span><time>{{ kugouTrackDuration(track.timelen) }}</time></aside></article></div><footer v-if="kugouTrackTotal" class="kugou-track-pagination"><span>{{ kugouTrackPage }} <i>/</i> {{ kugouTrackTotalPages }}</span><div><button type="button" aria-label="上一页" title="上一页" :disabled="kugouTracksLoading || kugouTrackPage === 1" @click="loadKugouTrackPage(kugouTrackPage - 1)">‹</button><button type="button" aria-label="下一页" title="下一页" :disabled="kugouTracksLoading || kugouTrackPage === kugouTrackTotalPages" @click="loadKugouTrackPage(kugouTrackPage + 1)">›</button></div></footer></section>
    </BaseDialog>
  </section>
</template>

<style scoped>
.audit-pagination { display:flex; align-items:center; justify-content:space-between; gap:10px; padding-top:12px; color:var(--muted-text); font-size:11px; }.audit-pagination > div { display:flex; align-items:center; gap:5px; }.audit-pagination button { min-height:28px; padding:0 8px; font-size:11px; }.audit-pagination input { width:42px; min-height:28px; box-sizing:border-box; padding:0 5px; color:var(--panel-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font:inherit; font-size:11px; text-align:center; }
.audit-panel { display:flex; flex-direction:column; height:calc(100dvh - 112px); min-height:320px; }.audit-panel .audit-table { flex:1 1 auto; min-height:0; overflow:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:var(--accent) var(--surface); }.audit-panel .audit-table::-webkit-scrollbar { width:7px; height:7px; }.audit-panel .audit-table::-webkit-scrollbar-track { background:var(--surface); }.audit-panel .audit-table::-webkit-scrollbar-thumb { background:var(--accent); border:2px solid var(--surface); border-radius:5px; }.audit-panel .audit-head { position:sticky; z-index:1; top:0; background:var(--panel-bg); }.audit-panel .audit-pagination { flex:0 0 auto; }
.system-page { --page-x:clamp(12px, 3vw, 42px); position:relative; width:100%; min-height:100vh; margin:0; padding:80px 0 48px; color:var(--panel-text); overflow:hidden; }.system-page button { border:1px solid var(--border); border-radius:5px; color:var(--panel-text); background:var(--surface); font:inherit; cursor:pointer; }.system-page button:hover { background:var(--surface-hover); }.system-page button:disabled { opacity:.55; cursor:wait; }
.system-nav-shell { position:fixed; z-index:9; top:0; left:0; width:clamp(12px, 3vw, 42px); height:100dvh; }.system-nav { position:fixed; z-index:9; top:50%; left:0; display:grid; grid-template-columns:1fr; gap:4px; width:76px; padding:6px; color:var(--panel-text); background:var(--panel-bg); border:1px solid var(--border); border-radius:5px; box-shadow:0 18px 48px var(--shadow); transform:translateY(-50%) translateX(calc(-100% + clamp(12px, 3vw, 42px))); transition:transform .28s cubic-bezier(.22, 1, .36, 1); }.system-nav-shell.is-open .system-nav { transform:translateY(-50%) translateX(0); } @media (min-width:761px) { .system-nav-shell:hover .system-nav { transform:translateY(-50%) translateX(0); } }.system-nav-toggle { position:absolute; z-index:1; top:50%; right:-9px; display:none; place-items:center; width:9px; height:58px; padding:0; color:var(--accent-contrast); background:var(--accent); border:0; border-radius:0 5px 5px 0; box-shadow:0 8px 22px var(--shadow); transform:translateY(-50%); }.system-nav-toggle span { font-size:14px; line-height:1; }.system-nav-item { display:grid; place-items:center; align-content:center; gap:6px; aspect-ratio:1; width:100%; padding:6px; color:var(--muted-text); background:transparent; border:0; border-radius:5px; text-align:center; cursor:pointer; transition:color .2s ease, background-color .2s ease; }.system-nav-item:hover { color:var(--panel-text); background:var(--surface-hover); }.system-nav-item.active { color:var(--accent); background:var(--surface-selected); }.system-nav-icon { display:grid; place-items:center; width:20px; height:20px; font-size:14px; }.system-nav-label { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:12px; font-weight:650; }
.system-workspace { min-width:0; padding-top:18px; }.metric-grid { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); gap:10px; margin-bottom:12px; }.metric, .panel { border:1px solid var(--border); border-radius:5px; background:color-mix(in srgb, var(--panel-bg) 76%, transparent); box-shadow:0 8px 20px color-mix(in srgb, var(--shadow) 18%, transparent); }.metric { display:grid; gap:9px; min-height:90px; padding:14px; }.metric span, small, .muted { color:var(--muted-text); font-size:12px; }.metric strong { font-size:22px; }.danger { color:var(--danger); }.panel { padding:18px; }.panel-heading { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:14px; }.panel h2, .panel h3 { margin:0; }.panel h2 { font-size:15px; }.panel h3 { padding-bottom:9px; border-bottom:1px solid var(--border); font-size:13px; }.panel-copy { max-width:640px; margin:5px 0 0; color:var(--muted-text); font-size:12px; line-height:1.5; } dl { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); margin:0; } dl div { display:flex; justify-content:space-between; gap:12px; padding:12px 0; border-top:1px solid color-mix(in srgb, var(--border) 65%, transparent); font-size:13px; } dt { color:var(--muted-text); } dd { margin:0; font-weight:700; text-align:right; }
.text-button { padding:6px 9px; color:var(--accent); font-size:12px; }.module-groups { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:12px; }.module-group { min-width:0; border:1px solid var(--border); border-radius:5px; overflow:hidden; }.module-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:11px; border-top:1px solid var(--border); }.module-row div { min-width:0; display:grid; gap:4px; }.module-row strong, .module-row small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.module-row button, .maintenance button { flex:none; min-width:54px; height:30px; padding:0 9px; font-size:12px; font-weight:700; }.state { margin:0; padding:18px; color:var(--muted-text); text-align:center; font-size:13px; }.maintenance { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-bottom:12px; }.maintenance p, .restricted-panel p { margin:6px 0 0; color:var(--muted-text); font-size:13px; line-height:1.6; }.danger-zone { border-color:color-mix(in srgb, var(--danger) 44%, var(--border)); }.danger-zone button, .danger-action, .delete-button { color:var(--danger); border-color:color-mix(in srgb, var(--danger) 45%, var(--border)); }.audit-table { overflow-x:auto; }.audit-head, .audit-row { display:grid; grid-template-columns:150px 100px 160px minmax(130px, 1fr) 52px; gap:10px; min-width:680px; align-items:center; padding:10px 0; font-size:12px; }.audit-head { color:var(--muted-text); border-bottom:1px solid var(--border); }.audit-row { border-bottom:1px solid color-mix(in srgb, var(--border) 56%, transparent); }.audit-row span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.success { color:var(--success-text); }.failed { color:var(--danger); }.restricted-panel { min-height:160px; }.backup-list { display:grid; }.backup-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 0; border-top:1px solid var(--border); }.backup-row div { display:grid; min-width:0; gap:5px; }.backup-row strong, .backup-row small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.backup-row button { height:30px; padding:0 10px; font-size:12px; font-weight:700; }.config-layout { display:grid; grid-template-columns:minmax(180px, .28fr) minmax(0, 1fr); min-height:390px; border:1px solid var(--border); border-radius:5px; overflow:hidden; }.config-list { display:grid; align-content:start; border-right:1px solid var(--border); background:color-mix(in srgb, var(--surface) 58%, transparent); }.config-list button { display:grid; gap:4px; width:100%; padding:11px; color:var(--muted-text); background:transparent; border:0; border-bottom:1px solid var(--border); border-radius:0; text-align:left; }.config-list button.active { color:var(--accent); background:var(--surface-selected); }.config-list small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.config-editor { padding:16px; }.editor-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:12px; margin-bottom:16px; }.editor-heading h3 { padding:0; border:0; }.editor-heading p { margin:5px 0 0; color:var(--muted-text); font-size:12px; }.editor-heading select { height:32px; max-width:180px; color:var(--panel-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font-size:12px; }.editor-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }.editor-actions button { height:34px; padding:0 12px; font-size:12px; font-weight:700; }.save-button { color:var(--accent-contrast); background:var(--accent); border-color:var(--accent); }.dialog-text { margin:0; color:var(--muted-text); line-height:1.6; }.dialog-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; }.dialog-actions button { height:34px; padding:0 13px; font-size:12px; font-weight:700; }
@media (max-width:760px) { .system-page { padding:76px 0 32px; margin:0; }.system-nav-shell { width:0; height:0; }.system-nav { width:68px; padding:5px; transform:translateY(-50%) translateX(calc(-100% + 12px)); }.system-nav-toggle { display:grid; }.system-nav-label { font-size:10px; }.metric-grid, .module-groups { grid-template-columns:repeat(2, minmax(0, 1fr)); }.maintenance { align-items:flex-start; flex-direction:column; }.maintenance button { width:100%; }.audit-pagination { align-items:flex-start; flex-direction:column; }.audit-pagination > div { width:100%; overflow-x:auto; }.config-layout { grid-template-columns:1fr; }.config-list { display:flex; overflow-x:auto; border-right:0; border-bottom:1px solid var(--border); }.config-list button { flex:0 0 170px; }.config-editor { padding:14px; } }
@media (max-width:460px) { .metric-grid, dl { grid-template-columns:1fr; }.metric-grid { gap:8px; }.module-groups { grid-template-columns:1fr; } }

/* Runtime control intentionally uses a denser operational layout than the other settings panels. */
.module-console { overflow:hidden; border:1px solid var(--border); border-radius:5px; background:color-mix(in srgb, var(--panel-bg) 82%, transparent); box-shadow:0 12px 28px color-mix(in srgb, var(--shadow) 24%, transparent); }
.console-header { display:flex; align-items:flex-end; justify-content:space-between; gap:18px; padding:20px; border-bottom:1px solid var(--border); background:color-mix(in srgb, var(--surface) 45%, transparent); }.console-kicker { margin:0 0 5px; color:var(--accent); font-size:10px; font-weight:800; letter-spacing:.12em; }.console-header h2 { margin:0; font-size:17px; }.console-header p:not(.console-kicker) { max-width:560px; margin:6px 0 0; color:var(--muted-text); font-size:12px; line-height:1.55; }.console-refresh { height:32px; padding:0 11px; color:var(--accent); font-size:12px; font-weight:700; }
.module-summary { display:grid; grid-template-columns:repeat(4, minmax(0, 1fr)); border-bottom:1px solid var(--border); }.module-summary div { display:grid; gap:5px; padding:13px 16px; border-right:1px solid var(--border); }.module-summary div:last-child { border-right:0; }.module-summary span { color:var(--muted-text); font-size:11px; }.module-summary strong { color:var(--panel-text); font-size:18px; }.console-state { display:flex; align-items:center; justify-content:center; gap:9px; min-height:250px; color:var(--muted-text); font-size:13px; }.console-loader { width:16px; height:16px; border:2px solid color-mix(in srgb, var(--accent) 22%, transparent); border-top-color:var(--accent); border-radius:50%; animation:console-spin .8s linear infinite; } @keyframes console-spin { to { transform:rotate(360deg); } }
.module-board { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); }.module-lane { min-width:0; border-right:1px solid var(--border); border-bottom:1px solid var(--border); }.module-lane:nth-child(2n) { border-right:0; }.module-lane:nth-last-child(-n + 2) { border-bottom:0; }.module-lane > header { display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:68px; padding:0 14px; border-bottom:1px solid var(--border); }.module-lane > header > div { display:grid; grid-template-columns:10px auto; align-items:center; column-gap:8px; }.module-lane h3 { margin:0; font-size:13px; }.module-lane header small { grid-column:2; margin-top:2px; color:var(--muted-text); font-size:11px; }.module-lane header button { height:28px; padding:0 8px; color:var(--muted-text); font-size:11px; }.lane-mark { grid-row:span 2; width:6px; height:28px; border-radius:3px; background:var(--accent); }.lane-mark.chat { background:#42a5f5; }.lane-mark.game { background:var(--success); }.lane-mark.storage { background:var(--warning); }
.unit-list { display:grid; }.module-unit { display:grid; grid-template-columns:76px minmax(0, 1fr) auto; align-items:center; gap:12px; min-height:88px; padding:10px 14px; border-bottom:1px solid color-mix(in srgb, var(--border) 70%, transparent); }.module-unit:last-child { border-bottom:0; }.module-unit.stopped { background:color-mix(in srgb, var(--surface) 40%, transparent); }.unit-state { display:grid; justify-items:start; gap:5px; color:var(--muted-text); font-size:10px; font-weight:700; }.unit-state > span:first-child { width:8px; height:8px; border-radius:50%; background:var(--muted-text); box-shadow:0 0 0 3px color-mix(in srgb, var(--muted-text) 16%, transparent); }.unit-state > span.running { background:var(--success); box-shadow:0 0 0 3px color-mix(in srgb, var(--success) 16%, transparent); }.unit-main { min-width:0; display:grid; gap:3px; }.unit-main strong { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; }.unit-main p, .unit-main small { margin:0; overflow:hidden; color:var(--muted-text); text-overflow:ellipsis; white-space:nowrap; font-size:11px; }.unit-main small { color:color-mix(in srgb, var(--muted-text) 80%, transparent); }.unit-actions { display:flex; gap:5px; }.unit-actions button { height:29px; min-width:42px; padding:0 8px; font-size:11px; font-weight:700; }.unit-actions .start { color:var(--success-text); border-color:color-mix(in srgb, var(--success) 42%, var(--border)); background:color-mix(in srgb, var(--success-soft) 50%, transparent); }.unit-actions .unload { color:var(--danger); border-color:color-mix(in srgb, var(--danger) 36%, var(--border)); }.empty-unit { margin:0; padding:22px; color:var(--muted-text); text-align:center; font-size:12px; }
@media (max-width:860px) { .module-summary { grid-template-columns:repeat(2, minmax(0, 1fr)); }.module-summary div:nth-child(2) { border-right:0; }.module-summary div:nth-child(-n + 2) { border-bottom:1px solid var(--border); }.module-board { grid-template-columns:1fr; }.module-lane, .module-lane:nth-child(2n), .module-lane:nth-last-child(-n + 2) { border-right:0; border-bottom:1px solid var(--border); }.module-lane:last-child { border-bottom:0; } }
@media (max-width:560px) { .console-header { align-items:flex-start; flex-direction:column; padding:16px; }.console-refresh { width:100%; }.module-summary div { padding:11px; }.module-unit { grid-template-columns:1fr; gap:8px; padding:12px; }.unit-state { grid-auto-flow:column; justify-content:start; align-items:center; }.unit-actions { width:100%; }.unit-actions button { flex:1; }.module-lane > header { padding:0 12px; } }

/* Match data management: fixed viewport workspace, with only the content area scrolling. */
.system-page { height:100dvh; min-height:0; box-sizing:border-box; padding-top:76px; padding-bottom:0; overflow:hidden; }
.system-workspace { height:100%; padding:0 0 32px; margin:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:var(--accent) var(--surface); }
.system-workspace::-webkit-scrollbar { width:7px; }.system-workspace::-webkit-scrollbar-track { background:var(--surface); }.system-workspace::-webkit-scrollbar-thumb { background:var(--accent); border:2px solid var(--surface); border-radius:5px; }
.module-console { min-height:100%; border:0; border-radius:0; background:transparent; box-shadow:none; }.console-header { padding:20px 0 16px; border-bottom:1px solid var(--border); background:transparent; }.module-summary { margin-bottom:14px; border:1px solid var(--border); border-radius:5px; overflow:hidden; background:color-mix(in srgb, var(--panel-bg) 74%, transparent); }.module-groups-card { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:14px; align-items:start; }.module-category { overflow:hidden; border:1px solid var(--border); border-radius:5px; background:color-mix(in srgb, var(--panel-bg) 70%, transparent); box-shadow:0 8px 20px color-mix(in srgb, var(--shadow) 16%, transparent); }.module-category > header { display:flex; align-items:center; justify-content:space-between; min-height:60px; padding:0 14px; border-bottom:1px solid var(--border); }.module-category > header > div { display:flex; align-items:center; gap:10px; min-width:0; }.module-category h3 { margin:0; font-size:13px; }.module-category header small { display:block; margin-top:3px; color:var(--muted-text); font-size:11px; }.module-category header button { height:28px; padding:0 8px; color:var(--muted-text); font-size:11px; }.category-line { display:block; width:4px; height:28px; border-radius:3px; background:var(--accent); }.category-line.chat { background:#42a5f5; }.category-line.game { background:var(--success); }.category-line.storage { background:var(--warning); }
.module-card-grid { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:10px; padding:10px; }.module-card { display:grid; grid-template-rows:auto auto minmax(30px, 1fr) auto auto; gap:7px; min-width:0; min-height:176px; padding:12px; border:1px solid var(--border); border-radius:5px; background:color-mix(in srgb, var(--surface) 60%, transparent); }.module-card.stopped { opacity:.72; background:color-mix(in srgb, var(--surface) 34%, transparent); }.card-top { display:flex; justify-content:space-between; gap:8px; }.state-badge { display:inline-flex; align-items:center; gap:5px; color:var(--muted-text); font-size:10px; font-weight:700; }.state-badge i { width:7px; height:7px; border-radius:50%; background:var(--muted-text); }.state-badge.running { color:var(--success-text); }.state-badge.running i { background:var(--success); }.state-badge.connecting { color:var(--warning-text); }.state-badge.connecting i { background:var(--warning); }.card-type { color:color-mix(in srgb, var(--muted-text) 78%, transparent); font-size:10px; font-weight:800; letter-spacing:.08em; }.module-card > strong, .module-card p, .module-card small { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.module-card > strong { font-size:13px; }.module-card p, .module-card small { margin:0; color:var(--muted-text); font-size:11px; }.module-card small { color:color-mix(in srgb, var(--muted-text) 76%, transparent); }.module-card footer { display:flex; gap:5px; align-self:end; }.module-card footer button { flex:1; height:29px; padding:0 7px; font-size:11px; font-weight:700; }.module-card .start { color:var(--success-text); border-color:color-mix(in srgb, var(--success) 42%, var(--border)); background:color-mix(in srgb, var(--success-soft) 50%, transparent); }.module-card .unload { color:var(--danger); border-color:color-mix(in srgb, var(--danger) 36%, var(--border)); }.empty-card { grid-column:1 / -1; margin:0; padding:28px 12px; color:var(--muted-text); text-align:center; font-size:12px; }
@media (max-width:900px) { .module-groups-card { grid-template-columns:1fr; }.module-card-grid { grid-template-columns:repeat(3, minmax(0, 1fr)); } }
@media (max-width:760px) { .system-page { height:100dvh; padding-top:76px; }.system-workspace { padding:0 0 24px; margin:0; }.console-header { padding:16px 0 14px; }.module-card-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }.module-summary { margin-bottom:12px; } }
@media (max-width:480px) { .module-card-grid { grid-template-columns:1fr; }.module-summary { grid-template-columns:repeat(2, minmax(0, 1fr)); }.module-category > header { padding:0 12px; }.module-card { min-height:154px; } }

/* Compact runtime matrix: category bands frame the cards without turning every area into a panel. */
.system-workspace { overflow-y:auto; scrollbar-gutter:auto; scrollbar-width:none; }
.system-workspace::-webkit-scrollbar { display:none; }
.module-console { min-height:0; }.console-header, .module-summary { display:none; }
.console-toolbar { display:flex; align-items:center; gap:16px; min-height:46px; padding:0; border-bottom:1px solid var(--border); }.runtime-label { display:flex; align-items:center; gap:8px; min-width:0; }.runtime-label > span { width:7px; height:7px; border-radius:50%; background:var(--success); box-shadow:0 0 0 3px color-mix(in srgb, var(--success) 18%, transparent); }.runtime-label strong { font-size:13px; }.runtime-label small { color:var(--muted-text); font-size:11px; }.runtime-metrics { display:flex; align-items:center; gap:14px; flex:1; color:var(--muted-text); font-size:11px; }.runtime-metrics span { white-space:nowrap; }.runtime-metrics strong { margin-left:3px; color:var(--panel-text); font-size:11px; }.console-refresh { height:28px; padding:0 9px; color:var(--muted-text); font-size:11px; font-weight:700; }
.module-groups-card { display:grid; grid-template-columns:repeat(2, minmax(0, 1fr)); gap:28px 20px; padding:20px 0 32px; }.module-category { overflow:visible; border:0; border-radius:0; background:transparent; box-shadow:none; }.module-category > header { min-height:34px; padding:0 0 10px; border-bottom:1px solid var(--border); }.module-category > header > div { gap:8px; }.module-category h3 { font-size:13px; }.module-category header small { margin-top:2px; font-size:10px; }.module-category header button { height:26px; padding:0 7px; color:var(--muted-text); background:transparent; border-color:transparent; font-size:10px; }.module-category header button:hover { color:var(--accent); border-color:var(--border); }.category-line { width:3px; height:24px; }
.module-card-grid { grid-template-columns:repeat(auto-fill, minmax(210px, 1fr)); gap:8px; padding:10px 0 0; }.module-card { grid-template-rows:auto auto minmax(28px, 1fr) auto auto; min-height:150px; padding:11px; border-color:color-mix(in srgb, var(--border) 86%, transparent); border-radius:4px; background:color-mix(in srgb, var(--surface) 42%, transparent); box-shadow:none; transition:border-color .16s ease, background-color .16s ease; }.module-card:hover { border-color:color-mix(in srgb, var(--accent) 45%, var(--border)); background:color-mix(in srgb, var(--surface) 70%, transparent); }.module-card.stopped { opacity:1; background:color-mix(in srgb, var(--surface) 22%, transparent); }.module-card > strong { font-size:12px; }.module-card p, .module-card small { font-size:10px; }.card-type { font-size:9px; }.state-badge { font-size:9px; }.state-badge i { width:6px; height:6px; }.module-card footer { padding-top:2px; }.module-card footer button { height:27px; font-size:10px; }
@media (max-width:900px) { .module-groups-card { grid-template-columns:1fr; gap:24px; }.module-card-grid { grid-template-columns:repeat(auto-fill, minmax(190px, 1fr)); } }
@media (max-width:620px) { .console-toolbar { flex-wrap:wrap; gap:6px 12px; min-height:0; padding:10px 0; }.runtime-label { flex:1; }.runtime-metrics { order:3; width:100%; gap:10px; overflow-x:auto; }.console-refresh { margin-left:auto; }.module-groups-card { padding-top:16px; }.module-card-grid { grid-template-columns:repeat(2, minmax(0, 1fr)); }.module-card { min-height:145px; } }
@media (max-width:430px) { .module-card-grid { grid-template-columns:1fr; }.runtime-metrics { justify-content:space-between; } }

/* Module management follows the data-management pattern: a narrow category rail and a focused content pane. */
.module-split { display:grid; grid-template-columns:154px minmax(0, 1fr); height:calc(100dvh - 127px); min-height:360px; padding:18px 0 0; overflow:hidden; }.module-type-nav { align-self:start; display:grid; gap:4px; padding:6px; color:var(--panel-text); background:color-mix(in srgb, var(--panel-bg) 65%, transparent); backdrop-filter:blur(18px); -webkit-backdrop-filter:blur(18px); border:1px solid color-mix(in srgb, var(--border) 60%, transparent); border-radius:5px; box-shadow:0 12px 28px color-mix(in srgb, var(--shadow) 20%, transparent); }.module-type-nav button { display:grid; grid-template-columns:4px minmax(0, 1fr) auto; align-items:center; gap:8px; min-height:38px; padding:0 8px; color:var(--muted-text); background:transparent; border:0; border-radius:4px; text-align:left; font-size:11px; font-weight:700; }.module-type-nav button:hover { color:var(--panel-text); background:var(--surface-hover); }.module-type-nav button.active { color:var(--accent); background:var(--surface-selected); }.type-mark { width:3px; height:18px; border-radius:2px; background:var(--accent); }.type-mark.chat_adapter { background:#42a5f5; }.type-mark.game_adapter { background:var(--success); }.type-mark.storage { background:var(--warning); }.module-type-nav small { color:inherit; opacity:.76; font-size:10px; font-weight:650; }.module-type-content { min-width:0; height:100%; padding:0 0 32px 18px; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; scrollbar-width:thin; scrollbar-color:var(--accent) var(--surface); }.module-type-content::-webkit-scrollbar { width:7px; }.module-type-content::-webkit-scrollbar-track { background:var(--surface); border-radius:5px; }.module-type-content::-webkit-scrollbar-thumb { background:var(--accent); border:2px solid var(--surface); border-radius:5px; }.module-list-heading { display:flex; align-items:center; justify-content:space-between; min-height:40px; padding-bottom:12px; border-bottom:1px solid var(--border); }.module-list-heading > div { display:flex; align-items:center; gap:9px; }.module-list-heading h2 { margin:0; font-size:14px; }.module-list-heading small { display:block; margin-top:3px; color:var(--muted-text); font-size:10px; }.module-list-heading button { height:28px; padding:0 8px; color:var(--muted-text); background:transparent; border-color:transparent; font-size:10px; }.module-list-heading button:hover { color:var(--accent); border-color:var(--border); }.module-type-content .module-card-grid { padding-top:12px; }
.system-workspace.modules-workspace { overflow:hidden; }

/* Configuration editor keeps both panes stable and independently scrollable. */
.system-workspace.config-workspace { overflow:hidden; }
.config-workspace .config-panel { position:relative; display:flex; flex-direction:column; height:100%; min-height:0; box-sizing:border-box; margin:0; }.config-loading { position:absolute; z-index:4; inset:0; display:grid; place-items:center; margin:0; color:var(--muted-text); background:color-mix(in srgb, var(--panel-bg) 72%, transparent); backdrop-filter:blur(2px); font-size:12px; pointer-events:none; }.config-workspace .config-layout { flex:1 1 auto; min-height:0; overflow:hidden; }.config-workspace .config-list { min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; scrollbar-width:thin; scrollbar-color:var(--accent) var(--surface); }.config-workspace .config-editor { display:flex; flex-direction:column; min-height:0; overflow:hidden; }.config-workspace .config-editor-scroll { flex:1 1 auto; min-height:0; padding-right:4px; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; scrollbar-width:thin; scrollbar-color:var(--accent) var(--surface); }.config-workspace .config-form { min-height:0; }.config-workspace .config-list::-webkit-scrollbar, .config-workspace .config-editor-scroll::-webkit-scrollbar { width:7px; }.config-workspace .config-list::-webkit-scrollbar-track, .config-workspace .config-editor-scroll::-webkit-scrollbar-track { background:var(--surface); }.config-workspace .config-list::-webkit-scrollbar-thumb, .config-workspace .config-editor-scroll::-webkit-scrollbar-thumb { background:var(--accent); border:2px solid var(--surface); border-radius:5px; }.config-workspace .editor-actions { position:static; flex:0 0 auto; margin:0; }
.config-workspace .config-panel { display:flex; flex-direction:column; height:100%; min-height:0; box-sizing:border-box; margin:0; }.config-loading { flex:0 0 auto; padding:0 0 10px; }.config-workspace .config-layout { flex:1 1 auto; min-height:0; overflow:hidden; }.config-workspace .config-list { min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; scrollbar-width:thin; scrollbar-color:var(--accent) var(--surface); }.config-workspace .config-editor { display:flex; flex-direction:column; min-height:0; padding:0; overflow:hidden; }.config-workspace .config-editor-scroll { flex:1 1 auto; min-height:0; padding:16px 16px 12px; overflow-y:auto; overscroll-behavior:contain; scrollbar-gutter:stable; scrollbar-width:thin; scrollbar-color:var(--accent) var(--surface); }.config-workspace .config-form { min-height:0; }.config-workspace .config-list::-webkit-scrollbar, .config-workspace .config-editor-scroll::-webkit-scrollbar { width:7px; }.config-workspace .config-list::-webkit-scrollbar-track, .config-workspace .config-editor-scroll::-webkit-scrollbar-track { background:var(--surface); }.config-workspace .config-list::-webkit-scrollbar-thumb, .config-workspace .config-editor-scroll::-webkit-scrollbar-thumb { background:var(--accent); border:2px solid var(--surface); border-radius:5px; }.config-workspace .editor-actions { position:static; flex:0 0 auto; margin:0; }
@media (max-width:760px) { .config-workspace .config-panel { height:100%; }.config-workspace .config-layout { grid-template-rows:minmax(66px, auto) minmax(0, 1fr); }.config-workspace .config-list { display:flex; min-height:0; overflow-x:auto; overflow-y:hidden; scrollbar-gutter:auto; }.config-workspace .config-list button { flex:0 0 164px; }.config-workspace .config-editor { padding:14px; }.config-workspace .config-form { padding-right:2px; }.config-workspace .editor-actions { margin-top:10px; padding-top:10px; } }
@media (max-width:760px) { .module-split { grid-template-columns:1fr; grid-template-rows:auto minmax(0, 1fr); height:calc(100dvh - 123px); gap:14px; padding-top:14px; }.module-type-nav { grid-template-columns:repeat(4, minmax(0, 1fr)); gap:4px; padding:5px; }.module-type-nav button { grid-template-columns:1fr; justify-items:center; gap:3px; min-height:48px; padding:5px 3px; text-align:center; }.module-type-nav .type-mark { width:18px; height:3px; }.module-type-nav small { font-size:9px; }.module-type-content { padding:0 0 24px; }.module-list-heading { padding-bottom:10px; } }
@media (max-width:430px) { .module-type-nav button { font-size:10px; }.module-type-nav small { display:none; } }

.console-refresh { display:grid; place-items:center; width:28px; padding:0; border-color:transparent; background:transparent; font-size:16px; line-height:1; }.console-refresh:hover:not(:disabled) { color:var(--accent); border-color:var(--border); background:var(--surface-hover); }.console-refresh.spinning span { animation:console-spin .8s linear infinite; }
.module-type-nav { background:color-mix(in srgb, var(--panel-bg) 58%, transparent); border-color:color-mix(in srgb, var(--border) 78%, transparent); box-shadow:0 12px 28px color-mix(in srgb, var(--shadow) 16%, transparent); backdrop-filter:blur(12px); }.module-type-nav button:hover { background:color-mix(in srgb, var(--surface-hover) 68%, transparent); }.module-type-nav button.active { background:color-mix(in srgb, var(--surface-selected) 72%, transparent); }
.kugou-heading > div { min-width:0; }.kugou-actions { display:grid; grid-template-columns:max-content max-content; flex:none; gap:6px; white-space:nowrap; }.kugou-actions button { white-space:nowrap; }
.kugou-summary button { min-height:20px; margin-left:auto; padding:0 6px; color:var(--muted-text); background:transparent; border-color:transparent; font-size:9px; }.kugou-summary button:hover { color:var(--danger); border-color:color-mix(in srgb, var(--danger) 42%, var(--border)); }
.kugou-playlist footer { grid-column:1 / -1; display:flex; flex-wrap:wrap; gap:5px; }.kugou-playlist footer button { min-width:0; }.kugou-playlist footer button.selected { color:var(--accent-contrast); background:var(--accent); border-color:var(--accent); }.kugou-track-browser { display:flex; flex:1; flex-direction:column; min-height:0; }.kugou-track-list { flex:1; min-height:0; overflow-y:auto; border-top:1px solid var(--border); scrollbar-width:thin; scrollbar-color:color-mix(in srgb, var(--accent) 56%, var(--border)) transparent; }.kugou-track-list::-webkit-scrollbar { width:5px; }.kugou-track-list::-webkit-scrollbar-track { background:transparent; }.kugou-track-list::-webkit-scrollbar-thumb { background:color-mix(in srgb, var(--accent) 56%, var(--border)); border:0; border-radius:99px; }.kugou-track-list::-webkit-scrollbar-thumb:hover { background:var(--accent); }.kugou-track-list > p { margin:0; padding:22px 0; color:var(--muted-text); font-size:12px; text-align:center; }.kugou-track-list article { display:grid; grid-template-columns:28px 38px minmax(0, 1fr) auto; gap:9px; align-items:center; min-height:56px; padding:7px 8px 7px 2px; border-bottom:1px solid color-mix(in srgb, var(--border) 62%, transparent); }.kugou-track-list article:hover { background:color-mix(in srgb, var(--surface-hover) 42%, transparent); }.track-index { color:var(--muted-text); font-size:10px; text-align:center; }.kugou-track-list img, .track-cover { width:38px; height:38px; object-fit:cover; border-radius:3px; }.track-cover { display:grid; place-items:center; color:var(--muted-text); background:color-mix(in srgb, var(--surface-hover) 78%, transparent); font-size:16px; }.kugou-track-list article > div { display:grid; gap:3px; min-width:0; }.kugou-track-list strong, .kugou-track-list small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.kugou-track-list strong { font-size:12px; }.kugou-track-list small { color:var(--muted-text); font-size:10px; }.kugou-track-list aside { display:grid; justify-items:end; gap:4px; padding-right:3px; color:var(--muted-text); font-size:9px; }.kugou-track-list aside span { max-width:74px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.kugou-track-list time { font-variant-numeric:tabular-nums; font-size:10px; }.kugou-track-pagination { display:flex; flex:0 0 46px; align-items:center; justify-content:space-between; gap:10px; border-top:1px solid var(--border); color:var(--muted-text); font-size:11px; }.kugou-track-pagination > span { font-variant-numeric:tabular-nums; }.kugou-track-pagination i { margin:0 3px; color:color-mix(in srgb, var(--muted-text) 50%, transparent); font-style:normal; }.kugou-track-pagination > div { display:flex; gap:5px; }.kugou-track-pagination button { display:grid; place-items:center; width:28px; height:28px; padding:0; color:var(--panel-text); background:transparent; border-color:color-mix(in srgb, var(--border) 80%, transparent); border-radius:50%; font-size:20px; font-weight:400; line-height:1; }.kugou-track-pagination button:hover:not(:disabled) { color:var(--accent-contrast); background:var(--accent); border-color:var(--accent); }

/* BaseDialog teleports its slot to body, so its controls need explicit global styles. */
:global(.dialog-content .dialog-text) { margin:0; color:var(--muted-text); font-size:13px; line-height:1.6; }
:global(.dialog-content:has(.kugou-track-browser)) { display:flex; overflow:hidden; padding:12px 18px 0; }
:global(.dialog-content .dialog-actions) { display:flex; justify-content:flex-end; gap:8px; margin-top:20px; }
:global(.dialog-content .dialog-actions button) { min-width:76px; height:34px; padding:0 13px; color:var(--panel-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font:inherit; font-size:12px; font-weight:700; cursor:pointer; transition:background-color .16s ease, border-color .16s ease, color .16s ease; }
:global(.dialog-content .dialog-actions button:hover:not(:disabled)) { background:var(--surface-hover); border-color:var(--accent); }
:global(.dialog-content .dialog-actions button:disabled) { cursor:wait; opacity:.55; }
:global(.dialog-content .dialog-actions .danger-action) { color:var(--accent-contrast); background:var(--danger); border-color:var(--danger); }
:global(.dialog-content .dialog-actions .danger-action:hover:not(:disabled)) { color:var(--accent-contrast); background:color-mix(in srgb, var(--danger) 86%, #000); border-color:var(--danger); }
:global(.dialog-content .dialog-actions .primary-action) { color:var(--accent-contrast); background:var(--accent); border-color:var(--accent); }
:global(.dialog-content .dialog-actions .primary-action:hover:not(:disabled)) { color:var(--accent-contrast); background:color-mix(in srgb, var(--accent) 84%, #000); border-color:var(--accent); }
:global(.dialog-content .instance-dialog) { display:grid; gap:10px; }.instance-dialog label { display:grid; gap:6px; color:var(--panel-text); font-size:12px; font-weight:700; }.instance-dialog input { height:34px; padding:0 8px; color:var(--panel-text); background:var(--surface); border:1px solid var(--border); border-radius:4px; font:inherit; font-size:12px; }.instance-dialog input:focus { border-color:var(--accent); outline:0; }.instance-dialog p { margin:0; color:var(--muted-text); font-size:11px; line-height:1.5; }

.instance-add { height:30px; padding:0 9px; color:var(--accent-contrast); background:var(--accent); border-color:var(--accent); font-size:11px; font-weight:700; }.instance-toolbar { display:flex; align-items:end; justify-content:space-between; gap:12px; margin:0 0 16px; padding:10px; border:1px solid var(--border); border-radius:4px; background:color-mix(in srgb, var(--surface) 45%, transparent); }.instance-toolbar label { display:grid; flex:1; gap:5px; color:var(--muted-text); font-size:10px; font-weight:700; }.instance-toolbar select { width:min(240px, 100%); height:32px; color:var(--panel-text); background:var(--panel-bg); border:1px solid var(--border); border-radius:4px; font:inherit; font-size:12px; }.instance-toolbar > div { display:flex; gap:6px; }.instance-toolbar button { height:30px; padding:0 8px; font-size:11px; font-weight:700; }.instance-toolbar .instance-delete { color:var(--danger); border-color:color-mix(in srgb, var(--danger) 38%, var(--border)); }.instance-toolbar .instance-delete:disabled { color:var(--muted-text); border-color:var(--border); }
.world-map-cache { display:flex; align-items:center; justify-content:space-between; gap:16px; margin-top:18px; padding:14px 0 0; border-top:1px solid var(--border); }.world-map-cache > div { display:grid; grid-template-columns:auto auto; gap:3px 12px; align-items:baseline; }.world-map-cache span { grid-column:1 / -1; color:var(--accent); font-size:10px; font-weight:800; }.world-map-cache strong { font-size:13px; }.world-map-cache small { color:var(--muted-text); font-size:10px; }.world-map-cache button { flex:none; min-height:30px; padding:0 9px; color:var(--danger); background:transparent; border-color:color-mix(in srgb, var(--danger) 42%, var(--border)); font-size:10px; font-weight:700; }.world-map-cache button:hover:not(:disabled) { color:var(--accent-contrast); background:var(--danger); border-color:var(--danger); }
@media (max-width:520px) { .world-map-cache { align-items:stretch; flex-direction:column; }.world-map-cache button { width:100%; } }
.instance-add { display:inline-flex; align-items:center; gap:5px; height:28px; padding:0 9px; color:var(--muted-text); background:transparent; border-color:transparent; font-size:11px !important; font-weight:700; line-height:1; }.instance-add span { position:relative; display:block; flex:none; width:14px; height:14px; border:1px solid color-mix(in srgb, var(--accent) 55%, var(--border)); border-radius:50%; }.instance-add span::before, .instance-add span::after { position:absolute; top:50%; left:50%; width:7px; height:1px; background:var(--accent); content:""; transform:translate(-50%, -50%); }.instance-add span::after { transform:translate(-50%, -50%) rotate(90deg); }.instance-add:hover { color:var(--accent); background:color-mix(in srgb, var(--surface-hover) 55%, transparent); border-color:color-mix(in srgb, var(--border) 70%, transparent); }.instance-toolbar .base-select { width:min(240px, 100%); }.config-form { min-height:0; }.config-switch { animation:config-switch-in .12s ease-out; } @keyframes config-switch-in { from { opacity:0; transform:translateY(3px); } to { opacity:1; transform:translateY(0); } }.editor-actions { z-index:3; display:flex; align-items:center; justify-content:space-between; gap:12px; min-height:48px; padding:8px 14px; border-top:1px solid color-mix(in srgb, var(--border) 86%, transparent); background:color-mix(in srgb, var(--panel-bg) 90%, transparent); backdrop-filter:blur(12px); box-shadow:0 -8px 20px color-mix(in srgb, var(--shadow) 13%, transparent); }.editor-actions > span { color:var(--muted-text); font-size:10px; }.editor-actions > div { display:flex; flex:none; gap:6px; }.editor-actions > div button { min-width:68px; height:30px; padding:0 10px; font-size:11px; font-weight:700; }.editor-actions .save-button { color:var(--accent-contrast); background:var(--accent); border-color:var(--accent); }.editor-actions .save-button:hover:not(:disabled) { background:color-mix(in srgb, var(--accent) 85%, #000); }
.config-detail-loader { display:grid; place-content:center; justify-items:center; gap:9px; min-height:240px; color:var(--muted-text); border-left:1px solid var(--border); }.config-detail-loader span { width:18px; height:18px; border:2px solid color-mix(in srgb, var(--accent) 24%, transparent); border-top-color:var(--accent); border-radius:50%; animation:console-spin .7s linear infinite; }.config-detail-loader p { margin:0; font-size:12px; }
.kugou-sync { display:grid; gap:12px; margin-top:18px; padding:0; border-top:1px solid var(--border); background:transparent; }.kugou-heading { display:flex; align-items:center; justify-content:space-between; gap:14px; padding-top:14px; }.kugou-heading > div { display:grid; gap:3px; }.kugou-heading span { color:var(--accent); font-size:10px; font-weight:800; }.kugou-heading h4 { margin:0; font-size:13px; }.kugou-actions { display:flex; flex:none; gap:6px; }.kugou-actions button { min-height:28px; padding:0 8px; font-size:10px; }.kugou-summary { display:flex; flex-wrap:wrap; gap:5px 14px; padding:8px 10px; color:var(--muted-text); background:color-mix(in srgb, var(--surface) 38%, transparent); border-left:3px solid color-mix(in srgb, var(--accent) 65%, var(--border)); font-size:10px; }.kugou-playlists { display:grid; grid-template-columns:repeat(auto-fill, minmax(186px, 1fr)); gap:8px; }.kugou-playlist { display:grid; grid-template-columns:46px minmax(0, 1fr); grid-template-rows:auto auto; gap:8px 9px; min-width:0; padding:9px; border:1px solid color-mix(in srgb, var(--border) 80%, transparent); background:color-mix(in srgb, var(--surface) 36%, transparent); }.kugou-playlist img, .playlist-cover-fallback { grid-row:span 2; width:46px; height:46px; object-fit:cover; border-radius:3px; }.playlist-cover-fallback { display:grid; place-items:center; color:var(--muted-text); background:color-mix(in srgb, var(--surface-hover) 72%, transparent); font-size:19px; }.kugou-playlist div { display:grid; align-content:start; gap:2px; min-width:0; }.kugou-playlist strong, .kugou-playlist small { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.kugou-playlist strong { font-size:12px; }.kugou-playlist small { color:var(--muted-text); font-size:10px; }.kugou-playlist button { justify-self:start; min-height:25px; padding:0 7px; color:var(--muted-text); background:transparent; border-color:color-mix(in srgb, var(--border) 82%, transparent); font-size:10px; }.kugou-playlist button:hover:not(:disabled) { color:var(--accent); border-color:var(--accent); }.kugou-empty { margin:0; padding:15px 0 2px; color:var(--muted-text); font-size:11px; }
@media (max-width:520px) { .instance-toolbar { align-items:stretch; flex-direction:column; }.instance-toolbar .base-select { width:100%; }.instance-toolbar > div { display:grid; grid-template-columns:1fr 1fr; }.instance-toolbar button { width:100%; }.instance-add { flex:none; }.editor-actions { align-items:stretch; flex-direction:column; }.editor-actions > div { display:grid; grid-template-columns:1fr 1fr; width:100%; }.editor-actions > div button { width:100%; } }
</style>
