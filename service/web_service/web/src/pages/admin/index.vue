<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import StatCard from '../../components/admin/StatCard.vue'
import AdminIcon from '../../components/admin/AdminIcon.vue'
import { useAuthStore } from '../../stores/auth'
import { get } from '../../utils/request'

interface AdminOverview {
  stats: {
    total_users: number
    today_active: number
    today_messages: number
    today_points: number
    landmarks: number
    shops: number
  }
  recent_activity: Array<{ type: string; text: string; time: string }>
}

interface AdminHealth {
  server: { status: string; label: string; healthy: boolean; level: string; uptime: string }
  bot: { status: string; label: string; healthy: boolean; level: string }
  chat_adapters: Array<{ adapter: string; config: string; status: string; label: string; level: string }>
  plugin_counts: { game_adapter: number; chat_adapter: number }
  disk_usage: { percent: number; used: number; total: number }
  memory_usage: { percent: number; used: number; total: number }
  runtime: { hostname: string; platform: string; architecture: string; cpu: string; cpu_cores: number; process_memory: number; node_version: string }
  today_errors: number
  last_backup: string | null
}

const authStore = useAuthStore()

const welcomeName = computed(() => authStore.user?.username || authStore.user?.name || '管理员')
const roleLabel = computed(() => {
  const role = authStore.user?.role
  if (role === 'owner') return '所有者'
  if (role === 'admin') return '管理员'
  return '用户'
})

const loading = ref(true)
const error = ref<string | null>(null)
const overview = ref<AdminOverview | null>(null)
const health = ref<AdminHealth | null>(null)
let healthRefreshTimer: ReturnType<typeof setInterval> | null = null
let healthRefreshInFlight = false

const stats = computed(() => {
  const s = overview.value?.stats
  return [
    { title: '注册用户', value: formatNumber(s?.total_users), trend: '总计', icon: 'user-check' as const, variant: 'default' as const },
    { title: '今日活跃', value: formatNumber(s?.today_active), trend: '今日', icon: 'flame' as const, variant: 'accent' as const },
    { title: '今日消息', value: formatNumber(s?.today_messages), trend: '今日', icon: 'message' as const, variant: 'success' as const },
    { title: '积分流水', value: formatNumber(s?.today_points), trend: '今日', icon: 'points' as const, variant: 'warning' as const },
    { title: '地标', value: formatNumber(s?.landmarks), trend: '总计', icon: 'landmark' as const, variant: 'default' as const },
    { title: '商店', value: formatNumber(s?.shops), trend: '总计', icon: 'shop' as const, variant: 'accent' as const },
  ]
})

const quickLinks = ref([
  { label: '数据管理', to: '/admin/data', icon: 'chart-line' as const },
  { label: '分享管理', to: '/admin/shares', icon: 'share' as const },
  { label: '系统管理', to: '/admin/settings', icon: 'settings' as const },
])

const recentActivity = computed(() => overview.value?.recent_activity ?? [])

const serverStatus = computed(() => {
  const items: Array<{ label: string; platform: string; state: string; level: string; type: string; uptime?: string }> = [
    { label: '服务器', platform: 'server', state: health.value?.server.label ?? '—', level: health.value?.server.level ?? 'ok', type: 'server', uptime: health.value?.server.uptime },
    { label: 'BOT', platform: 'game_adapter', state: health.value?.bot.label ?? '—', level: health.value?.bot.level ?? 'na', type: 'bot' },
  ]
  const adapters = health.value?.chat_adapters ?? []
  for (const a of adapters) {
    const label = adapters.length > 1 ? `${a.adapter} (${a.config})` : a.adapter
    items.push({ label, platform: 'chat_adapter', state: a.label, level: a.level, type: 'chat' })
  }
  return items
})

const healthProgress = computed(() => {
  const d = health.value?.disk_usage
  const percent = d?.percent ?? 0
  return { percent, used: d?.used ?? 0, total: d?.total ?? 0, color: percent > 90 ? 'danger' : percent > 75 ? 'warning' : 'success' }
})

