<script lang="ts" setup>
import {computed, onMounted, ref} from 'vue'
import {storeToRefs} from 'pinia'
import BaseDialog from '../../components/BaseDialog.vue'
import {useAlertStore} from '../../stores/alert'
import {usePlayerInfoStore} from '../../stores/playerInfo'
import {useSelfInfoStore} from '../../stores/selfInfo'
import {messagesRequest, type OnlinePlayer, playerAvatarUrl, playerInfoRequest, playerNamesRequest, type PublicMessage, type SelfUser} from '../../utils/login'

const playerInfo = usePlayerInfoStore()
const alertStore = useAlertStore()
const selfInfo = useSelfInfoStore()
const {players, available, playersLoading, playersLoaded} = storeToRefs(playerInfo)
const loading = computed(() => !playersLoaded.value || playersLoading.value)
const profileOpen = ref(false)
const confirmOpen = ref(false)
const playerSearchOpen = ref(false)
const pendingUsername = ref('')
const profileLoading = ref('')
const selectedPlayer = ref<SelfUser | null>(null)
const profileMessages = ref<PublicMessage[]>([])
const profileMessagesLoading = ref(false)
const profileMessagesError = ref('')
const profileMessagesTotal = ref(0)
let profileMessagesRequestId = 0
const playerSearchInput = ref('')
const playerSearchResults = ref<string[]>([])
const playerSearchLoading = ref(false)
const playerSearchError = ref('')
const playerSearchPerformed = ref(false)
const playerSearchPage = ref(1)
const playerSearchTotal = ref(0)
const playerSearchTotalPages = ref(1)
const playerSearchHasPrevious = ref(false)
const playerSearchHasNext = ref(false)
const playerGroups = computed(() => {
  const groups = new Map<string, OnlinePlayer[]>()
  for (const player of players.value) {
    const region = player.display_name.match(/^\[([^\]]+)\]/)?.[1] || '其他'
    const group = groups.get(region) || []
    group.push(player)
    groups.set(region, group)
  }
  return Array.from(groups, ([name, members]) => ({name, members}))
})

function pingTone(ping: number | null) {
  if (ping === null) return 'unknown'
  if (ping < 80) return 'fast'
  if (ping < 180) return 'steady'
  return 'slow'
}

function avatarUrl(username: string) {
  return playerAvatarUrl(username)
}

