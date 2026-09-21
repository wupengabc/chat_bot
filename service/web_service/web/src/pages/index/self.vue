<script lang="ts" setup>
import {computed, onMounted, ref} from 'vue'
import {useAlertStore} from '../../stores/alert'
import {useSelfInfoStore} from '../../stores/selfInfo'
import {useAvatarStore} from '../../stores/avatar'
import UserAvatar from '../../components/UserAvatar.vue'
import BaseTooltip from '../../components/BaseTooltip.vue'
import BaseDialog from '../../components/BaseDialog.vue'
import {
   type MoneyHistoryEntry,
   messagesRequest,
   moneyHistoryRequest,
   type OnlineSession,
   type PublicMessage,
  sessionHistoryRequest,
  USER_HISTORY_PAGE_SIZE,
} from '../../utils/login'

const emit = defineEmits<{ changeView: [view: 'profile' | 'server'] }>()
const alertStore = useAlertStore()
const selfInfo = useSelfInfoStore()
const avatarStore = useAvatarStore()
const user = computed(() => selfInfo.user)
const recentMessages = ref<PublicMessage[]>([])
const recentMessagesLoading = ref(false)
const recentMessagesError = ref('')
const recentMessagesTotal = ref(0)
let recentMessagesRequestId = 0

function duration(seconds?: number | null) {
  if (!seconds) return '0m'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function date(value?: string | null, compact = false) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', compact
      ? {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}
      : {year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}
  ).format(new Date(value))
}

function moneyDelta(index: number) {
  const entries = recentMoney.value
  if (index >= entries.length - 1) return null
  const current = Number(entries[index]?.money)
  const previous = Number(entries[index + 1]?.money)
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  return current - previous
}

async function refreshProfile() {
  if (selfInfo.loading) return
  try {
    const loaded = await selfInfo.load(true)
    void loadRecentMessages(loaded.username)
  } catch (error) {
    alertStore.error('档案同步失败', error instanceof Error ? error.message : '请稍后重试')
  }
}

function messageContent(value: string) {
  const separator = value.lastIndexOf('»')
  return separator === -1 ? value : value.slice(separator + 1).trimStart()
}

async function loadRecentMessages(username = user.value?.username) {
  if (!username) return
  const requestId = ++recentMessagesRequestId
  recentMessagesLoading.value = true
  recentMessagesError.value = ''
  try {
    const result = await messagesRequest(1, 6, {username})
    if (requestId !== recentMessagesRequestId) return
    recentMessages.value = result.messages
    recentMessagesTotal.value = result.pagination.total
  } catch (error) {
    if (requestId !== recentMessagesRequestId) return
    recentMessages.value = []
    recentMessagesTotal.value = 0
    recentMessagesError.value = error instanceof Error ? error.message : '最近消息加载失败'
  } finally {
    if (requestId === recentMessagesRequestId) recentMessagesLoading.value = false
  }
}

const recentSessions = computed(() => user.value?.online_session.slice().reverse().slice(0, 8) || [])
const recentMoney = computed(() => user.value?.money_history.slice().reverse().slice(0, 8) || [])
const currentDate = new Date()
const daysInCurrentMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate()
const activeDays = computed(() => new Set((user.value?.online_session || []).flatMap(item => {
  const startedAt = new Date(item.start)
  if (
      Number.isNaN(startedAt.getTime()) ||
      startedAt.getFullYear() !== currentDate.getFullYear() ||
      startedAt.getMonth() !== currentDate.getMonth() ||
      startedAt > currentDate
  ) return []
  return [startedAt.getDate()]
})))
type HistoryKind = 'sessions' | 'money'
const historyDialogOpen = ref(false)
const historyKind = ref<HistoryKind>('sessions')
const historyLoading = ref(false)
const historyError = ref('')
const historyPage = ref(1)
const historyPageInput = ref('1')
const historyTotal = ref(0)
const historyTotalPages = ref(1)
const historyHasPrevious = ref(false)
const historyHasNext = ref(false)
const sessionHistoryItems = ref<OnlineSession[]>([])
const moneyHistoryItems = ref<MoneyHistoryEntry[]>([])
const historyDialogTitle = computed(() => historyKind.value === 'sessions' ? '全部会话' : '全部金币历史')
const historyRange = computed(() => {
  if (historyTotal.value === 0) return '0 条记录'
  const start = (historyPage.value - 1) * USER_HISTORY_PAGE_SIZE + 1
  const end = Math.min(historyPage.value * USER_HISTORY_PAGE_SIZE, historyTotal.value)
  return `${start}–${end} / ${historyTotal.value}`
})
let historyRequestId = 0

async function loadHistoryPage(page: number) {
  if (historyLoading.value) return
  const requestId = ++historyRequestId
  historyLoading.value = true
  historyError.value = ''
  try {
    const result = historyKind.value === 'sessions'
        ? await sessionHistoryRequest(page)
        : await moneyHistoryRequest(page)
    if (requestId !== historyRequestId) return
    if (historyKind.value === 'sessions') sessionHistoryItems.value = result.items as OnlineSession[]
    else moneyHistoryItems.value = result.items as MoneyHistoryEntry[]
    historyPage.value = result.pagination.page
    historyPageInput.value = String(result.pagination.page)
    historyTotal.value = result.pagination.total
    historyTotalPages.value = result.pagination.total_pages
    historyHasPrevious.value = result.pagination.has_previous
    historyHasNext.value = result.pagination.has_next
  } catch (error) {
    if (requestId !== historyRequestId) return
    historyError.value = error instanceof Error ? error.message : '历史记录加载失败'
  } finally {
    if (requestId === historyRequestId) historyLoading.value = false
  }
}

