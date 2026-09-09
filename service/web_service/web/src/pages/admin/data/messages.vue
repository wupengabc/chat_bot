<script lang="ts" setup>
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import BaseDialog from '../../../components/BaseDialog.vue'
import BaseSelect from '../../../components/BaseSelect.vue'
import BaseTooltip from '../../../components/BaseTooltip.vue'
import TimeRangePicker, {type TimeRangeValue} from '../../../components/TimeRangePicker.vue'
import {useAuthStore} from '../../../stores/auth'
import {adminMessageContextRequest, adminMessagesRequest, playerAvatarUrl, playerNamesRequest, type PublicMessage} from '../../../utils/login'

type PositionFilter = '全部位置' | 'chat' | 'system'
type MessageTypeFilter = '全部类型' | 'public' | 'private'
type PageLimit = '10' | '20' | '50' | '100'

const positionOptions: PositionFilter[] = ['全部位置', 'chat', 'system']
const ownerMessageTypeOptions: MessageTypeFilter[] = ['全部类型', 'public', 'private']
const adminMessageTypeOptions: MessageTypeFilter[] = ['全部类型', 'public']
const pageLimitOptions: PageLimit[] = ['10', '20', '50', '100']
const authStore = useAuthStore()
const isOwner = computed(() => authStore.user?.role === 'owner')
const messageTypeOptions = computed(() => isOwner.value ? ownerMessageTypeOptions : adminMessageTypeOptions)

const messages = ref<PublicMessage[]>([])
const loading = ref(false)
const loaded = ref(false)
const error = ref('')
const username = ref('')
const playerSearchOpen = ref(false)
const playerSearchInput = ref('')
const playerSearchResults = ref<string[]>([])
const playerSearchLoading = ref(false)
const playerSearchError = ref('')
const playerSearchPage = ref(1)
const playerSearchTotalPages = ref(1)
const playerSearchHasPrevious = ref(false)
const playerSearchHasNext = ref(false)
const content = ref('')
const position = ref<PositionFilter>('全部位置')
const messageType = ref<MessageTypeFilter>('全部类型')
const createTime = ref<TimeRangeValue>({from: '', to: ''})
const pageLimit = ref<PageLimit>('10')
const page = ref(1)
const pageInput = ref('1')
const total = ref(0)
const totalPages = ref(1)
const hasPrevious = ref(false)
const hasNext = ref(false)
let requestSerial = 0
const copiedMessageId = ref<number | null>(null)
const copyFailedMessageId = ref<number | null>(null)
let copyTimer: ReturnType<typeof setTimeout> | undefined
const contextOpen = ref(false)
const contextMessages = ref<PublicMessage[]>([])
const contextCenterId = ref<number | null>(null)
const contextLoading = ref(false)
const contextError = ref('')
const contextPage = ref(1)
const contextTotal = ref(0)
const contextTotalPages = ref(1)
const contextHasPrevious = ref(false)
const contextHasNext = ref(false)
const contextUsername = ref('')
const contextContent = ref('')
const contextCreateTime = ref<TimeRangeValue>({from: '', to: ''})
const contextPosition = ref<PositionFilter>('全部位置')
const contextMessageType = ref<MessageTypeFilter>('全部类型')
let contextRequestSerial = 0

function formatMessageTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function avatarUrl(name: string) {
  return playerAvatarUrl(name)
}

function formatCopyTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

function messageContent(value: string) {
  const separator = value.lastIndexOf('»')
  return separator === -1 ? value : value.slice(separator + 1).trimStart()
}

async function loadMessages(nextPage = 1) {
  const serial = ++requestSerial
  loading.value = true
  error.value = ''
  try {
    const result = await adminMessagesRequest(nextPage, Number(pageLimit.value), {
      username: username.value,
      create_time_from: createTime.value.from,
      create_time_to: createTime.value.to,
      content: content.value,
      position: position.value === '全部位置' ? '' : position.value,
      message_type: messageType.value === '全部类型' ? '' : messageType.value,
    })
    if (serial !== requestSerial) return
    messages.value = result.messages
    page.value = result.pagination.page
    pageInput.value = String(result.pagination.page)
    total.value = result.pagination.total
    totalPages.value = result.pagination.total_pages
    hasPrevious.value = result.pagination.has_previous
    hasNext.value = result.pagination.has_next
    loaded.value = true
  } catch (requestError) {
    if (serial !== requestSerial) return
    messages.value = []
    error.value = requestError instanceof Error ? requestError.message : '消息列表加载失败'
  } finally {
    if (serial === requestSerial) loading.value = false
  }
}