function duration(seconds?: number | null) {
  if (!seconds) return '0m'
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function date(value?: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function messageContent(value: string) {
  const separator = value.lastIndexOf('»')
  return separator === -1 ? value : value.slice(separator + 1).trimStart()
}

async function loadProfileMessages(username: string) {
  const requestId = ++profileMessagesRequestId
  profileMessagesLoading.value = true
  profileMessagesError.value = ''
  try {
    const result = await messagesRequest(1, 6, {username})
    if (requestId !== profileMessagesRequestId) return
    profileMessages.value = result.messages
    profileMessagesTotal.value = result.pagination.total
  } catch (error) {
    if (requestId !== profileMessagesRequestId) return
    profileMessages.value = []
    profileMessagesTotal.value = 0
    profileMessagesError.value = error instanceof Error ? error.message : '最近消息加载失败'
  } finally {
    if (requestId === profileMessagesRequestId) profileMessagesLoading.value = false
  }
}

function promptPlayerProfile(username: string) {
  if (profileLoading.value) return
  pendingUsername.value = username
  confirmOpen.value = true
}

function openPlayerSearch() {
  playerSearchInput.value = ''
  playerSearchResults.value = []
  playerSearchError.value = ''
  playerSearchPerformed.value = false
  playerSearchPage.value = 1
  playerSearchTotal.value = 0
  playerSearchTotalPages.value = 1
  playerSearchHasPrevious.value = false
  playerSearchHasNext.value = false
  playerSearchOpen.value = true
}

async function searchPlayerNames(page = 1) {
  if (playerSearchLoading.value) return
  playerSearchLoading.value = true
  playerSearchError.value = ''
  playerSearchPerformed.value = true
  try {
    const result = await playerNamesRequest(page, 10, playerSearchInput.value.trim())
    playerSearchResults.value = result.names
    playerSearchPage.value = result.pagination.page
    playerSearchTotal.value = result.pagination.total
    playerSearchTotalPages.value = result.pagination.total_pages
    playerSearchHasPrevious.value = result.pagination.has_previous
    playerSearchHasNext.value = result.pagination.has_next
  } catch (error) {
    playerSearchResults.value = []
    playerSearchError.value = error instanceof Error ? error.message : '玩家 ID 查询失败'
  } finally {
    playerSearchLoading.value = false
  }
}

function queryEnteredPlayer() {
  const username = playerSearchInput.value.trim()
  if (!username) {
    playerSearchError.value = '请输入玩家 ID'
    return
  }
  playerSearchOpen.value = false
  promptPlayerProfile(username)
}

async function openPlayerProfile() {
  const username = pendingUsername.value
  if (profileLoading.value) return
  confirmOpen.value = false
  profileLoading.value = username
  try {
    const result = await playerInfoRequest(username)
    selectedPlayer.value = result.user
    profileMessages.value = []
    profileMessagesTotal.value = 0
    profileOpen.value = true
    void loadProfileMessages(username)
    if (selfInfo.user) selfInfo.user.point = Math.max(0, (selfInfo.user.point || 0) - 10_000)
  } catch (error) {
    alertStore.error('玩家档案查询失败', error instanceof Error ? error.message : '请稍后重试')
  } finally {
    profileLoading.value = ''
  }
}

onMounted(() => void playerInfo.ensurePlayers())
</script>

<template>
  <section class="player-panel">
    <header class="player-overview">
      <div class="directory-title">
        <span :class="{ muted: !available && !loading }" class="status-dot"/>
        <div><strong>玩家目录</strong><small>{{
            loading ? '正在同步在线数据' : available ? `${players.length} 位玩家在线` : '实时接口不可用'
          }}</small></div>
      </div>
      <div class="directory-actions">
        <button class="player-search-button" type="button" @click="openPlayerSearch"><span
            aria-hidden="true">⌕</span><b>查询玩家</b></button>
        <button :disabled="loading" class="refresh-button" type="button" @click="playerInfo.refreshPlayers"><span
            aria-hidden="true">↻</span>{{ loading ? '同步中' : '刷新名册' }}
        </button>
      </div>
    </header>

    <div v-if="loading" class="explore-empty player-loading">
      <span aria-hidden="true" class="loading-scanner"><i/><i/><i/><i/><b/></span>
      <strong>正在同步世界名册</strong><span>连接游戏服务器并核对在线身份</span>
    </div>
    <div v-else-if="!available" class="explore-empty player-unavailable"><span
        class="empty-code">NO SIGNAL</span><strong>暂时无法读取在线名册</strong><span>游戏 Bot 离线或实时接口暂不可用。</span>
    </div>
    <div v-else-if="players.length === 0" class="explore-empty player-unavailable"><span
        class="empty-code">WORLD QUIET</span><strong>世界里暂时没有玩家</strong><span>服务器连接正常，等待下一位旅行者进入。</span>
    </div>
    <div v-else class="roster">
      <section v-for="(group, groupIndex) in playerGroups" :key="group.name" :style="{ animationDelay: `${groupIndex * 45}ms` }"
               class="player-group">
        <header class="group-header"><strong>{{ group.name }}</strong><span>{{ group.members.length }} PLAYERS</span>
        </header>
        <div class="player-grid">
          <article v-for="(player, playerIndex) in group.members" :key="player.uuid || player.username"
                   :style="{ animationDelay: `${Math.min(groupIndex * 4 + playerIndex, 24) * 28}ms` }"
                   class="player-card">
            <img :alt="`${player.username} 的头像`" :src="avatarUrl(player.username)" class="player-avatar"
                 loading="lazy"/>
            <div class="player-name"><strong>{{ player.username }}</strong><small>{{ player.display_name }}</small>
            </div>
            <span :class="pingTone(player.ping)"
                  class="player-ping"><i/>{{ player.ping === null ? '—' : `${player.ping}ms` }}</span>
            <button :aria-label="`查看 ${player.username} 的玩家档案`" :disabled="Boolean(profileLoading)" class="player-info-button"
                    type="button" @click="promptPlayerProfile(player.username)">
              {{ profileLoading === player.username ? '查询中' : 'INFO' }}
            </button>
          </article>
        </div>
      </section>
    </div>

    <BaseDialog :open="playerSearchOpen" title="查询玩家档案" @close="playerSearchOpen = false">
      <form class="player-search-dialog" @submit.prevent="queryEnteredPlayer">
        <label for="player-search-id">玩家 ID</label>
        <div class="player-search-field">
          <input id="player-search-id" v-model="playerSearchInput" autocomplete="off"
                 placeholder="输入完整或部分玩家 ID" @keydown.enter.prevent="searchPlayerNames(1)"/>
          <button :disabled="playerSearchLoading" aria-label="模糊搜索玩家 ID" type="button"
                  @click="searchPlayerNames(1)">{{ playerSearchLoading ? '…' : '⌕' }}
          </button>
        </div>
        <div class="player-search-meta"><span>模糊搜索不会扣除积分</span><b
            v-if="playerSearchTotal">{{ playerSearchTotal }} 条结果</b></div>
        <div class="player-search-body">
          <p v-if="playerSearchError" class="player-search-error">{{ playerSearchError }}</p>
          <div v-else-if="playerSearchLoading" class="player-search-loading"><span aria-hidden="true"
                                                                                   class="search-scanner"><i/><i/><i/><i/><b/></span><span>正在查询玩家名</span>
          </div>
          <div v-else-if="playerSearchResults.length" class="player-search-results">
            <button v-for="name in playerSearchResults" :key="name" :class="{ selected: playerSearchInput === name }"
                    type="button" @click="playerSearchInput = name"><span>{{
                name
              }}</span><b>选择</b></button>
          </div>
          <p v-else class="player-search-empty">
            {{ playerSearchPerformed ? '没有找到匹配的玩家 ID。' : '输入关键词后点击搜索按钮获取候选玩家。' }}</p>
        </div>
        <footer class="player-search-footer">
          <div class="player-search-pages">
            <button :disabled="playerSearchLoading || !playerSearchHasPrevious" type="button"
                    @click="searchPlayerNames(playerSearchPage - 1)">←
            </button>
            <span>{{ playerSearchPage }} / {{ playerSearchTotalPages }}</span>
            <button :disabled="playerSearchLoading || !playerSearchHasNext" type="button"
                    @click="searchPlayerNames(playerSearchPage + 1)">→
            </button>
          </div>
          <button class="player-search-submit" type="submit">查看档案</button>
        </footer>
      </form>
    </BaseDialog>

    <BaseDialog :open="confirmOpen" title="确认查询玩家档案" @close="confirmOpen = false">
      <div class="query-confirm">
        <span class="query-confirm-icon">i</span>
        <div><strong>查看 {{ pendingUsername }} 的完整档案？</strong>
          <p>本次查询将从当前账户扣除 <b>100 积分</b>。查询失败时不会扣除积分。</p></div>
      </div>
      <div class="query-confirm-balance"><span>当前可用积分</span><strong>{{
          selfInfo.user ? ((selfInfo.user.point || 0) / 100).toFixed(2) : '—'
        }}</strong></div>
      <footer class="query-confirm-actions">
        <button type="button" @click="confirmOpen = false">取消</button>
        <button type="button" @click="openPlayerProfile">确认查询</button>
      </footer>
    </BaseDialog>

    <BaseDialog :open="profileOpen" :title="selectedPlayer ? `${selectedPlayer.username} / 玩家档案` : '玩家档案'"
                size="large" @close="profileOpen = false">
      <div v-if="selectedPlayer" class="profile-dialog">
        <aside class="profile-sidebar">
          <header class="profile-identity">
            <span class="profile-avatar"><img :src="avatarUrl(selectedPlayer.username)" alt=""/><i
                :class="{ online: selectedPlayer.online }"/></span>
            <div><h2>{{ selectedPlayer.username }}</h2>
              <p>{{ selectedPlayer.online ? '正在游戏中' : '当前离线' }}</p></div>
          </header>
          <dl class="profile-details">
            <div>
              <dt>权限</dt>
              <dd>{{ selectedPlayer.role || 'member' }}</dd>
            </div>
            <div>
              <dt>首次记录</dt>
              <dd>{{ date(selectedPlayer.first_record_time) }}</dd>
            </div>
            <div>
              <dt>最近加入</dt>
              <dd>{{ date(selectedPlayer.last_join_time) }}</dd>
            </div>
            <div>
              <dt>最近离开</dt>
              <dd>{{ date(selectedPlayer.last_leave_time) }}</dd>
            </div>
          </dl>
          <div class="profile-region"><span>地区记录</span><strong>{{
              selectedPlayer.address_list?.join(' / ') || '未知'
            }}</strong></div>
        </aside>
        <main class="profile-main">
          <header class="profile-heading"><span>PLAYER WORKSPACE / {{
              selectedPlayer.online ? 'LIVE' : 'ARCHIVE'
            }}</span>
            <h3>玩家总览</h3></header>
          <section class="profile-metrics">
            <article><span>金币余额</span><strong>{{
                selectedPlayer.wallet.amount ?? '不可用'
              }}</strong><small>{{ selectedPlayer.wallet.source }}</small></article>
            <article><span>积分余额</span><strong>{{ ((selectedPlayer.point || 0) / 100).toFixed(2) }}</strong><small>POINT</small>
            </article>
            <article><span>累计在线</span><strong>{{
                duration(selectedPlayer.online_time)
              }}</strong><small>{{ selectedPlayer.online_session.length }} 条会话</small></article>
            <article><span>公开消息</span><strong>{{ selectedPlayer.message_count || 0 }}</strong><small>CHAT</small>
            </article>
          </section>
          <div class="profile-data-grid">
            <section>
              <header><h4>最近会话</h4><b>{{ selectedPlayer.online_session.length }}</b></header>
              <div class="profile-list">
                <article v-for="session in selectedPlayer.online_session.slice().reverse().slice(0, 6)"
                         :key="session.start"><span>{{
                    date(session.start)
                  }}</span><strong>{{ duration(session.duration) }}</strong><b
                    :class="{ live: !session.end }">{{ session.end ? '结束' : '进行中' }}</b></article>
                <p v-if="!selectedPlayer.online_session.length">暂无会话记录</p></div>
            </section>
            <section>
              <header><h4>金币历史</h4><b>{{ selectedPlayer.money_history.length }}</b></header>
              <div class="profile-list">
                <article v-for="entry in selectedPlayer.money_history.slice().reverse().slice(0, 6)"
                         :key="entry.timestamp"><span>{{ date(entry.timestamp) }}</span><strong>{{
                    entry.money
                  }}</strong><b>余额</b></article>
                <p v-if="!selectedPlayer.money_history.length">暂无金币记录</p></div>
            </section>
          </div>
          <section class="profile-messages">
            <header><h4>最近消息</h4><b v-if="profileMessagesLoading">读取中</b><b v-else>{{ profileMessagesTotal }}</b></header>
            <div v-if="profileMessagesLoading" class="profile-list"><p>正在查询公开消息...</p></div>
            <div v-else-if="profileMessagesError" class="profile-list profile-message-error"><p>{{ profileMessagesError }} <button type="button" @click="loadProfileMessages(selectedPlayer.username)">重试</button></p></div>
            <div v-else-if="profileMessages.length" class="profile-list profile-message-list">
              <article v-for="message in profileMessages" :key="message.id"><span>{{ date(message.create_time) }}</span><strong>{{ messageContent(message.content) || '（空消息）' }}</strong><b>{{ message.area || '未知区域' }}</b></article>
            </div>
            <div v-else class="profile-list"><p>暂无公开消息</p></div>
          </section>
          <section class="profile-landmarks">
            <header><h4>玩家地标</h4><b>{{ selectedPlayer.landmarks.length }}</b></header>
            <div v-if="selectedPlayer.landmarks.length" class="profile-landmark-list">
              <article v-for="landmark in selectedPlayer.landmarks" :key="`${landmark.owner}-${landmark.name}`">
                <span>⌂</span>
                <div><strong>{{ landmark.name }}</strong>
                  <p>{{ landmark.description }}</p></div>
                <b>{{ landmark.visits }} visits</b></article>
            </div>
            <p v-else class="profile-empty">尚未拥有公开地标。</p></section>
        </main>
      </div>
    </BaseDialog>
    <Teleport to="body">
      <Transition name="profile-loading">
        <div v-if="profileLoading && !confirmOpen && !profileOpen" class="profile-loading-overlay">
          <div class="profile-loading-box">
            <span aria-hidden="true" class="profile-loading-scanner"><i/><i/><i/><i/><b/></span>
            <strong>正在查询玩家档案</strong>
            <span>将从当前账户扣除 100 积分</span>
          </div>
        </div>
      </Transition>
    </Teleport>
  </section>
</template>

<style scoped>
.player-panel {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  margin-top: 10px;
  overflow: hidden;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 18px 46px var(--shadow);
}

.player-overview {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  height: 48px;
  min-height: 48px;
  flex: 0 0 48px;
  box-sizing: border-box;
  padding: 6px 12px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.directory-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.directory-title > div {
  min-width: 0;
}

.directory-title strong, .directory-title small {
  display: block;
}

.directory-title strong {
  font-size: 13px;
}

.directory-title small {
  margin-top: 1px;
  color: var(--muted-text);
  font-size: 11px;
}

.status-dot {
  width: 8px;
  height: 8px;
  background: var(--success);
  border-radius: 50%;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 16%, transparent);
}

.status-dot.muted {
  background: var(--muted-text);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--muted-text) 12%, transparent);
}