function openHistory(kind: HistoryKind) {
  historyKind.value = kind
  historyDialogOpen.value = true
  historyPage.value = 1
  historyPageInput.value = '1'
  historyTotal.value = 0
  historyTotalPages.value = 1
  historyHasPrevious.value = false
  historyHasNext.value = false
  sessionHistoryItems.value = []
  moneyHistoryItems.value = []
  void loadHistoryPage(1)
}

function closeHistory() {
  historyDialogOpen.value = false
  historyRequestId++
  historyLoading.value = false
}

function goToHistoryPage() {
  const parsedPage = Number(historyPageInput.value)
  const targetPage = Number.isFinite(parsedPage)
      ? Math.min(historyTotalPages.value, Math.max(1, Math.trunc(parsedPage)))
      : historyPage.value
  historyPageInput.value = String(targetPage)
  if (targetPage !== historyPage.value) void loadHistoryPage(targetPage)
}

onMounted(async () => {
  try {
    const loaded = await selfInfo.load()
    await avatarStore.load([loaded.username])
    void loadRecentMessages(loaded.username)
  } catch (error) {
    alertStore.error('个人信息加载失败', error instanceof Error ? error.message : '请稍后重试')
  }
})
</script>

<template>
  <section class="workspace-page">
    <div v-if="selfInfo.loading && !user" class="workspace-loading"><i/><span>正在同步玩家档案</span></div>
    <div v-else-if="user" class="workspace-shell">
      <aside class="player-sidebar">
        <header class="player-identity">
          <div class="avatar-shell">
            <UserAvatar :loading="avatarStore.loading" :url="avatarStore.get(user.username)" :username="user.username"
                        size="large"/>
            <i :class="{ online: user.online }"/>
          </div>
          <div><h1>{{ user.username }}</h1>
            <p>{{ user.online ? '正在游戏中' : '当前离线' }}</p></div>
        </header>

        <dl class="identity-details">
          <div>
            <dt>权限</dt>
            <dd>{{ user.role || 'member' }}</dd>
          </div>
          <div>
            <dt>首次记录</dt>
            <dd>{{ date(user.first_record_time as string, true) }}</dd>
          </div>
          <div>
            <dt>最近加入</dt>
            <dd>{{ date(user.last_join_time as string, true) }}</dd>
          </div>
          <div>
            <dt>最近离开</dt>
            <dd>{{ date(user.last_leave_time as string, true) }}</dd>
          </div>
        </dl>

        <section aria-label="玩家指标" class="sidebar-metrics">
          <article>
            <header><span>金币余额</span><b>WALLET</b></header>
            <strong>{{ user.wallet.amount ?? '不可用' }}</strong>
            <footer>{{ user.wallet.source }}</footer>
          </article>
          <article>
            <header><span>积分余额</span><b>POINT</b></header>
            <strong>{{ ((user.point || 0) / 100).toFixed(2) }}</strong>
            <footer>可用积分</footer>
          </article>
          <article>
            <header><span>累计在线</span><b>LIFETIME</b></header>
            <strong>{{ duration(user.online_time as number) }}</strong>
            <footer>{{ user.online_session.length }} 条最近会话</footer>
          </article>
          <article>
            <header><span>公开消息</span><b>CHAT</b></header>
            <strong>{{ user.message_count || 0 }}</strong>
            <footer>累计记录</footer>
          </article>
        </section>

        <div class="sidebar-region">
          <span>地区记录</span><strong>{{ (user.address_list as string[] | undefined)?.join(' / ') || '未知' }}</strong>
        </div>

      </aside>

      <main id="overview" class="workspace-main">
        <header class="workspace-title">
          <div><span>PLAYER WORKSPACE / {{ user.online ? 'LIVE' : 'ARCHIVE' }}</span>
            <h2>玩家总览</h2>
            <p>资产、活动与世界记录，集中在同一个工作区。</p></div>
          <div class="workspace-actions">
            <button class="server-home-button" type="button" @click="emit('changeView', 'server')">
              <span>服务器首页</span><b aria-hidden="true">↗</b></button>
            <BaseTooltip placement="top" text="重新请求玩家资料、钱包、会话与地标数据">
              <button :aria-busy="selfInfo.loading" :class="{ loading: selfInfo.loading }" :disabled="selfInfo.loading"
                      class="sync-button" @click="refreshProfile"><i>↻</i><span>同步档案</span></button>
            </BaseTooltip>
          </div>
        </header>

        <div class="workspace-scroll">

          <section class="activity-panel">
            <header class="section-header">
              <div><h3>最近活动</h3><span>合并会话、资产与地标更新</span></div>
              <b>{{ user.online ? '实时' : '历史' }}</b></header>
            <div class="activity-list">
              <article v-if="user.online">
                <time>现在</time>
                <i class="live"/>
                <div><strong>正在邦溪世界中</strong><span>最近加入 {{
                    date(user.last_join_time as string, true)
                  }}</span></div>
                <b>SESSION OPEN</b></article>
              <article v-if="user.landmarks[0]">
                <time>{{ date(user.landmarks[0].updated_at, true) }}</time>
                <i/>
                <div><strong>地标更新 · {{ user.landmarks[0].name }}</strong><span>{{
                    user.landmarks[0].description
                  }}</span></div>
                <b>{{ user.landmarks[0].visits }} visits</b></article>
              <article v-if="recentMoney[0]">
                <time>{{ date(recentMoney[0].timestamp, true) }}</time>
                <i/>
                <div><strong>钱包余额记录</strong><span>当前记录 {{ recentMoney[0].money }} 金币</span></div>
                <b>{{ user.wallet.source }}</b></article>
              <article v-if="recentSessions.find(item => item.end)">
                <time>{{ date(recentSessions.find(item => item.end)?.end, true) }}</time>
                <i/>
                <div><strong>完成在线会话</strong><span>持续 {{
                    duration(recentSessions.find(item => item.end)?.duration)
                  }}</span></div>
                <b>CLOSED</b></article>
            </div>
          </section>

          <div class="data-grid">
            <section id="sessions" class="data-panel">
              <header class="section-header">
                <div><h3>最近会话</h3><span>API 返回最近 30 条记录</span></div>
                <span class="section-actions"><b>{{ user.online_session.length }} / 30</b><BaseTooltip
                    placement="top" text="分页查看全部会话记录"><button class="history-query-button" type="button"
                                                                        @click="openHistory('sessions')">查询全部</button></BaseTooltip></span>
              </header>
              <div class="table-scroll">
                <table>
                  <thead>
                  <tr>
                    <th>开始</th>
                    <th>结束</th>
                    <th>时长</th>
                    <th>状态</th>
                  </tr>
                  </thead>
                  <tbody>
                  <tr v-for="session in recentSessions" :key="session.start">
                    <td>{{ date(session.start, true) }}</td>
                    <td>{{ session.end ? date(session.end, true) : '—' }}</td>
                    <td>{{ duration(session.duration) }}</td>
                    <td><span :class="{ live: !session.end }">{{ session.end ? '结束' : '进行中' }}</span></td>
                  </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section id="money" class="data-panel">
              <header class="section-header">
                <div><h3>金币历史</h3><span>API 返回最近 30 条记录</span></div>
                <span class="section-actions"><b>{{ user.money_history.length }} / 30</b><BaseTooltip
                    placement="top" text="分页查看全部金币历史"><button class="history-query-button" type="button"
                                                                        @click="openHistory('money')">查询全部</button></BaseTooltip></span>
              </header>
              <div class="table-scroll">
                <table>
                  <thead>
                  <tr>
                    <th>时间</th>
                    <th>记录余额</th>
                    <th>变化</th>
                  </tr>
                  </thead>
                  <tbody>
                  <tr v-for="(entry, index) in recentMoney" :key="entry.timestamp">
                    <td>{{ date(entry.timestamp, true) }}</td>
                    <td>{{ entry.money }}</td>
                    <td :class="{ positive: (moneyDelta(index) || 0) > 0, negative: (moneyDelta(index) || 0) < 0 }">{{
                        moneyDelta(index) === null ? '—' : `${(moneyDelta(index) || 0) > 0 ? '+' : ''}${moneyDelta(index)?.toFixed(2)}`
                      }}
                    </td>
                  </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <section class="recent-messages-panel">
            <header class="section-header">
              <div><h3>最近消息</h3><span>公开聊天记录</span></div>
              <b v-if="recentMessagesLoading">读取中</b><b v-else>{{ recentMessagesTotal }} 条</b>
            </header>
            <div v-if="recentMessagesLoading" class="recent-messages-state">正在查询最近消息...</div>
            <div v-else-if="recentMessagesError" class="recent-messages-state recent-messages-error"><span>{{ recentMessagesError }}</span><button type="button" @click="loadRecentMessages()">重试</button></div>
            <div v-else-if="recentMessages.length" class="recent-message-list">
              <article v-for="message in recentMessages" :key="message.id"><time>{{ date(message.create_time, true) }}</time><strong>{{ messageContent(message.content) || '（空消息）' }}</strong><span>{{ message.area || '未知区域' }}</span></article>
            </div>
            <p v-else class="recent-messages-state">暂无公开消息</p>
          </section>

          <div class="lower-grid">
            <section id="landmarks" class="landmark-panel">
              <header class="section-header">
                <div><h3>我的地标</h3><span>按名称排序，展示全部记录</span></div>
                <b>{{ user.landmarks.length }}</b></header>
              <div v-if="user.landmarks.length" class="landmark-list">
                <article v-for="landmark in user.landmarks" :key="`${landmark.owner}-${landmark.name}`">
                  <div class="landmark-symbol">⌂</div>
                  <div><strong>{{ landmark.name }}</strong>
                    <p>{{ landmark.description }}</p></div>
                  <dl>
                    <div>
                      <dt>访问</dt>
                      <dd>{{ landmark.visits }}</dd>
                    </div>
                    <div>
                      <dt>价格</dt>
                      <dd>{{ landmark.price }}</dd>
                    </div>
                    <div>
                      <dt>更新</dt>
                      <dd>{{ date(landmark.updated_at, true) }}</dd>
                    </div>
                  </dl>
                </article>
              </div>
              <p v-else class="empty-state">尚未拥有公开地标。</p>
            </section>

            <aside class="activity-calendar">
              <header class="section-header">
                <div><h3>近期活跃</h3><span>按会话开始日期</span></div>
              </header>
              <div class="calendar-grid"><b v-for="day in daysInCurrentMonth" :key="day"
                                            :class="{ filled: activeDays.has(day), today: day === currentDate.getDate() }"><span>{{
                  day
                }}</span></b></div>
              <footer><span><i/> 有会话</span><strong>{{ activeDays.size }} 个活跃日</strong></footer>
            </aside>
          </div>
        </div>
      </main>
    </div>

    <BaseDialog :open="historyDialogOpen" :title="historyDialogTitle" size="wide" @close="closeHistory">
      <div class="history-dialog">
        <header class="history-summary"><span>{{
            historyKind === 'sessions' ? '按开始时间从新到旧排列' : '按记录时间从新到旧排列'
          }}</span><b>{{ historyRange }}</b></header>

        <div v-if="historyLoading" class="history-loading"><i/><span>正在加载第 {{ historyPage }} 页</span></div>
        <div v-else-if="historyError" class="history-error"><p>{{ historyError }}</p>
          <button type="button" @click="loadHistoryPage(historyPage)">重新加载</button>
        </div>
        <p v-else-if="historyTotal === 0" class="history-empty">暂时没有历史记录。</p>

        <div v-else class="history-table-wrap">
          <table v-if="historyKind === 'sessions'" class="history-table">
            <thead>
            <tr>
              <th>开始时间</th>
              <th>结束时间</th>
              <th>时长</th>
              <th>状态</th>
            </tr>
            </thead>
            <tbody>
            <tr v-for="session in sessionHistoryItems" :key="session.start">
              <td>{{ date(session.start) }}</td>
              <td>{{ session.end ? date(session.end) : '—' }}</td>
              <td>{{ duration(session.duration) }}</td>
              <td><span :class="{ live: !session.end }" class="history-status">{{
                  session.end ? '已结束' : '进行中'
                }}</span></td>
            </tr>
            </tbody>
          </table>
          <table v-else class="history-table">
            <thead>
            <tr>
              <th>记录时间</th>
              <th>金币余额</th>
            </tr>
            </thead>
            <tbody>
            <tr v-for="entry in moneyHistoryItems" :key="entry.timestamp">
              <td>{{ date(entry.timestamp) }}</td>
              <td><strong>{{ entry.money }}</strong></td>
            </tr>
            </tbody>
          </table>
        </div>

        <footer class="history-pagination">
          <button :disabled="historyLoading || !historyHasPrevious" aria-label="上一页" type="button"
                  @click="loadHistoryPage(historyPage - 1)">← 上一页
          </button>
          <div class="history-page-selector">
            <label><span>第</span><input v-model="historyPageInput" :disabled="historyLoading || historyTotal === 0" :max="historyTotalPages" aria-label="跳转页码"
                                         min="1" step="1" type="number"
                                         @keydown.enter.prevent="goToHistoryPage"/><span>/ {{
                historyTotalPages
              }} 页</span></label>
            <button :disabled="historyLoading || historyTotal === 0" class="history-page-go" type="button"
                    @click="goToHistoryPage">跳转
            </button>
            <small>每页 {{ USER_HISTORY_PAGE_SIZE }} 条</small>
          </div>
          <button :disabled="historyLoading || !historyHasNext" aria-label="下一页" type="button"
                  @click="loadHistoryPage(historyPage + 1)">下一页 →
          </button>
        </footer>
      </div>
    </BaseDialog>
  </section>