function searchMessages() {
  void loadMessages(1)
}

function clearFilters() {
  username.value = ''
  content.value = ''
  position.value = '全部位置'
  messageType.value = '全部类型'
  createTime.value = {from: '', to: ''}
  searchMessages()
}

function changePageLimit() {
  void loadMessages(1)
}

watch(isOwner, owner => {
  if (!owner && messageType.value === 'private') messageType.value = '全部类型'
})

function openPlayerSearch() {
  playerSearchInput.value = username.value
  playerSearchResults.value = []
  playerSearchError.value = ''
  playerSearchPage.value = 1
  playerSearchTotalPages.value = 1
  playerSearchOpen.value = true
}

async function searchPlayerNames(nextPage = 1) {
  if (playerSearchLoading.value) return
  playerSearchLoading.value = true
  playerSearchError.value = ''
  try {
    const result = await playerNamesRequest(nextPage, 10, playerSearchInput.value.trim())
    playerSearchResults.value = result.names
    playerSearchPage.value = result.pagination.page
    playerSearchTotalPages.value = result.pagination.total_pages
    playerSearchHasPrevious.value = result.pagination.has_previous
    playerSearchHasNext.value = result.pagination.has_next
  } catch (requestError) {
    playerSearchResults.value = []
    playerSearchError.value = requestError instanceof Error ? requestError.message : '玩家 ID 查询失败'
  } finally {
    playerSearchLoading.value = false
  }
}

function choosePlayer(name: string) {
  username.value = name
  playerSearchOpen.value = false
  searchMessages()
}

function copyMessage(message: PublicMessage) {
  if (copyTimer) clearTimeout(copyTimer)
  copiedMessageId.value = null
  copyFailedMessageId.value = null
  try {
    const copiedText = [
      `时间：${formatCopyTime(message.create_time)}`,
      `玩家：${message.username}`,
      `位置：${message.position}`,
      `类型：${message.message_type}`,
      `IP归属地：${message.address || '未知'}`,
      `区域：${message.area || '未知'}`,
      `消息：${messageContent(message.content)}`,
    ].join('\n')
    const textarea = document.createElement('textarea')
    textarea.value = copiedText
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.left = '-9999px'
    textarea.style.top = '0'
    document.body.appendChild(textarea)
    let copied = false
    try {
      textarea.select()
      textarea.setSelectionRange(0, copiedText.length)
      copied = document.execCommand('copy')
    } finally {
      textarea.remove()
    }
    if (!copied) throw new Error('copy failed')
    copiedMessageId.value = message.id
  } catch {
    copyFailedMessageId.value = message.id
  }
  copyTimer = setTimeout(() => {
    copiedMessageId.value = null
    copyFailedMessageId.value = null
  }, 1600)
}

async function loadMessageContext(messageId: number, nextPage?: number) {
  const serial = ++contextRequestSerial
  contextLoading.value = true
  contextError.value = ''
  try {
    const result = await adminMessageContextRequest(messageId, nextPage, {
      username: contextUsername.value,
      create_time_from: contextCreateTime.value.from,
      create_time_to: contextCreateTime.value.to,
      content: contextContent.value,
      position: contextPosition.value === '全部位置' ? '' : contextPosition.value,
      message_type: contextMessageType.value === '全部类型' ? '' : contextMessageType.value,
    })
    if (serial !== contextRequestSerial) return
    contextMessages.value = result.messages
    contextCenterId.value = result.center_id
    contextPage.value = result.pagination.page
    contextTotal.value = result.pagination.total
    contextTotalPages.value = result.pagination.total_pages
    contextHasPrevious.value = result.pagination.has_previous
    contextHasNext.value = result.pagination.has_next
  } catch (requestError) {
    if (serial !== contextRequestSerial) return
    contextError.value = requestError instanceof Error ? requestError.message : '消息上下文加载失败'
  } finally {
    if (serial === contextRequestSerial) contextLoading.value = false
  }
}

function openMessageContext(message: PublicMessage) {
  contextOpen.value = true
  contextCenterId.value = message.id
  contextMessages.value = []
  contextPage.value = 1
  contextTotal.value = 0
  contextTotalPages.value = 1
  contextHasPrevious.value = false
  contextHasNext.value = false
  contextUsername.value = ''
  contextContent.value = ''
  contextCreateTime.value = {from: '', to: ''}
  contextPosition.value = '全部位置'
  contextMessageType.value = '全部类型'
  void loadMessageContext(message.id)
}