.directory-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.refresh-button, .player-search-button {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 32px;
  padding: 0 9px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
}

.refresh-button {
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
}

.refresh-button:hover:not(:disabled) {
  border-color: var(--accent);
  background: var(--surface-hover);
}

.refresh-button:disabled {
  cursor: wait;
  opacity: .55;
}

.refresh-button span, .player-search-button span {
  font-size: 16px;
  line-height: 1;
}

.refresh-button span {
  color: var(--accent);
}

.player-search-button {
  color: var(--accent);
  background: var(--panel-bg);
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
}

.player-search-button:hover {
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: var(--accent);
}

.player-search-button b {
  font: inherit;
}

.explore-empty {
  display: grid;
  flex: 1 1 auto;
  justify-items: center;
  align-content: center;
  gap: 8px;
  min-height: 0;
  padding: 70px 20px;
  color: var(--muted-text);
  text-align: center;
}

.explore-empty strong {
  color: var(--panel-text);
  font-size: 15px;
}

.explore-empty span {
  font-size: 11px;
}

.empty-code {
  margin-bottom: 7px;
  padding: 5px 7px;
  color: var(--muted-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 8px;
  font-weight: 700;
  letter-spacing: .12em;
}

.loading-scanner {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, 8px);
  gap: 5px;
  width: max-content;
  margin-bottom: 10px;
  padding: 9px;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;
}