</template>

<style scoped>
.workspace-page {
  min-height: 100vh;
  padding: 90px clamp(10px, 2.2vw, 34px) 30px;
  color: var(--page-text)
}

.workspace-loading {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 15vh;
  color: var(--page-muted);
  font-size: 12px
}

.workspace-loading i {
  width: 8px;
  height: 8px;
  background: var(--accent);
  border-radius: 5px;
  animation: pulse 1s ease-in-out infinite alternate
}

.workspace-shell {
  display: grid;
  grid-template-columns:195px minmax(0, 1fr);
  max-width: 1500px;
  margin: auto;
  overflow: hidden;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 24px 70px var(--shadow)
}

.player-sidebar {
  display: flex;
  flex-direction: column;
  min-height: 760px;
  padding: 12px;
  background: var(--surface);
  border-right: 1px solid var(--border)
}

.player-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 3px 2px 14px;
  border-bottom: 1px solid var(--border)
}

.avatar-shell {
  position: relative;
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  overflow: visible;
  color: var(--accent-contrast);
  background: var(--accent);
  border-radius: 5px;
  font-weight: 800
}

.avatar-shell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 5px
}

.avatar-shell > i {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 10px;
  height: 10px;
  background: var(--muted-text);
  border: 2px solid var(--surface);
  border-radius: 50%
}