function goToPage() {
  const requested = Number(pageInput.value)
  if (!Number.isInteger(requested)) {
    pageInput.value = String(page.value)
    return
  }
  void loadMessages(Math.min(Math.max(requested, 1), totalPages.value))
}

onMounted(() => void loadMessages())
onBeforeUnmount(() => {
  if (copyTimer) clearTimeout(copyTimer)
})
</script>

<template>
  <section class="message-panel">
    <div class="message-toolbar">
      <div class="message-summary"><span class="status-dot" :class="{ muted: !loaded && !loading }" /><div><strong>全部消息</strong><small v-if="loading" class="syncing-label">正在获取<span aria-hidden="true"><i/><i/><i/></span></small><small v-else>{{ total.toLocaleString() }}</small></div></div>
      <form class="message-filters" @submit.prevent="searchMessages">
        <label class="player-filter"><span class="sr-only">玩家 ID</span><input v-model="username" autocomplete="off" aria-label="玩家 ID" placeholder="玩家 ID" /><BaseTooltip placement="top" text="查询玩家 ID"><button type="button" aria-label="查询玩家 ID" @click="openPlayerSearch">⌕</button></BaseTooltip></label>
        <label><span class="sr-only">消息内容</span><input v-model="content" autocomplete="off" aria-label="消息内容" placeholder="消息内容" /></label>
        <label><span class="sr-only">位置</span><BaseSelect v-model="position" :options="positionOptions" aria-label="位置" /></label>
        <label><span class="sr-only">消息类型</span><BaseSelect v-model="messageType" :options="messageTypeOptions" aria-label="消息类型" /></label>
        <div class="range-filter"><TimeRangePicker v-model="createTime" /></div>
        <div class="message-filter-actions">
          <button class="message-search-button" type="submit">筛选</button>
          <button class="message-clear-button" type="button" :disabled="!username && !content && position === '全部位置' && messageType === '全部类型' && !createTime.from && !createTime.to" @click="clearFilters">清除</button>
        </div>
      </form>
      <button class="refresh-button" :class="{ syncing: loading }" type="button" :disabled="loading" aria-label="刷新消息" @click="loadMessages(page)"><span aria-hidden="true">↻</span></button>
    </div>

    <div class="message-scroll">
      <Transition name="message-page" mode="out-in">
        <div :key="page" class="message-page">
          <div v-if="loading && !messages.length" class="explore-empty message-loading">
            <span aria-hidden="true" class="message-loader"><i/><i/><i/><i/><b/></span>
            <strong>正在读取全部消息</strong><span>从邦溪世界档案同步最新消息记录</span>
          </div>
          <div v-else-if="error" class="explore-empty message-unavailable">
            <span class="empty-code">NO SIGNAL</span><strong>暂时无法读取消息</strong><span>{{ error }}</span>
            <button type="button" @click="loadMessages(page)">重新尝试</button>
          </div>
          <div v-else-if="!messages.length" class="explore-empty message-unavailable">
            <span class="empty-code">NO MATCH</span><strong>没有匹配的消息</strong><span>调整筛选条件后重新查询。</span>
          </div>
          <div v-else class="message-stream">
            <article v-for="message in messages" :key="message.id" class="message-item">
              <img class="message-avatar" :src="avatarUrl(message.username)" :alt="`${message.username} 的头像`" loading="lazy" />
              <div class="message-body">
                <header class="message-head"><strong>{{ message.username }}</strong><span>{{ message.position }} / {{ message.message_type }}</span></header>
                <p>{{ messageContent(message.content) || '（空消息）' }}</p>
              </div>
              <div class="message-meta"><time>{{ formatMessageTime(message.create_time) }}</time><span>{{ message.area || '未知区域' }} · {{ message.address || '未知地址' }}</span></div>
              <BaseTooltip placement="top" text="查看上下文"><button type="button" class="context-message" :aria-label="`查看 ${message.username} 的消息上下文`" @click="openMessageContext(message)"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2zm4-1a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/></svg></button></BaseTooltip>
              <BaseTooltip placement="top" :text="copiedMessageId === message.id ? '已复制' : copyFailedMessageId === message.id ? '复制失败' : '复制消息'"><button type="button" class="copy-message" :class="{success: copiedMessageId === message.id, failed: copyFailedMessageId === message.id}" :aria-label="`复制 ${message.username} 的消息`" @click="copyMessage(message)"><i aria-hidden="true"></i></button></BaseTooltip>
            </article>
          </div>
        </div>
      </Transition>
    </div>

    <footer class="message-pagination">
      <span>共 {{ totalPages }} 页</span>
      <div class="page-controls"><label class="limit-filter"><span>每页</span><BaseSelect v-model="pageLimit" :options="pageLimitOptions" aria-label="每页消息数量" placement="top" @update:model-value="changePageLimit" /></label><button class="edge-page" type="button" :disabled="loading || !hasPrevious" @click="loadMessages(1)">首页</button><button type="button" :disabled="loading || !hasPrevious" aria-label="上一页" @click="loadMessages(page - 1)">←</button><label><span>第</span><input v-model="pageInput" inputmode="numeric" aria-label="页码" @keydown.enter.prevent="goToPage" /><span>页</span></label><button class="page-go" type="button" :disabled="loading" @click="goToPage">跳转</button><button type="button" :disabled="loading || !hasNext" aria-label="下一页" @click="loadMessages(page + 1)">→</button><button class="edge-page" type="button" :disabled="loading || !hasNext" @click="loadMessages(totalPages)">末页</button></div>
    </footer>

    <BaseDialog :open="playerSearchOpen" title="查询玩家 ID" @close="playerSearchOpen = false">
      <form class="player-search-dialog" @submit.prevent="searchPlayerNames(1)">
        <div class="player-search-field"><input v-model="playerSearchInput" autocomplete="off" placeholder="输入完整或部分玩家 ID" /><button type="submit" :disabled="playerSearchLoading">{{ playerSearchLoading ? '…' : '⌕' }}</button></div>
        <div class="player-search-body">
          <p v-if="playerSearchError" class="player-search-error">{{ playerSearchError }}</p>
          <p v-else-if="playerSearchLoading" class="player-search-state">正在查询玩家 ID...</p>
          <div v-else-if="playerSearchResults.length" class="player-search-results"><button v-for="name in playerSearchResults" :key="name" type="button" @click="choosePlayer(name)"><strong>{{ name }}</strong><span>选择</span></button></div>
          <p v-else class="player-search-state">输入关键词后查询玩家 ID。</p>
        </div>
        <footer><span>{{ playerSearchPage }} / {{ playerSearchTotalPages }}</span><div><button type="button" :disabled="playerSearchLoading || !playerSearchHasPrevious" @click="searchPlayerNames(playerSearchPage - 1)">←</button><button type="button" :disabled="playerSearchLoading || !playerSearchHasNext" @click="searchPlayerNames(playerSearchPage + 1)">→</button></div></footer>
      </form>
    </BaseDialog>

    <BaseDialog :open="contextOpen" title="消息上下文" size="wide" panel-class="dialog-context" @close="contextOpen = false">
      <div class="context-dialog">
        <form class="context-filters" @submit.prevent="contextCenterId && loadMessageContext(contextCenterId, 1)">
          <label><span class="sr-only">玩家 ID</span><input v-model="contextUsername" autocomplete="off" aria-label="玩家 ID" placeholder="玩家 ID" /></label>
          <label><span class="sr-only">消息内容</span><input v-model="contextContent" autocomplete="off" aria-label="消息内容" placeholder="消息内容" /></label>
          <label><span class="sr-only">位置</span><BaseSelect v-model="contextPosition" :options="positionOptions" aria-label="位置" /></label>
          <label><span class="sr-only">消息类型</span><BaseSelect v-model="contextMessageType" :options="messageTypeOptions" aria-label="消息类型" /></label>
          <div class="range-filter"><TimeRangePicker v-model="contextCreateTime" /></div>
          <div class="context-filter-actions">
            <button class="context-search-button" type="submit">筛选</button>
            <button class="context-clear-button" type="button" :disabled="!contextUsername && !contextContent && contextPosition === '全部位置' && contextMessageType === '全部类型' && !contextCreateTime.from && !contextCreateTime.to" @click="contextUsername=''; contextContent=''; contextCreateTime={from:'',to:''}; contextPosition='全部位置'; contextMessageType='全部类型'; contextCenterId && loadMessageContext(contextCenterId, 1)">清除</button>
          </div>
        </form>
        <p class="context-caption">共 {{ contextTotal }} 条消息，已定位到引用消息所在页</p>
        <p v-if="contextLoading" class="context-state">正在读取消息上下文...</p>
        <p v-else-if="contextError" class="context-state context-error">{{ contextError }}</p>
        <div v-else class="context-stream">
          <article v-for="message in contextMessages" :key="message.id" class="context-item" :class="{ focused: message.id === contextCenterId }"><time>{{ formatCopyTime(message.create_time) }}</time><strong>{{ message.username }}</strong><span>{{ message.position }} / {{ message.message_type }}</span><p>{{ messageContent(message.content) || '（空消息）' }}</p></article>
        </div>
        <footer v-if="contextTotalPages > 1" class="context-pagination"><button type="button" :disabled="contextLoading || !contextHasPrevious" @click="contextCenterId && loadMessageContext(contextCenterId, contextPage - 1)">上一页</button><span>{{ contextPage }} / {{ contextTotalPages }}</span><button type="button" :disabled="contextLoading || !contextHasNext" @click="contextCenterId && loadMessageContext(contextCenterId, contextPage + 1)">下一页</button></footer>
      </div>
    </BaseDialog>
  </section>