const memoryProgress = computed(() => {
  const m = health.value?.memory_usage
  const percent = m?.percent ?? 0
  return { percent, used: m?.used ?? 0, total: m?.total ?? 0, color: percent > 90 ? 'danger' : percent > 75 ? 'warning' : 'success' }
})

function formatNumber(value: number | undefined): string {
  if (value === undefined || value === null) return '—'
  return value.toLocaleString('zh-CN')
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const [overviewRes, healthRes] = await Promise.all([
      get<AdminOverview & { success: boolean; message?: string }>('/api/admin/overview'),
      get<AdminHealth & { success: boolean; message?: string }>('/api/admin/health'),
    ])
    overview.value = overviewRes
    health.value = healthRes
  } catch (err) {
    error.value = err instanceof Error ? err.message : '获取数据失败'
  } finally {
    loading.value = false
  }
}

async function refreshHealth() {
  if (document.hidden || healthRefreshInFlight) return
  healthRefreshInFlight = true
  try {
    health.value = await get<AdminHealth & { success: boolean; message?: string }>('/api/admin/health')
  } catch {
    // Keep the last status during a transient refresh failure.
  } finally {
    healthRefreshInFlight = false
  }
}

function handleVisibilityChange() {
  if (!document.hidden) void refreshHealth()
}

onMounted(() => {
  void load()
  healthRefreshTimer = setInterval(() => void refreshHealth(), 15000)
  document.addEventListener('visibilitychange', handleVisibilityChange)
})
onBeforeUnmount(() => {
  if (healthRefreshTimer) clearInterval(healthRefreshTimer)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
})

function activityClass(type: string) {
  switch (type) {
    case 'user': return 'activity-user'
    case 'point': return 'activity-point'
    case 'message': return 'activity-message'
    default: return ''
  }
}

function activityLabel(type: string) {
  switch (type) {
    case 'user': return '用户'
    case 'point': return '积分'
    case 'message': return '消息'
    default: return '动态'
  }
}

function formatActivityTime(time: string): string {
  const date = new Date(time)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return date.toLocaleDateString()
}
</script>