.avatar-shell > i.online {
  background: var(--success)
}

.player-identity h1 {
  margin: 0;
  font-size: 16px;
  letter-spacing: -.04em
}

.player-identity p {
  margin: 3px 0 0;
  color: var(--muted-text);
  font-size: 8px
}

.side-nav {
  display: grid;
  gap: 2px;
  padding: 11px 0;
  border-bottom: 1px solid var(--border)
}

.side-nav a {
  display: flex;
  justify-content: space-between;
  padding: 7px 8px;
  color: var(--muted-text);
  border-radius: 4px;
  font-size: 9px
}

.side-nav a:hover, .side-nav a.active {
  color: var(--panel-text);
  background: var(--surface-selected)
}

.side-nav b {
  font: 8px ui-monospace, monospace
}

.identity-details {
  margin: 11px 2px 0
}

.identity-details div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
  border-bottom: 1px solid var(--border)
}

.identity-details dt {
  color: var(--muted-text);
  font-size: 7px
}

.identity-details dd {
  max-width: 95px;
  margin: 0;
  overflow: hidden;
  font: 8px ui-monospace, monospace;
  text-overflow: ellipsis;
  white-space: nowrap
}

.sidebar-sync {
  margin-top: auto;
  padding: 10px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px
}

.sidebar-sync span, .sidebar-sync strong, .sidebar-sync small {
  display: block
}

.sidebar-sync span {
  color: var(--muted-text);
  font-size: 7px
}

.sidebar-sync strong {
  margin: 5px 0 3px;
  color: var(--accent);
  font: 700 9px ui-monospace, monospace;
  text-transform: uppercase
}

.sidebar-sync small {
  color: var(--muted-text);
  font-size: 7px
}

.workspace-main {
  min-width: 0;
  padding: 13px;
  background: var(--surface)
}

.workspace-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 9px
}