.loading-scanner i {
  width: 8px;
  height: 24px;
  background: color-mix(in srgb, var(--accent) 25%, var(--surface-selected));
  border-radius: 2px;
  animation: scanner-cell 1.1s ease-in-out infinite alternate;
}

.loading-scanner i:nth-child(2) {
  animation-delay: -.8s;
}

.loading-scanner i:nth-child(3) {
  animation-delay: -.55s;
}

.loading-scanner i:nth-child(4) {
  animation-delay: -.3s;
}

.loading-scanner b {
  position: absolute;
  top: 5px;
  bottom: 5px;
  width: 2px;
  background: var(--accent);
  box-shadow: 0 0 9px color-mix(in srgb, var(--accent) 70%, transparent);
  animation: scanner-sweep 1.3s cubic-bezier(.45, 0, .55, 1) infinite alternate;
}

.roster {
  flex: 1 1 auto;
  min-height: 0;
  padding: 10px;
  overflow-y: scroll;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

.roster::-webkit-scrollbar {
  width: 3px;
}

.roster::-webkit-scrollbar-track {
  background: transparent;
}

.roster::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--accent) 58%, var(--muted-text));
  border: 0;
  border-radius: 5px;
}

.player-group {
  animation: group-enter .28s ease-out both;
}

.player-group + .player-group {
  margin-top: 14px;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 26px;
  margin-bottom: 6px;
  padding: 0 2px 5px;
  border-bottom: 1px solid var(--border);
}