<template>
  <section class="admin-dashboard">
    <div class="dashboard-header">
      <div class="header-left">
        <h1>管理后台</h1>
        <span class="role-pill">{{ roleLabel }}</span>
        <span class="header-greeting">{{ welcomeName }}</span>
      </div>
      <div class="header-actions">
        <RouterLink v-for="link in quickLinks" :key="link.label" class="header-action" :to="link.to">
          <AdminIcon :name="link.icon" />
          <span>{{ link.label }}</span>
        </RouterLink>
      </div>
    </div>

    <div v-if="loading" class="dashboard-state">
      <span class="loader" />
      <span>加载中…</span>
    </div>
    <div v-else-if="error" class="dashboard-state error">
      <span>{{ error }}</span>
      <button class="retry-button" @click="load">重试</button>
    </div>

    <template v-else>
      <div class="stats-grid">
        <StatCard
          v-for="(stat, index) in stats"
          :key="index"
          :title="stat.title"
          :value="stat.value"
          :trend="stat.trend"
          :icon="stat.icon"
          :variant="stat.variant"
        />
      </div>

      <div class="content-grid">
        <div class="content-main">
          <div class="panel status-panel">
            <div class="panel-header">
              <span class="panel-icon" aria-hidden="true">
                <AdminIcon name="server" />
              </span>
              <h2>实时状态</h2>
            </div>
            <div class="status-cards">
              <div v-for="item in serverStatus" :key="item.label" class="status-card" :class="[`type-${item.type}`, `level-${item.level}`]">
                <div class="status-info">
                  <span class="status-name">{{ item.label }}</span>
                  <span class="status-badge" :class="`level-${item.level}`">{{ item.state }}</span>
                </div>
                <div class="status-platform">{{ item.platform }}</div>
                <div v-if="item.uptime" class="status-meta">运行时间 {{ item.uptime }}</div>
              </div>
            </div>
            <div class="plugin-statuses">
              <div class="plugin-status-card">
                <div>
                  <div class="plugin-status-title">游戏插件</div>
                  <div class="plugin-status-platform">game_adapter_plugin</div>
                </div>
                <div class="plugin-count">
                  <strong>{{ health?.plugin_counts?.game_adapter ?? 0 }}</strong>
                  <span>运行中</span>
                </div>
              </div>
              <div class="plugin-status-card">
                <div>
                  <div class="plugin-status-title">聊天插件</div>
                  <div class="plugin-status-platform">chat_adapter_plugin</div>
                </div>
                <div class="plugin-count">
                  <strong>{{ health?.plugin_counts?.chat_adapter ?? 0 }}</strong>
                  <span>运行中</span>
                </div>
              </div>
            </div>
          </div>

          <div class="panel activity-panel">
            <div class="panel-header">
              <span class="panel-icon" aria-hidden="true">
                <AdminIcon name="bell" />
              </span>
              <h2>最近动态</h2>
            </div>
            <ul class="activity-list">
              <li v-for="(activity, index) in recentActivity" :key="index" :class="['activity-item', activityClass(activity.type)]">
                <span class="activity-tag">{{ activityLabel(activity.type) }}</span>
                <div class="activity-main">
                  <span class="activity-text">{{ activity.text }}</span>
                  <span class="activity-time">{{ formatActivityTime(activity.time) }}</span>
                </div>
              </li>
              <li v-if="recentActivity.length === 0" class="empty-item">暂无动态</li>
            </ul>
          </div>
        </div>

        <div class="content-side">
          <div class="panel health-panel">
            <div class="panel-header">
              <span class="panel-icon" aria-hidden="true">
                <AdminIcon name="activity" />
              </span>
              <h2>系统健康</h2>
            </div>
            <div class="health-list">
              <div class="health-row">
                <span class="health-label">磁盘占用</span>
                <div class="health-bar-wrap">
                  <div class="health-bar-track">
                    <div class="health-bar-fill" :class="healthProgress.color" :style="{ width: `${healthProgress.percent}%` }" />
                  </div>
                  <span class="health-bar-value">{{ healthProgress.percent }}%</span>
                </div>
                <span class="health-detail">{{ formatBytes(healthProgress.used) }} / {{ formatBytes(healthProgress.total) }}</span>
              </div>
              <div class="health-row">
                <span class="health-label">运存占用</span>
                <div class="health-bar-wrap">
                  <div class="health-bar-track">
                    <div class="health-bar-fill" :class="memoryProgress.color" :style="{ width: `${memoryProgress.percent}%` }" />
                  </div>
                  <span class="health-bar-value">{{ memoryProgress.percent }}%</span>
                </div>
                <span class="health-detail">{{ formatBytes(memoryProgress.used) }} / {{ formatBytes(memoryProgress.total) }}</span>
              </div>
              <div class="health-row compact">
                <span class="health-label">今日错误日志</span>
                <span class="health-count" :class="`level-${(health?.today_errors ?? 0) === 0 ? 'ok' : 'err'}`">{{ health?.today_errors ?? 0 }}</span>
              </div>
              <div class="health-row compact">
                <span class="health-label">运行时间</span>
                <span class="health-value">{{ health?.server?.uptime ?? '—' }}</span>
              </div>
              <div class="health-row compact">
                <span class="health-label">最近备份</span>
                <span class="health-value">{{ health?.last_backup ?? '暂无' }}</span>
              </div>
            </div>
          </div>
          <div class="panel runtime-panel">
            <div class="panel-header">
              <span class="panel-icon" aria-hidden="true">
                <AdminIcon name="server" />
              </span>
              <h2>运行环境</h2>
            </div>
            <div class="runtime-list">
              <div class="runtime-row">
                <span>主机</span>
                <strong>{{ health?.runtime?.hostname ?? '—' }}</strong>
              </div>
              <div class="runtime-row">
                <span>系统</span>
                <strong>{{ health?.runtime?.platform ?? '—' }}</strong>
              </div>
              <div class="runtime-row">
                <span>CPU</span>
                <strong>{{ health?.runtime?.cpu_cores ?? 0 }} 核</strong>
              </div>
              <div class="runtime-row runtime-cpu-name">
                <span>{{ health?.runtime?.cpu ?? '—' }}</span>
              </div>
              <div class="runtime-row">
                <span>进程内存</span>
                <strong>{{ formatBytes(health?.runtime?.process_memory ?? 0) }}</strong>
              </div>
              <div class="runtime-row">
                <span>Node.js</span>
                <strong>{{ health?.runtime?.node_version ?? '—' }}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.admin-dashboard {
  --nav-x: clamp(12px, 3vw, 42px);
  width: 100%;
  min-height: 100%;
  padding: 76px 0 48px;
  color: var(--panel-text);
}