.workspace-title > div > span {
  color: var(--accent);
  font: 700 7px ui-monospace, monospace;
  letter-spacing: .1em
}

.workspace-title h2 {
  margin: 4px 0 1px;
  font-size: 17px;
  letter-spacing: -.04em
}

.workspace-title p {
  margin: 0;
  color: var(--muted-text);
  font-size: 8px
}

.workspace-title button {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 9px;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 8px
}

.workspace-title button i {
  color: var(--accent);
  font-style: normal
}

.metric-row {
  display: grid;
  grid-template-columns:repeat(4, 1fr);
  margin-bottom: 8px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px
}

.metric-row article {
  min-width: 0;
  padding: 11px;
  border-right: 1px solid var(--border)
}

.metric-row article:last-child {
  border: 0
}

.metric-row header {
  display: flex;
  justify-content: space-between;
  color: var(--muted-text);
  font-size: 7px
}

.metric-row header b {
  font: 7px ui-monospace, monospace
}

.metric-row article > strong {
  display: block;
  margin: 5px 0;
  font-size: 18px;
  letter-spacing: -.04em
}

.metric-row footer {
  color: var(--muted-text);
  font-size: 7px;
  text-transform: uppercase
}

.metric-row footer i {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 5px;
  background: var(--muted-text);
  border-radius: 5px
}

.metric-row footer i.live {
  background: var(--success)
}

.activity-panel, .data-panel, .recent-messages-panel, .landmark-panel, .activity-calendar {
  overflow: hidden;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px
}

.activity-panel {
  margin-bottom: 8px
}

.recent-messages-panel { margin-bottom: 8px; }
.recent-message-list article { display: grid; grid-template-columns: 108px minmax(0, 1fr) auto; gap: 10px; align-items: center; min-height: 37px; padding: 0 12px; border-bottom: 1px solid var(--border); }
.recent-message-list article:last-child { border-bottom: 0; }
.recent-message-list time, .recent-message-list span { color: var(--muted-text); font-size: 8px; white-space: nowrap; }
.recent-message-list strong { overflow: hidden; font-size: 9px; text-overflow: ellipsis; white-space: nowrap; }
.recent-messages-state { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 62px; margin: 0; padding: 0 12px; color: var(--muted-text); font-size: 9px; }
.recent-messages-error { color: var(--danger); }
.recent-messages-error button { padding: 0; color: var(--accent); background: transparent; border: 0; font-size: inherit; font-weight: 800; }

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 32px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--border)
}

.section-header h3 {
  margin: 0;
  font-size: 9px
}

.section-header div > span {
  display: block;
  margin-top: 2px;
  color: var(--muted-text);
  font-size: 7px
}

.section-header > b {
  color: var(--accent);
  font: 7px ui-monospace, monospace;
  text-transform: uppercase
}

.activity-list article {
  display: grid;
  grid-template-columns:75px 8px 1fr auto;
  gap: 8px;
  align-items: center;
  min-height: 31px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border)
}

.activity-list article:last-child {
  border: 0
}

.activity-list time, .activity-list div > span {
  color: var(--muted-text);
  font-size: 7px
}

.activity-list > article > i {
  width: 5px;
  height: 5px;
  background: var(--accent);
  border-radius: 5px
}

.activity-list > article > i.live {
  background: var(--success);
  box-shadow: 0 0 0 3px var(--success-soft)
}

.activity-list div > strong {
  display: block;
  font-size: 8px
}

.activity-list > article > b {
  color: var(--muted-text);
  font: 7px ui-monospace, monospace
}

.data-grid {
  display: grid;
  grid-template-columns:1fr 1fr;
  gap: 8px;
  margin-bottom: 8px
}

.table-scroll {
  overflow: auto;
  max-height: 255px
}

.data-panel table {
  width: 100%;
  border-collapse: collapse;
  white-space: nowrap
}

.data-panel th, .data-panel td {
  height: 27px;
  padding: 0 9px;
  border-bottom: 1px solid var(--border);
  font-size: 8px;
  text-align: left
}

.data-panel th {
  position: sticky;
  top: 0;
  color: var(--muted-text);
  background: var(--surface);
  font-weight: 500
}

.data-panel td span {
  padding: 2px 5px;
  color: var(--muted-text);
  background: var(--surface);
  border-radius: 3px;
  font-size: 7px
}

.data-panel td span.live {
  color: var(--success-text);
  background: var(--success-soft)
}

.positive {
  color: var(--success) !important
}

.negative {
  color: var(--danger) !important
}

.lower-grid {
  display: grid;
  grid-template-columns:1.4fr .6fr;
  gap: 8px
}

.landmark-list {
  max-height: 240px;
  overflow: auto
}

.landmark-list article {
  display: grid;
  grid-template-columns:32px 1fr auto;
  gap: 9px;
  align-items: center;
  padding: 9px 10px;
  border-bottom: 1px solid var(--border)
}

.landmark-symbol {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  color: var(--accent-contrast);
  background: var(--accent);
  border-radius: 5px;
  font-size: 15px
}

.landmark-list strong {
  display: block;
  font-size: 8px
}

.landmark-list p {
  margin: 3px 0 0;
  color: var(--muted-text);
  font-size: 7px
}

.landmark-list dl {
  display: flex;
  gap: 18px;
  margin: 0
}

.landmark-list dl div {
  text-align: right
}

.landmark-list dt {
  color: var(--muted-text);
  font-size: 6px
}

.landmark-list dd {
  margin: 3px 0 0;
  font-size: 7px
}

.empty-state {
  padding: 20px;
  color: var(--muted-text);
  font-size: 8px
}