.group-header strong {
  font-size: 13px;
}

.group-header span {
  color: var(--muted-text);
  font: 700 9px ui-monospace, monospace;
  letter-spacing: .08em;
}

.player-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(270px, 1fr));
  gap: 6px;
}

.player-card {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 56px;
  padding: 8px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;
  animation: player-enter .34s cubic-bezier(.22, 1, .36, 1) both;
  transition: background-color .2s ease, border-color .2s ease;
}

.player-card:hover {
  background: var(--surface-hover);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
}

.player-avatar {
  width: 38px;
  height: 38px;
  object-fit: cover;
  background: var(--surface-selected);
  border-radius: 4px;
  image-rendering: pixelated;
}

.player-name {
  min-width: 0;
}

.player-name strong, .player-name small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.player-name strong {
  font-size: 14px;
}

.player-name small {
  margin-top: 3px;
  color: var(--muted-text);
  font-size: 11px;
}

.player-ping {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 6px;
  color: var(--muted-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  font: 10px ui-monospace, monospace;
}

.player-ping i {
  width: 5px;
  height: 5px;
  background: currentColor;
  border-radius: 50%;
}

.player-ping.fast {
  color: var(--success-text);
}

.player-ping.steady {
  color: var(--warning-text);
}

.player-ping.slow {
  color: var(--danger);
}

.player-ping.unknown i {
  opacity: .28;
}

.player-info-button {
  height: 27px;
  padding: 0 8px;
  color: var(--accent);
  background: transparent;
  border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
  border-radius: 4px;
  font-size: 10px;
  font-weight: 750;
}

.player-info-button:hover:not(:disabled) {
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: var(--accent);
}

.player-info-button:disabled {
  cursor: wait;
  opacity: .55;
}

.query-confirm {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr);
  gap: 12px;
}