.dashboard-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 24px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dashboard-header h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -.03em;
}

.role-pill {
  display: inline-flex;
  align-items: center;
  padding: 3px 9px;
  border-radius: 4px;
  color: var(--accent-contrast);
  background: var(--accent);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: .08em;
  text-transform: uppercase;
}

.header-greeting {
  color: var(--muted-text);
  font-size: 13px;
}

.header-actions {
  display: flex;
  gap: 6px;
}

.header-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 5px;
  color: var(--panel-text);
  background: color-mix(in srgb, var(--panel-bg) 68%, transparent);
  border: 1px solid var(--border);
  font-size: 12px;
  font-weight: 650;
  transition: background-color .2s ease, border-color .2s ease, transform .2s ease;
}

.header-action:hover {
  background: var(--surface-hover);
  border-color: var(--accent);
  transform: translateY(-1px);
}

.header-action .admin-icon {
  font-size: 14px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 24px;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 0.4fr);
  gap: 16px;
  align-items: start;
}

.content-main {
  display: grid;
  gap: 16px;
}

.content-side {
  display: grid;
  gap: 16px;
}

.panel {
  padding: 20px;
  color: var(--panel-text);
  background: color-mix(in srgb, var(--panel-bg) 68%, transparent);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 8px 24px color-mix(in srgb, var(--shadow) 22%, transparent);
}

.panel-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}

.panel-icon {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  font-size: 14px;
  background: var(--surface);
  border: 1px solid var(--border);
}

.panel h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -.01em;
}

.status-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.status-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--surface) 46%, transparent);
  border: 1px solid var(--border);
  transition: border-color .2s ease, background-color .2s ease;
}

.status-card.level-ok {
  border-color: color-mix(in srgb, var(--success) 42%, var(--border));
  background: color-mix(in srgb, var(--success-soft) 30%, transparent);
}
.status-card.level-ok.type-server {
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
  background: color-mix(in srgb, var(--accent-soft) 30%, transparent);
}
.status-card.level-ok.type-chat {
  border-color: color-mix(in srgb, #42a5f5 42%, var(--border));
  background: color-mix(in srgb, #42a5f5 12%, transparent);
}
.status-card.level-warn {
  border-color: color-mix(in srgb, var(--warning) 50%, var(--border));
  background: color-mix(in srgb, var(--warning-soft) 34%, transparent);
}
.status-card.level-err {
  border-color: color-mix(in srgb, var(--danger) 42%, var(--border));
  background: color-mix(in srgb, var(--danger) 12%, transparent);
}
.status-card.level-na {
  border-color: color-mix(in srgb, var(--muted-text) 30%, var(--border));
  background: color-mix(in srgb, var(--surface) 30%, transparent);
}

.status-info {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.status-name {
  font-size: 15px;
  font-weight: 700;
}

.status-badge {
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 13px;
  font-weight: 700;
}
.status-badge.level-ok {
  background: var(--success-soft);
  color: var(--success-text);
}
.status-badge.level-warn {
  background: var(--warning-soft);
  color: var(--warning-text);
}
.status-badge.level-err {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}
.status-badge.level-na {
  background: color-mix(in srgb, var(--muted-text) 14%, transparent);
  color: var(--muted-text);
}

.status-meta {
  color: var(--muted-text);
  font-size: 12px;
}

.status-platform {
  color: color-mix(in srgb, var(--muted-text) 70%, transparent);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
  text-transform: uppercase;
}

.plugin-statuses {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 12px;
}

.plugin-status-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 84px;
  padding: 14px 16px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, var(--border));
  border-radius: 5px;
  background: color-mix(in srgb, var(--accent-soft) 20%, transparent);
}

.plugin-status-title {
  font-size: 14px;
  font-weight: 750;
}

.plugin-status-platform {
  margin-top: 5px;
  color: var(--muted-text);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .04em;
}

.plugin-count {
  display: grid;
  justify-items: end;
  gap: 2px;
}

.plugin-count strong {
  color: var(--accent);
  font-size: 26px;
  line-height: 1;
  font-weight: 800;
}

.plugin-count span {
  color: var(--success-text);
  font-size: 11px;
  font-weight: 700;
}

.runtime-list {
  display: grid;
  gap: 0;
}

.runtime-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-width: 0;
  padding: 10px 0;
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  color: var(--muted-text);
  font-size: 12px;
}