.calendar-grid {
  display: grid;
  grid-template-columns:repeat(7, 1fr);
  gap: 4px;
  padding: 10px
}

.calendar-grid b {
  display: grid;
  place-items: center;
  aspect-ratio: 1;
  color: var(--muted-text);
  background: var(--surface);
  border-radius: 3px;
  font-size: 6px;
  font-weight: 500
}

.calendar-grid b.filled {
  color: var(--accent-contrast);
  background: var(--accent)
}

.calendar-grid b.today {
  outline: 1px solid var(--accent);
  outline-offset: 1px
}

.activity-calendar > footer {
  display: flex;
  justify-content: space-between;
  padding: 8px 10px;
  border-top: 1px solid var(--border);
  font-size: 7px
}

.activity-calendar > footer span {
  color: var(--muted-text)
}

.activity-calendar > footer i {
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-right: 4px;
  background: var(--accent);
  border-radius: 3px
}

@keyframes pulse {
  to {
    opacity: .35;
    transform: scale(.75)
  }
}

@media (max-width: 1050px) {
  .workspace-shell {
    grid-template-columns:175px minmax(0, 1fr)
  }

  .lower-grid {
    grid-template-columns:1fr
  }

  .activity-calendar {
    display: none
  }

  .landmark-list dl {
    gap: 8px
  }
}

@media (max-width: 760px) {
  .workspace-page {
    padding: 80px 8px 20px
  }

  .workspace-shell {
    display: block
  }

  .player-sidebar {
    min-height: 0;
    border-right: 0;
    border-bottom: 1px solid var(--border)
  }

  .side-nav {
    display: flex;
    overflow: auto
  }

  .side-nav a {
    min-width: 105px
  }

  .identity-details, .sidebar-sync {
    display: none
  }

  .workspace-main {
    padding: 8px
  }

  .metric-row {
    grid-template-columns:repeat(2, 1fr)
  }

  .metric-row article:nth-child(2) {
    border-right: 0
  }

  .metric-row article:nth-child(-n+2) {
    border-bottom: 1px solid var(--border)
  }

  .data-grid {
    grid-template-columns:1fr
  }

  .activity-list article {
    grid-template-columns:60px 8px 1fr
  }

  .activity-list > article > b {
    display: none
  }
}

@media (max-width: 470px) {
  .workspace-title p {
    display: none
  }

  .metric-row article > strong {
    font-size: 15px
  }

  .activity-list article {
    grid-template-columns:8px 1fr
  }

  .activity-list time {
    display: none
  }

  .landmark-list article {
    grid-template-columns:28px 1fr
  }

  .landmark-list dl {
    grid-column: 2;
    justify-content: flex-start
  }

  .landmark-list dl div {
    text-align: left
  }
}
</style>

<style scoped>
.workspace-page {
  height: 100vh;
  min-height: 0;
  padding: 76px 0 18px;
  overflow: hidden;
}

.workspace-page, .workspace-page * {
  font-family: inherit !important;
}

.workspace-loading {
  font-size: 14px;
}

.workspace-shell {
  display: grid;
  grid-template-columns: 205px minmax(0, 1fr);
  width: 100%;
  height: 100%;
  max-width: none;
  overflow: hidden;
}

.player-sidebar {
  display: flex;
  flex-direction: column;
  gap: 0;
  min-height: 0;
  padding: 14px 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-right: 1px solid var(--border);
  border-bottom: 0;
}

.player-identity {
  padding: 0 0 14px;
  border-bottom: 1px solid var(--border);
}

.avatar-shell {
  width: 48px;
  height: 48px;
}

.player-identity h1 {
  font-size: 19px;
}

.player-identity p {
  font-size: 12px;
}

.identity-details {
  display: grid;
  gap: 0;
  margin: 13px 0 0;
}

.identity-details div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid var(--border);
}

.identity-details dt, .identity-details dd {
  font-size: 11px;
}

.identity-details dd {
  max-width: 120px;
}

.sidebar-metrics {
  display: grid;
  gap: 0;
  margin-top: 13px;
}

.sidebar-metrics article {
  padding: 10px 0;
  border-bottom: 1px solid var(--border);
}

.sidebar-metrics header {
  display: flex;
  justify-content: space-between;
  color: var(--muted-text);
  font-size: 10px;
}

.sidebar-metrics header b {
  font-size: 8px;
}

.sidebar-metrics article > strong {
  display: block;
  margin: 5px 0 3px;
  font-size: 20px;
  letter-spacing: -.04em;
  overflow-wrap: anywhere;
}

.sidebar-metrics footer {
  color: var(--muted-text);
  font-size: 10px;
}

.sidebar-region {
  margin-top: auto;
  padding: 9px 10px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
}

.sidebar-region span, .sidebar-region strong {
  display: block;
}

.sidebar-region span {
  color: var(--muted-text);
  font-size: 9px;
}