.query-confirm-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  color: var(--accent-contrast);
  background: var(--accent);
  border-radius: 5px;
  font-weight: 800;
}

.query-confirm strong {
  display: block;
  font-size: 14px;
}

.query-confirm p {
  margin: 6px 0 0;
  color: var(--muted-text);
  font-size: 11px;
  line-height: 1.6;
}

.query-confirm p b {
  color: var(--warning-text);
}

.query-confirm-balance {
  display: flex;
  justify-content: space-between;
  margin-top: 16px;
  padding: 10px 12px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;
}

.query-confirm-balance span {
  color: var(--muted-text);
  font-size: 10px;
}

.query-confirm-balance strong {
  color: var(--warning-text);
  font-size: 14px;
}

.query-confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
  margin-top: 14px;
}

.query-confirm-actions button {
  min-width: 76px;
  height: 34px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
}

.query-confirm-actions button:last-child {
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: var(--accent);
}

.player-search-dialog {
  display: flex;
  flex-direction: column;
  min-height: 390px;
}

.player-search-dialog > label {
  display: block;
  margin-bottom: 7px;
  font-size: 11px;
  font-weight: 700;
}

.player-search-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 38px;
}

.player-search-field input {
  min-width: 0;
  height: 40px;
  padding: 0 11px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-right: 0;
  border-radius: 5px 0 0 5px;
  outline: none;
  font-size: 13px;
}

.player-search-field input:focus {
  border-color: var(--accent);
}

.player-search-field button {
  height: 40px;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 1px solid var(--accent);
  border-radius: 0 5px 5px 0;
  font-size: 17px;
}

.player-search-meta {
  flex: 0 0 auto;
  display: flex;
  justify-content: space-between;
  min-height: 28px;
  padding-top: 7px;
  color: var(--muted-text);
  font-size: 9px;
}

.player-search-meta b {
  color: var(--accent);
}

.player-search-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.player-search-error {
  padding: 9px 10px;
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent);
  border-radius: 5px;
  font-size: 10px;
}

.player-search-loading, .player-search-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  min-height: 230px;
  margin: 0;
  color: var(--muted-text);
  font-size: 10px;
  text-align: center;
}

.search-scanner {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, 8px);
  gap: 5px;
  padding: 9px;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;
}

.search-scanner i {
  width: 8px;
  height: 24px;
  background: color-mix(in srgb, var(--accent) 25%, var(--surface-selected));
  border-radius: 2px;
  animation: search-cell 1.1s ease-in-out infinite alternate;
}

.search-scanner i:nth-child(2) {
  animation-delay: -.8s;
}

.search-scanner i:nth-child(3) {
  animation-delay: -.55s;
}

.search-scanner i:nth-child(4) {
  animation-delay: -.3s;
}

.search-scanner b {
  position: absolute;
  top: 5px;
  bottom: 5px;
  width: 2px;
  background: var(--accent);
  box-shadow: 0 0 9px color-mix(in srgb, var(--accent) 70%, transparent);
  animation: search-sweep 1.3s cubic-bezier(.45, 0, .55, 1) infinite alternate;
}

.player-search-results {
  display: grid;
  gap: 3px;
  max-height: 230px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.player-search-results > button {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 38px;
  padding: 0 10px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 12px;
}

.player-search-results > button:hover, .player-search-results > button.selected {
  background: var(--surface-selected);
  border-color: var(--border);
}

.player-search-results > button b {
  color: var(--accent);
  font-size: 9px;
}

.player-search-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
}

.player-search-pages {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--muted-text);
  font: 9px ui-monospace, monospace;
}

.player-search-pages button {
  width: 30px;
  height: 30px;
  color: var(--panel-text);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.player-search-submit {
  min-width: 94px;
  height: 34px;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 0;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 700;
}

.profile-dialog {
  display: grid;
  flex: 1 1 auto;
  grid-template-columns: 210px minmax(0, 1fr);
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 5px;
}

.profile-sidebar {
  min-height: 0;
  padding: 12px;
  overflow-y: auto;
  background: var(--surface);
  border-right: 1px solid var(--border);
}

.profile-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-bottom: 13px;
  border-bottom: 1px solid var(--border);
}

.profile-avatar {
  position: relative;
  width: 42px;
  height: 42px;
}

.profile-avatar img {
  width: 100%;
  height: 100%;
  border-radius: 5px;
  image-rendering: pixelated;
}