</template>

<style scoped>
.message-panel { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; margin-top: 10px; overflow: hidden; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 18px 46px var(--shadow); }
.message-toolbar { position: relative; z-index: 7; display: grid; grid-template-columns: auto minmax(0, 1fr) 34px; align-items: center; gap: 10px; flex: 0 0 auto; min-height: 54px; padding: 9px 11px; background: var(--panel-bg); border-bottom: 1px solid var(--border); }
.message-summary { display: flex; align-items: center; gap: 8px; padding-right: 10px; border-right: 1px solid var(--border); white-space: nowrap; }
.message-summary > div { display: grid; gap: 2px; width: 108px; }
.message-summary strong { font-size: 11px; }
.message-summary small { display: block; min-width: 0; color: var(--muted-text); font-size: 9px; }
.message-summary small.syncing-label { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.syncing-label > span { display: flex; align-items: end; gap: 2px; width: 12px; height: 8px; }
.syncing-label i { display: block; width: 2px; height: 4px; background: var(--accent); border-radius: 1px; animation: sync-pulse .72s ease-in-out infinite alternate; }
.syncing-label i:nth-child(2) { height: 7px; animation-delay: -.24s; }
.syncing-label i:nth-child(3) { height: 5px; animation-delay: -.48s; }
.status-dot { width: 7px; height: 7px; background: var(--success); border-radius: 50%; box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 18%, transparent); }
.status-dot.muted { background: var(--muted-text); box-shadow: 0 0 0 4px color-mix(in srgb, var(--muted-text) 16%, transparent); }
.refresh-button, .message-search-button, .message-clear-button { height: 34px; padding: 0 10px; border: 1px solid var(--border); border-radius: 4px; color: var(--panel-text); background: var(--surface); font-size: 10px; font-weight: 700; }
.refresh-button { display: grid; place-items: center; width: 34px; padding: 0; }
.refresh-button span { font-size: 15px; }
.refresh-button.syncing span { animation: refresh-spin .8s linear infinite; }
.refresh-button:hover:not(:disabled), .message-clear-button:hover:not(:disabled) { border-color: var(--accent); }
.refresh-button:disabled, .message-search-button:disabled, .message-clear-button:disabled { cursor: not-allowed; opacity: .5; }
.message-filters { display: grid; grid-template-columns: minmax(88px, .55fr) minmax(120px, .75fr) minmax(88px, .4fr) minmax(88px, .4fr) minmax(240px, 1.2fr) auto; gap: 6px; align-items: center; min-width: 0; }
.message-filters label, .range-filter { display: block; min-width: 0; color: var(--muted-text); font-size: 10px; font-weight: 650; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.message-filters input { width: 100%; height: 36px; padding: 0 9px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; outline: none; font-size: 11px; }
.message-filters input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent); }
.message-filters :deep(.base-select) { width: 100%; }
.message-filters :deep(.select-trigger) { height: 36px; background: var(--surface); border-radius: 4px; }
.message-filters input::placeholder { color: var(--muted-text); opacity: .75; }
.limit-filter { display: grid !important; grid-template-columns: 34px 58px; align-items: center; gap: 5px; }
.limit-filter > span { color: var(--muted-text); font-size: 11px; }
.limit-filter :deep(.base-select) { width: 58px; }
.limit-filter :deep(.select-trigger) { height: 30px; background: var(--surface); border-radius: 4px; }
.message-filter-actions { display: flex; gap: 6px; }
.player-filter { display: grid !important; grid-template-columns: minmax(0, 1fr) 34px; }
.player-filter input { border-radius: 4px 0 0 4px; }
.player-filter :deep(.tooltip-trigger) { min-width: 34px; }.player-filter > :deep(.tooltip-trigger) > button { width: 34px; height: 36px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-left: 0; border-radius: 0 4px 4px 0; font-size: 16px; }
.player-filter > button:hover { color: var(--accent); }
.message-search-button { color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }
.message-search-button:hover { filter: brightness(1.07); }
.message-scroll { flex: 1 1 auto; min-height: 0; padding: 0 12px; overflow-y: scroll; overscroll-behavior: contain; scrollbar-gutter: stable; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--accent) 68%, var(--muted-text)) transparent; }
.message-scroll::-webkit-scrollbar { width: 5px; }
.message-scroll::-webkit-scrollbar-track { background: transparent; }
.message-scroll::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--accent) 68%, var(--muted-text)); border: 0; border-radius: 3px; }
.message-page { height: 100%; min-height: 100%; }
.message-page-enter-active, .message-page-leave-active { transition: opacity .16s ease, transform .22s cubic-bezier(.22, 1, .36, 1); }
.message-page-enter-from { opacity: 0; transform: translateX(12px); }
.message-page-leave-to { opacity: 0; transform: translateX(-8px); }
.message-stream { display: grid; align-content: start; }
.message-item { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr) minmax(92px, auto) 28px 28px; gap: 9px; align-items: center; padding: 7px 4px; border-bottom: 1px solid var(--border); transition: background-color .2s ease; }
.message-item:hover { background: var(--surface); }
.message-avatar { grid-column: 1; grid-row: 1; width: 28px; height: 28px; object-fit: cover; background: var(--surface-selected); border-radius: 3px; image-rendering: pixelated; }
.message-body { min-width: 0; }
.message-head { display: flex; align-items: baseline; gap: 7px; }
.message-head strong { color: var(--panel-text); font-size: 11px; }
.message-head span { color: var(--accent); font-size: 8px; font-weight: 700; }
.message-body p { margin: 3px 0 0; color: var(--panel-text); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.message-meta { display: grid; justify-items: end; gap: 3px; min-width: 92px; color: var(--muted-text); text-align: right; }
.message-meta time { font-size: 9px; }
.message-meta span { font-size: 8px; white-space: nowrap; }
.copy-message, .context-message { position: relative; display: grid; place-items: center; width: 28px; height: 28px; padding: 0; color: var(--muted-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.context-message:hover { color: var(--accent); background: var(--surface-hover); border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.context-message svg { width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
.copy-message:hover { color: var(--accent); background: var(--surface-hover); border-color: color-mix(in srgb, var(--accent) 55%, var(--border)); }
.copy-message i { position: relative; width: 10px; height: 10px; border: 1.5px solid currentColor; border-radius: 2px; transform: translate(1px, 1px); }
.copy-message i::before { content: ""; position: absolute; left: -4px; top: -4px; width: 8px; height: 8px; border: 1.5px solid currentColor; border-radius: 2px; background: var(--surface); }
.copy-message.success { color: var(--success); background: var(--success-soft); border-color: color-mix(in srgb, var(--success) 45%, var(--border)); }
.copy-message.success i { width: 11px; height: 6px; border: 0; border-left: 2px solid currentColor; border-bottom: 2px solid currentColor; border-radius: 0; transform: translateY(-1px) rotate(-45deg); }
.copy-message.success i::before { display: none; }
.copy-message.failed { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 45%, var(--border)); }
.copy-message.failed i { width: 12px; height: 12px; border: 0; transform: none; }
.copy-message.failed i::before, .copy-message.failed i::after { content: ""; position: absolute; top: 5px; left: 1px; display: block; width: 10px; height: 1.5px; border: 0; border-radius: 1px; background: currentColor; transform: rotate(45deg); }
.copy-message.failed i::after { transform: rotate(-45deg); }
.message-pagination { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex: 0 0 45px; min-height: 45px; padding: 7px 12px; color: var(--muted-text); background: var(--panel-bg); border-top: 1px solid var(--border); font-size: 9px; }
.page-controls { display: flex; align-items: center; gap: 5px; }
.message-pagination button { display: grid; place-items: center; width: 30px; height: 30px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; font-size: 17px; }
.message-pagination button:hover:not(:disabled) { color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }
.message-pagination button:disabled { cursor: not-allowed; opacity: .4; }
.page-controls label { display: flex; align-items: center; gap: 4px; }
.page-controls input { width: 46px; height: 30px; padding: 0 5px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; outline: none; text-align: center; font-size: 10px; }
.page-controls input:focus { border-color: var(--accent); }
.message-pagination .page-go { width: auto; padding: 0 8px; font-size: 9px; }
.message-pagination .edge-page { width: auto; padding: 0 8px; font-size: 9px; }
.player-search-dialog { display: grid; gap: 12px; }
.context-dialog { display: grid; grid-template-rows: auto auto minmax(0, 1fr) auto; gap: 10px; min-height: 0; }
.context-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.context-filters label { display: block; min-width: 0; color: var(--muted-text); font-size: 10px; font-weight: 650; }
.context-filters input { width: 120px; height: 30px; padding: 0 8px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; outline: none; font-size: 11px; }
.context-filters input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 13%, transparent); }
.context-filters input::placeholder { color: var(--muted-text); opacity: .75; }
.context-filters :deep(.base-select) { width: 100px; }
.context-filters :deep(.select-trigger) { height: 30px; background: var(--surface); border-radius: 4px; }
.context-filter-actions { display: flex; gap: 4px; }
.context-search-button, .context-clear-button { height: 30px; padding: 0 8px; border: 1px solid var(--border); border-radius: 4px; color: var(--panel-text); background: var(--surface); font-size: 10px; font-weight: 700; }
.context-search-button { color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }
.context-search-button:hover { filter: brightness(1.07); }
.context-clear-button:hover:not(:disabled) { border-color: var(--accent); }
.context-clear-button:disabled { cursor: not-allowed; opacity: .5; }
.context-caption { margin: 0; color: var(--muted-text); font-size: 10px; }
.context-state { margin: 0; padding: 40px 0; color: var(--muted-text); text-align: center; font-size: 11px; }
.context-error { color: var(--danger); }
.context-stream { display: grid; align-content: start; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--accent) 62%, var(--muted-text)) transparent; border: 1px solid var(--border); border-radius: 4px; }
.context-stream::-webkit-scrollbar { width: 4px; }.context-stream::-webkit-scrollbar-track { background: transparent; }.context-stream::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--accent) 62%, var(--muted-text)); border-radius: 2px; }
.context-item { display: grid; grid-template-columns: 118px 110px 84px minmax(0, 1fr); gap: 8px; align-items: baseline; padding: 8px 10px; border-bottom: 1px solid var(--border); }
.context-item:last-child { border-bottom: 0; }
.context-item.focused { background: color-mix(in srgb, var(--accent) 14%, var(--surface)); box-shadow: inset 3px 0 0 var(--accent); }
.context-item time { color: var(--muted-text); font-size: 9px; }
.context-item strong, .context-item span { color: var(--accent); font-size: 10px; overflow-wrap: anywhere; }
.context-item span { color: var(--muted-text); }
.context-item p { margin: 0; color: var(--panel-text); font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; }
.context-pagination { display: flex; align-items: center; justify-content: flex-end; gap: 8px; color: var(--muted-text); font-size: 10px; }.context-pagination button { height: 28px; padding: 0 9px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 3px; font-size: 10px; }.context-pagination button:disabled { cursor: not-allowed; opacity: .45; }.context-pagination button:hover:not(:disabled) { color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }
.player-search-field { display: grid; grid-template-columns: minmax(0, 1fr) 38px; }
.player-search-field input { height: 38px; padding: 0 10px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px 0 0 4px; outline: none; }
.player-search-field input:focus { border-color: var(--accent); }
.player-search-field button { color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 0 4px 4px 0; font-size: 16px; }
.player-search-body { min-height: 180px; }
.player-search-results { display: grid; gap: 3px; }
.player-search-results button { display: flex; align-items: center; justify-content: space-between; min-height: 34px; padding: 0 9px; color: var(--panel-text); background: transparent; border: 1px solid transparent; border-radius: 3px; text-align: left; }
.player-search-results button:hover { background: var(--surface-hover); border-color: var(--border); }
.player-search-results strong { font-size: 11px; }
.player-search-results span { color: var(--accent); font-size: 9px; }
.player-search-state, .player-search-error { margin: 0; padding: 14px 9px; color: var(--muted-text); font-size: 10px; }
.player-search-error { color: var(--danger); }
.player-search-dialog > footer { display: flex; align-items: center; justify-content: space-between; padding-top: 10px; color: var(--muted-text); border-top: 1px solid var(--border); font-size: 9px; }
.player-search-dialog > footer div { display: flex; gap: 5px; }
.player-search-dialog > footer button { width: 30px; height: 30px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 3px; }
.message-loading, .message-unavailable { min-height: 260px; }
.message-loading { display: grid; place-content: center; justify-items: center; gap: 7px; width: 100%; height: 100%; min-height: 320px; color: var(--muted-text); text-align: center; }
.message-loading strong { margin-top: 5px; color: var(--panel-text); font-size: 13px; }
.message-loading > span:last-child { max-width: 260px; font-size: 10px; line-height: 1.5; }
.message-loader { position: relative; display: flex; align-items: end; gap: 5px; width: 72px; height: 52px; margin-bottom: 5px; padding: 10px 11px 9px; overflow: hidden; background: var(--surface); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 10px 28px color-mix(in srgb, var(--shadow) 32%, transparent), inset 0 0 0 1px color-mix(in srgb, var(--panel-bg) 48%, transparent); }
.message-loader::before { content: ""; position: absolute; inset: 5px; border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent); border-radius: 3px; pointer-events: none; }
.message-loader i { position: relative; z-index: 1; display: block; flex: 1; height: 8px; background: color-mix(in srgb, var(--accent) 45%, var(--surface)); border-radius: 2px 2px 0 0; animation: message-bars .8s ease-in-out infinite alternate; }
.message-loader i:nth-child(2) { height: 17px; animation-delay: -.2s; }
.message-loader i:nth-child(3) { height: 12px; animation-delay: -.4s; }
.message-loader i:nth-child(4) { height: 21px; animation-delay: -.6s; }
.message-loader b { position: absolute; z-index: 2; left: 7px; right: 7px; bottom: 7px; height: 2px; background: var(--accent); border-radius: 2px; box-shadow: 0 -9px 20px color-mix(in srgb, var(--accent) 58%, transparent); animation: message-scan 1.1s ease-in-out infinite alternate; }
.message-unavailable { display: grid; place-content: center; justify-items: center; gap: 7px; height: 100%; color: var(--muted-text); text-align: center; }
.message-unavailable strong { color: var(--panel-text); font-size: 13px; }
.message-unavailable > span:not(.empty-code) { font-size: 10px; }
.message-unavailable .empty-code { color: var(--accent); font-size: 8px; font-weight: 750; letter-spacing: .12em; }
.message-unavailable button { margin-top: 8px; padding: 8px 12px; color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 4px; font-size: 11px; font-weight: 700; }
@keyframes sync-pulse { from { opacity: .42; transform: scaleY(.58); } to { opacity: 1; transform: scaleY(1); } }
@keyframes refresh-spin { to { transform: rotate(360deg); } }
@keyframes message-bars { from { opacity: .42; transform: scaleY(.55); transform-origin: bottom; } to { opacity: 1; transform: scaleY(1); transform-origin: bottom; } }
@keyframes message-scan { from { transform: translateX(-60%); } to { transform: translateX(60%); } }
@media (max-width: 1120px) { .message-toolbar { grid-template-columns: minmax(0, 1fr) 34px; align-items: start; } .message-summary { display: none; } .message-filters { grid-column: 1; grid-row: 1; grid-template-columns: repeat(2, minmax(0, 1fr)); } .range-filter, .message-filter-actions { grid-column: span 2; } .message-filter-actions > * { flex: 1; } .refresh-button { grid-column: 2; grid-row: 1; } }
@media (max-width: 480px) { .message-filters { grid-template-columns: minmax(0, 1fr); } .range-filter, .message-filter-actions { grid-column: auto; } .message-scroll { padding-inline: 8px; } .message-pagination { padding-inline: 8px; } .message-pagination > span { display: none; } .page-controls { width: 100%; justify-content: center; } .page-controls label span { display: none; } .limit-filter span { display: inline; } .message-pagination .edge-page { padding-inline: 6px; } .message-item { grid-template-columns: 28px minmax(0, 1fr) 28px; align-items: start; } .message-body { grid-column: 2; } .message-meta { grid-column: 2; grid-row: 2; display: flex; justify-items: start; gap: 7px; min-width: 0; text-align: left; } .message-meta span { padding-left: 7px; border-left: 1px solid var(--border); } .message-item > :deep(.tooltip-trigger) { grid-column: 3; } .message-item > :deep(.tooltip-trigger):nth-last-child(2) { grid-row: 1; } .message-item > :deep(.tooltip-trigger):last-child { grid-row: 2; } .context-item { grid-template-columns: 1fr; gap: 3px; } }
@media (prefers-reduced-motion: reduce) { .message-page-enter-active, .message-page-leave-active { transition-duration: .01ms; } .message-page-enter-from, .message-page-leave-to { transform: none; } .syncing-label i, .refresh-button.syncing span, .message-loader i, .message-loader b { animation: none; } }
</style>