.sidebar-region strong {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.workspace-main {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0;
  overflow: hidden;
}

.workspace-title {
  position: relative;
  z-index: 4;
  flex: 0 0 auto;
  margin: 0;
  padding: 11px 11px 9px;
  background: color-mix(in srgb, var(--panel-bg) 48%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

.workspace-scroll {
  min-height: 0;
  padding: 8px 11px 11px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: var(--accent) transparent;
}

.workspace-title > div > span {
  font-size: 10px;
}

.workspace-title h2 {
  margin-top: 5px;
  font-size: 22px;
}

.workspace-title p {
  font-size: 12px;
}

.workspace-title button {
  height: 34px;
  padding: 0 12px;
  font-size: 12px;
}

.sync-button {
  justify-content: center;
  width: 94px;
  transition: color .2s ease, background-color .2s ease, opacity .2s ease;
}

.sync-button i {
  display: inline-block;
  transform-origin: center;
}

.sync-button.loading {
  cursor: wait;
  opacity: .72;
}

.sync-button.loading i {
  animation: sync-spin .75s linear infinite;
}

.activity-panel {
  margin-bottom: 7px;
}

.activity-list {
  min-width: 0;
  overflow: visible;
}

.activity-list article {
  min-width: 0;
}

.activity-list article div {
  min-width: 0;
}

.activity-list article div > strong, .activity-list article div > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-header {
  min-height: 36px;
  padding: 6px 10px;
}

.section-header h3 {
  font-size: 14px;
}

.section-header div > span, .section-header > b {
  font-size: 10px;
}

.activity-list article {
  grid-template-columns: 100px 10px minmax(0, 1fr) auto;
  min-height: 42px;
  padding: 0 12px;
}

.activity-list time, .activity-list div > span, .activity-list > article > b {
  font-size: 11px;
}

.activity-list div > strong {
  font-size: 12px;
}

.data-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 7px;
  margin-bottom: 7px;
}

.lower-grid {
  grid-template-columns: minmax(0, 1.45fr) minmax(280px, .55fr);
  gap: 7px;
  margin-bottom: 7px;
}

.table-scroll {
  max-height: 360px;
}

.data-panel th, .data-panel td {
  height: 38px;
  padding: 0 12px;
  font-size: 12px;
}

.data-panel td span {
  padding: 4px 7px;
  font-size: 10px;
}

.landmark-list {
  max-height: 360px;
}

.landmark-list article {
  grid-template-columns: 34px 1fr auto;
  gap: 9px;
  padding: 9px 10px;
}

.landmark-symbol {
  width: 38px;
  height: 38px;
  font-size: 18px;
}

.landmark-list strong {
  font-size: 13px;
}

.landmark-list p {
  margin-top: 4px;
  font-size: 11px;
}

.landmark-list dt {
  font-size: 9px;
}

.landmark-list dd {
  font-size: 11px;
}

.activity-calendar {
  display: block;
}

.activity-calendar {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.calendar-grid {
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 5px;
  padding: 12px;
}

.calendar-grid b {
  min-width: 0;
  min-height: 30px;
  font-size: 10px;
}

.activity-calendar > footer {
  margin-top: auto;
  padding: 10px 12px;
  font-size: 11px;
}

.empty-state {
  font-size: 12px;
}

.lower-grid {
  grid-template-columns: minmax(0, 1.35fr) minmax(340px, .65fr);
}

.activity-calendar {
  min-height: 420px;
}

.activity-calendar .section-header {
  min-height: 46px;
}

.activity-calendar .section-header h3 {
  font-size: 16px;
}

.activity-calendar .section-header div > span {
  font-size: 12px;
}

.calendar-grid {
  gap: 7px;
  padding: 15px;
}

.calendar-grid b {
  min-height: 38px;
  font-size: 13px;
}

.activity-calendar > footer {
  min-height: 48px;
  font-size: 13px;
}

.player-sidebar, .workspace-scroll, .landmark-list, .table-scroll {
  scrollbar-width: thin;
  scrollbar-color: var(--accent) transparent;
}

.player-sidebar::-webkit-scrollbar, .workspace-scroll::-webkit-scrollbar {
  width: 6px;
}

.landmark-list::-webkit-scrollbar, .table-scroll::-webkit-scrollbar {
  width: 5px;
  height: 5px;
}

.player-sidebar::-webkit-scrollbar-track, .workspace-scroll::-webkit-scrollbar-track, .landmark-list::-webkit-scrollbar-track, .table-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.player-sidebar::-webkit-scrollbar-thumb, .workspace-scroll::-webkit-scrollbar-thumb, .landmark-list::-webkit-scrollbar-thumb, .table-scroll::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--accent) 65%, var(--muted-text));
  border: 1px solid transparent;
  border-radius: 5px;
  background-clip: padding-box;
}

.player-identity {
  padding-bottom: 10px;
}

.avatar-shell {
  width: 42px;
  height: 42px;
  overflow: visible;
  background: transparent;
}

.avatar-shell > i {
  z-index: 5;
  right: -4px;
  bottom: -4px;
  width: 12px;
  height: 12px;
  border: 3px solid var(--surface);
  box-shadow: 0 1px 3px var(--shadow);
}

.player-identity h1 {
  font-size: 17px;
}

.player-identity p {
  font-size: 10px;
}

.identity-details {
  margin-top: 8px;
}

.identity-details div {
  padding: 6px 0;
}

.sidebar-metrics {
  margin-top: 8px;
}

.sidebar-metrics article {
  padding: 7px 0;
}

.sidebar-metrics article > strong {
  margin: 3px 0 2px;
  font-size: 18px;
}

.workspace-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.server-home-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  height: 34px;
  padding: 0 11px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 12px;
  font-weight: 700;
  transition: color .2s ease, background-color .2s ease, border-color .2s ease;
}

.server-home-button:hover {
  color: var(--accent);
  background: var(--surface-hover);
  border-color: color-mix(in srgb, var(--accent) 50%, var(--border));
}

.server-home-button b {
  color: var(--muted-text);
  font-size: 15px;
  font-weight: 400;
}

.section-actions {
  display: flex;
  align-items: center;
  gap: 7px;
}

.section-actions > b {
  color: var(--muted-text);
  font-size: 10px;
  white-space: nowrap;
}

.history-query-button {
  height: 26px;
  padding: 0 8px;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  white-space: nowrap;
  transition: filter .2s ease, transform .2s ease;
}

.history-query-button:hover {
  filter: brightness(1.08);
  transform: translateY(-1px);
}