.profile-avatar i {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 10px;
  height: 10px;
  background: var(--muted-text);
  border: 2px solid var(--surface);
  border-radius: 50%;
}

.profile-avatar i.online {
  background: var(--success);
}

.profile-identity h2 {
  margin: 0;
  font-size: 15px;
}

.profile-identity p {
  margin: 3px 0 0;
  color: var(--muted-text);
  font-size: 8px;
}

.profile-details {
  margin: 10px 0 0;
}

.profile-details div {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
}

.profile-details dt {
  color: var(--muted-text);
  font-size: 8px;
}

.profile-details dd {
  margin: 0;
  font-size: 8px;
  text-align: right;
}

.profile-region {
  margin-top: 14px;
  padding: 10px;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.profile-region span, .profile-region strong {
  display: block;
}

.profile-region span {
  color: var(--muted-text);
  font-size: 8px;
}

.profile-region strong {
  margin-top: 6px;
  font-size: 9px;
}

.profile-main {
  min-width: 0;
  min-height: 0;
  padding: 14px;
  overflow-y: auto;
  background: var(--panel-bg);
  scrollbar-width: thin;
}

.profile-heading {
  padding-bottom: 11px;
  border-bottom: 1px solid var(--border);
}

.profile-heading span {
  color: var(--accent);
  font: 700 7px ui-monospace, monospace;
}

.profile-heading h3 {
  margin: 5px 0 0;
  font-size: 18px;
}

.profile-metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  margin-top: 10px;
}

.profile-metrics article {
  min-width: 0;
  padding: 10px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.profile-metrics span, .profile-metrics strong, .profile-metrics small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-metrics span {
  color: var(--muted-text);
  font-size: 8px;
}

.profile-metrics strong {
  margin: 7px 0 4px;
  font-size: 16px;
}

.profile-metrics small {
  color: var(--muted-text);
  font-size: 7px;
}

.profile-data-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 8px;
}

.profile-data-grid > section, .profile-messages, .profile-landmarks {
  min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
}

.profile-data-grid header, .profile-messages > header, .profile-landmarks > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  min-height: 34px;
  padding: 0 10px;
  border-bottom: 1px solid var(--border);
}

.profile-data-grid h4, .profile-messages h4, .profile-landmarks h4 {
  margin: 0;
  font-size: 10px;
}

.profile-data-grid header b, .profile-messages > header b, .profile-landmarks header b {
  color: var(--accent);
  font-size: 8px;
}

.profile-list article {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-height: 31px;
  padding: 0 9px;
  border-bottom: 1px solid var(--border);
  font-size: 8px;
}