.runtime-row:first-child {
  padding-top: 0;
  border-top: 0;
}

.runtime-row strong {
  min-width: 0;
  overflow: hidden;
  color: var(--panel-text);
  font-weight: 700;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.runtime-cpu-name {
  display: block;
  margin-top: -6px;
  padding-top: 0;
  border-top: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
}

.activity-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.activity-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--surface) 34%, transparent);
  border: 1px solid transparent;
  transition: background-color .2s ease, border-color .2s ease;
}

.activity-item:hover {
  background: color-mix(in srgb, var(--surface) 56%, transparent);
  border-color: var(--border);
}

.activity-tag {
  flex: none;
  padding: 2px 7px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .04em;
  text-transform: uppercase;
  background: var(--surface);
  color: var(--muted-text);
}

.activity-user .activity-tag { background: var(--accent-soft); color: var(--accent); }
.activity-point .activity-tag { background: var(--warning-soft); color: var(--warning-text); }
.activity-message .activity-tag { background: color-mix(in srgb, var(--success) 18%, transparent); color: var(--success-text); }

.activity-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
}

.activity-text {
  font-size: 12px;
  line-height: 1.5;
  word-break: break-word;
}

.activity-time {
  color: var(--muted-text);
  font-size: 11px;
}

.empty-item {
  padding: 24px 0;
  text-align: center;
  color: var(--muted-text);
  font-size: 13px;
}

.health-list {
  display: grid;
  gap: 16px;
}

.health-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}

.health-row.compact {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  padding-top: 10px;
  border-top: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
}

.health-label {
  color: var(--muted-text);
}

.health-bar-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
}

.health-bar-track {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--surface);
  overflow: hidden;
}

.health-bar-fill {
  height: 100%;
  border-radius: 3px;
  background: var(--success);
  transition: width .4s ease;
}

.health-bar-fill.warning { background: var(--warning); }
.health-bar-fill.danger { background: var(--danger); }

.health-bar-value {
  font-size: 12px;
  font-weight: 700;
  min-width: 40px;
  text-align: right;
}

.health-count {
  padding: 3px 9px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
}
.health-count.level-ok {
  background: var(--success-soft);
  color: var(--success-text);
}
.health-count.level-err {
  background: color-mix(in srgb, var(--danger) 14%, transparent);
  color: var(--danger);
}

.health-value {
  font-weight: 700;
}

.health-detail {
  font-size: 12px;
  color: var(--muted-text);
}

.dashboard-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 200px;
  color: var(--muted-text);
  font-size: 14px;
}

.dashboard-state.error {
  color: var(--danger);
}

.loader {
  width: 24px;
  height: 24px;
  border: 2px solid color-mix(in srgb, var(--accent) 24%, transparent);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.retry-button {
  padding: 6px 14px;
  border: 0;
  border-radius: 5px;
  color: var(--accent-contrast);
  background: var(--accent);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

@media (max-width: 900px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
  .plugin-statuses {
    grid-template-columns: 1fr;
  }
  .dashboard-header {
    flex-direction: column;
    align-items: flex-start;
  }
  .header-actions {
    width: 100%;
  }
  .header-action {
    flex: 1;
    justify-content: center;
  }
}
</style>