.history-dialog {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: min(540px, calc(100dvh - 120px));
  min-width: 0;
  min-height: 0;
}

.history-summary {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin: -2px 0 12px;
  color: var(--muted-text);
  font-size: 11px;
}

.history-summary b {
  color: var(--panel-text);
  font: 700 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: nowrap;
}

.history-loading, .history-error, .history-empty {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  gap: 9px;
  min-height: 0;
  margin: 0;
  color: var(--muted-text);
  font-size: 12px;
}

.history-loading i {
  width: 17px;
  height: 17px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: history-spin .7s linear infinite;
}

.history-error {
  flex-direction: column;
  color: var(--danger);
}

.history-error p {
  margin: 0;
}

.history-error button {
  height: 30px;
  padding: 0 10px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}

.history-error button:hover {
  background: var(--surface-hover);
  border-color: var(--accent);
}

.history-table-wrap {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 4px;
  scrollbar-width: thin;
  scrollbar-color: var(--accent) var(--surface);
}

.history-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}

.history-table th {
  position: sticky;
  z-index: 1;
  top: 0;
  height: 36px;
  padding: 0 11px;
  color: var(--muted-text);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  font-size: 10px;
  text-align: left;
}

.history-table td {
  height: 42px;
  padding: 0 11px;
  overflow: hidden;
  border-bottom: 1px solid var(--border);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-table tbody tr:last-child td {
  border-bottom: 0;
}

.history-table tbody tr:hover {
  background: color-mix(in srgb, var(--surface-hover) 58%, transparent);
}

.history-table td strong {
  font: 750 12px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
}

.history-status {
  display: inline-flex;
  padding: 4px 7px;
  color: var(--muted-text);
  background: var(--surface);
  border-radius: 3px;
  font-size: 10px;
}

.history-status.live {
  color: var(--success-text);
  background: var(--success-soft);
}

.history-pagination {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: 96px minmax(0, 1fr) 96px;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}

.history-pagination button {
  height: 34px;
  padding: 0 10px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  font-size: 11px;
  font-weight: 700;
}

.history-pagination button:hover:not(:disabled) {
  color: var(--accent);
  background: var(--surface-hover);
  border-color: var(--accent);
}

.history-pagination button:disabled {
  cursor: not-allowed;
  opacity: .42;
}

.history-page-selector {
  display: grid;
  grid-template-columns: auto auto;
  justify-content: center;
  align-items: center;
  gap: 3px 6px;
}

.history-page-selector label {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--panel-text);
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.history-page-selector input {
  width: 52px;
  height: 28px;
  padding: 0 5px;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  outline: none;
  font: 700 11px/1 ui-monospace, SFMono-Regular, Consolas, monospace;
  text-align: center;
}

.history-page-selector input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 16%, transparent);
}

.history-page-selector .history-page-go {
  height: 28px;
  padding: 0 8px;
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: var(--accent);
}

.history-page-selector .history-page-go:hover:not(:disabled) {
  color: var(--accent-contrast);
  background: var(--accent);
  filter: brightness(1.08);
}

.history-page-selector small {
  grid-column: 1 / -1;
  color: var(--muted-text);
  font-size: 9px;
  font-weight: 500;
  text-align: center;
}

@keyframes sync-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes history-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 1050px) {
  .workspace-shell {
    grid-template-columns: 185px minmax(0, 1fr);
  }

  .data-grid, .lower-grid {
    grid-template-columns: 1fr;
  }

  .calendar-grid {
    grid-template-columns: repeat(7, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .workspace-page {
    height: auto;
    min-height: 100vh;
    padding: 64px 0 22px;
    overflow: visible;
  }

  .workspace-shell {
    display: block;
  }

  .player-sidebar {
    min-height: 0;
    padding: 12px;
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .player-identity {
    width: 100%;
  }

  .identity-details {
    grid-template-columns: repeat(2, 1fr);
    column-gap: 14px;
  }

  .sidebar-metrics {
    grid-template-columns: repeat(2, 1fr);
    column-gap: 14px;
  }

  .sidebar-metrics article {
    padding: 10px 0;
  }

  .sidebar-region {
    margin-top: 12px;
  }

  .workspace-main {
    display: block;
    padding: 8px;
    overflow: visible;
  }

  .workspace-title {
    position: static;
    margin: 0 0 8px;
    padding: 0;
    background: transparent;
    border-bottom: 0;
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }

  .workspace-scroll {
    padding: 0;
    overflow: visible;
  }

  .activity-list article {
    grid-template-columns: 70px 8px 1fr;
    padding: 7px 10px;
  }

  .activity-list > article > b {
    grid-column: 3;
  }

  .calendar-grid {
    grid-template-columns: repeat(7, 1fr);
  }
}

@media (max-width: 470px) {
  .workspace-title p {
    display: block;
  }

  .metric-row article > strong {
    font-size: 19px;
  }

  .identity-details div {
    width: auto;
  }

  .activity-list article {
    grid-template-columns: 8px 1fr;
  }

  .activity-list time {
    display: none;
  }

  .activity-list > article > b {
    grid-column: 2;
  }

  .workspace-title {
    align-items: flex-start;
  }

  .workspace-actions {
    display: grid;
  }

  .region-summary {
    max-width: 150px;
  }

  .landmark-list article {
    grid-template-columns: 38px 1fr;
  }

  .landmark-list dl {
    grid-column: 2;
  }

  .section-actions {
    gap: 4px;
  }

  .section-actions > b {
    display: none;
  }

  .history-pagination {
    grid-template-columns: 82px minmax(0, 1fr) 82px;
    gap: 6px;
  }

  .history-pagination button {
    padding: 0 6px;
  }
}
</style>