.profile-list span {
  overflow: hidden;
  color: var(--muted-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-list article > b {
  color: var(--muted-text);
  font-size: 7px;
}

.profile-list article > b.live {
  color: var(--success-text);
}

.profile-list > p, .profile-empty {
  margin: 0;
  padding: 24px 10px;
  color: var(--muted-text);
  font-size: 9px;
  text-align: center;
}

.profile-landmarks {
  margin-top: 8px;
}

.profile-messages { margin-top: 8px; }
.profile-message-list article { grid-template-columns: 112px minmax(0, 1fr) auto; }
.profile-message-list article > strong { overflow: hidden; font-size: 8px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.profile-message-error button { margin-left: 6px; padding: 0; color: var(--accent); background: transparent; border: 0; font-size: inherit; font-weight: 800; }

.profile-landmark-list {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1px;
  background: var(--border);
}

.profile-landmark-list article {
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 8px;
  background: var(--surface);
}

.profile-landmark-list article > span {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  color: var(--accent);
  background: var(--panel-bg);
  border-radius: 4px;
}

.profile-landmark-list div {
  min-width: 0;
}

.profile-landmark-list strong, .profile-landmark-list p {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-landmark-list strong {
  font-size: 9px;
}

.profile-landmark-list p {
  margin: 3px 0 0;
  color: var(--muted-text);
  font-size: 7px;
}

.profile-landmark-list article > b {
  color: var(--muted-text);
  font-size: 7px;
  white-space: nowrap;
}

@keyframes scanner-cell {
  from {
    opacity: .35;
  }
  to {
    opacity: 1;
  }
}

@keyframes scanner-sweep {
  from {
    transform: translateX(6px);
  }
  to {
    transform: translateX(49px);
  }
}

@keyframes group-enter {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes player-enter {
  from {
    opacity: 0;
    transform: translateY(8px) scale(.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes search-cell {
  from {
    opacity: .35;
  }
  to {
    opacity: 1;
  }
}

@keyframes search-sweep {
  from {
    transform: translateX(6px);
  }
  to {
    transform: translateX(49px);
  }
}

@keyframes load-cell {
  from {
    opacity: .35;
  }
  to {
    opacity: 1;
  }
}

@keyframes load-sweep {
  from {
    transform: translateX(6px);
  }
  to {
    transform: translateX(49px);
  }
}

.profile-loading-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: grid;
  place-items: center;
  padding: 20px;
  background: var(--overlay);
  backdrop-filter: blur(5px);
}

.profile-loading-box {
  display: grid;
  justify-items: center;
  gap: 12px;
  padding: 34px 40px;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 28px 80px var(--shadow);
}

.profile-loading-box strong {
  font-size: 15px;
}

.profile-loading-box span {
  color: var(--muted-text);
  font-size: 11px;
}

.profile-loading-scanner {
  position: relative;
  display: grid;
  grid-template-columns: repeat(4, 10px);
  gap: 6px;
  padding: 11px;
  overflow: hidden;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 5px;
}

.profile-loading-scanner i {
  width: 10px;
  height: 30px;
  background: color-mix(in srgb, var(--accent) 25%, var(--surface-selected));
  border-radius: 2px;
  animation: load-cell 1.1s ease-in-out infinite alternate;
}

.profile-loading-scanner i:nth-child(2) {
  animation-delay: -.8s;
}

.profile-loading-scanner i:nth-child(3) {
  animation-delay: -.55s;
}

.profile-loading-scanner i:nth-child(4) {
  animation-delay: -.3s;
}

.profile-loading-scanner b {
  position: absolute;
  top: 6px;
  bottom: 6px;
  width: 2px;
  background: var(--accent);
  box-shadow: 0 0 9px color-mix(in srgb, var(--accent) 70%, transparent);
  animation: load-sweep 1.3s cubic-bezier(.45, 0, .55, 1) infinite alternate;
}

.profile-loading-enter-active, .profile-loading-leave-active {
  transition: opacity .2s ease;
}

.profile-loading-enter-from, .profile-loading-leave-to {
  opacity: 0;
}

@media (max-width: 760px) {
  .player-grid {
    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  }

  .profile-dialog {
    display: block;
    overflow: visible;
  }

  .profile-sidebar {
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }

  .profile-avatar {
    width: 48px;
    height: 48px;
  }

  .profile-identity h2 {
    font-size: 19px;
  }

  .profile-identity p {
    font-size: 12px;
  }

  .profile-details {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    column-gap: 14px;
  }

  .profile-details dt, .profile-details dd {
    font-size: 11px;
  }

  .profile-main {
    padding: 12px;
    overflow: visible;
  }

  .profile-metrics {
    grid-template-columns: repeat(2, 1fr);
  }

  .profile-data-grid, .profile-landmark-list {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  .player-overview {
    padding-left: 12px;
  }

  .refresh-button {
    padding-inline: 8px;
  }

  .player-search-button {
    width: 34px;
    padding: 0;
    justify-content: center;
  }

  .player-search-button b {
    display: none;
  }

  .player-card {
    grid-template-columns: 34px minmax(0, 1fr) auto;
  }

  .player-ping {
    display: none;
  }

  .profile-main {
    padding: 10px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .loading-scanner i, .loading-scanner b, .player-group, .player-card, .search-scanner i, .search-scanner b, .profile-loading-scanner i, .profile-loading-scanner b {
    animation: none;
  }

  .player-card {
    transition: none;
  }
}

/* Shared exploration title bar dimensions. */
.player-overview {
  height: 50.57px !important;
  min-height: 50.57px !important;
  max-height: 50.57px !important;
  flex: 0 0 50.57px;
  box-sizing: border-box;
  padding: 6px 12px;
  overflow: hidden;
  align-items: center !important;
}
.directory-title, .directory-actions { align-self: center; }
.directory-title strong { font-size: 12px; }
.directory-title small { font-size: 10px; }
.directory-title strong, .directory-title small { line-height: 1.1; }
.refresh-button, .player-search-button { height: 30px; min-height: 30px; padding-inline: 8px; font-size: 10px; }
.directory-title { gap: 7px; }
.status-dot { width: 7px; height: 7px; box-shadow: 0 0 0 3px color-mix(in srgb, var(--success) 16%, transparent); }
.status-dot.muted { box-shadow: 0 0 0 3px color-mix(in srgb, var(--muted-text) 12%, transparent); }
</style>
