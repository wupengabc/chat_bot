<script setup lang="ts">
import {computed, nextTick, onBeforeUnmount, onMounted, ref} from 'vue'
import AgentMarkdown from '../components/AgentMarkdown.vue'
import BaseCheckbox from '../components/BaseCheckbox.vue'
import BaseDialog from '../components/BaseDialog.vue'
import {useAlertStore} from '../stores/alert'
import {useAuthStore} from '../stores/auth'
import {messageContextRequest, type PublicMessage} from '../utils/login'
import {
  createAgentConversation, deleteAgentConversation,
  getAgentConversation, getPublicAgentConversation, listAgentConversations, listAgentLobby,
  listAgentTools,
  publishAgentConversation, renameAgentConversation, rollbackAgentConversation, streamAgentConversation, streamAgentMessage, streamPublicAgentConversation, unpublishAgentConversation,
  type AgentActiveRun, type AgentConversation, type AgentMessage, type AgentToolDefinition,
} from '../utils/agent'

type AgentView = 'workspace' | 'lobby'
type RunPhase = 'idle' | 'planning' | 'running' | 'waiting' | 'completed' | 'error'
const AGENT_PROMPT_POINT_COST = 100

interface AgentQuestion {
  id: string
  prompt: string
  options: string[]
  allow_free_text: boolean
  timeout_seconds: number
  expires_at: string
}

interface AgentArtifact {
  id: string
  type: 'svg'
  title: string
  caption: string
  content: string
}

interface AgentCitation {
  message_id: number
  username: string
  content: string
  area: string
  create_time: string
}

interface AgentPlayerProfile {
  username: string
  premium: boolean | null
  uuid: string | null
  avatar_url: string
  profile_url: string | null
}

interface AgentToolProgress {
  phase: 'loading' | 'research' | 'merging'
  current: number
  total: number
  unit?: 'messages' | 'tokens' | 'steps'
  completed_batches?: number
  total_batches?: number
}

const authStore = useAuthStore()
const alertStore = useAlertStore()
const isAdmin = computed(() => authStore.user?.role === 'admin' || authStore.user?.role === 'owner')
const view = ref<AgentView>('workspace')
const conversations = ref<AgentConversation[]>([])
const conversationsLoading = ref(false)
const conversationsPage = ref(1)
const conversationsTotal = ref(0)
const conversationsTotalPages = ref(1)
const activeConversation = ref<AgentConversation | null>(null)
const messages = ref<AgentMessage[]>([])
const messagesLoading = ref(false)
const sending = ref(false)
const recoveringRun = ref(false)
const composer = ref('')
const checkpointAnswer = ref('')
const runPhase = ref<RunPhase>('idle')
const availableTools = ref<AgentToolDefinition[]>([])
const availableToolsLoading = ref(false)
const availableToolsError = ref('')
const publishOnRun = ref(false)
const publishOpen = ref(false)
const publishLoading = ref(false)
const publishAnonymous = ref(false)
const renameOpen = ref(false)
const renameTitle = ref('')
const renameLoading = ref(false)
const renameError = ref('')
const confirmAction = ref<'withdraw' | 'delete' | 'unpublish' | null>(null)
const confirmTarget = ref<AgentMessage | null>(null)
const confirmLoading = ref(false)
const confirmError = ref('')
const runViewport = ref<HTMLElement | null>(null)
const liveArtifacts = ref<AgentArtifact[]>([])
const liveSuggestions = ref<string[]>([])
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
let contextRequestSerial = 0
const questionClock = ref(Date.now())

const lobbyItems = ref<AgentConversation[]>([])
const lobbyLoading = ref(false)
const lobbyKeyword = ref('')
const lobbyPage = ref(1)
const lobbyTotalPages = ref(1)
const publicConversation = ref<AgentConversation | null>(null)
const publicMessages = ref<AgentMessage[]>([])
const publicLoading = ref(false)
const publicViewport = ref<HTMLElement | null>(null)
const publicLiveArtifacts = ref<AgentArtifact[]>([])
const publicLiveSuggestions = ref<string[]>([])
const failedAvatarUsers = ref(new Set<string>())
let publicStreamController: AbortController | null = null
let recoveryTimer: ReturnType<typeof setInterval> | null = null
let questionTimer: ReturnType<typeof setInterval> | null = null
let privateStreamController: AbortController | null = null

const toolLabels: Record<string, string> = {
  get_server_status: '服务器状态',
  search_player_names: '玩家索引',
  search_public_messages: '公开聊天检索',
  get_public_message_context: '公开聊天上下文',
  get_current_time: '当前真实时间',
  get_player_database_profile: '玩家数据库记录',
  search_minecraft_wiki: 'Minecraft Wiki',
  list_shops: '商店索引',
  get_shop_snapshot: '商店快照',
  delegate_research_summary: '调查总结子 Agent',
  delegate_message_research: '并行消息调查子 Agent',
  render_svg: 'SVG 产物',
  ask_player: '玩家确认',
  suggest_next_steps: '下一步建议',
}

function metadataString(message: AgentMessage, key: string) {
  return typeof message.metadata[key] === 'string' ? String(message.metadata[key]) : ''
}

function questionFromMessage(message: AgentMessage | null | undefined): AgentQuestion | null {
  const value = message?.metadata.question
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const question = value as Partial<AgentQuestion>
  if (typeof question.id !== 'string' || typeof question.prompt !== 'string') return null
  return {
    id: question.id,
    prompt: question.prompt,
    options: Array.isArray(question.options) ? question.options.filter((item): item is string => typeof item === 'string').slice(0, 4) : [],
    allow_free_text: question.allow_free_text !== false,
    timeout_seconds: Number.isFinite(Number(question.timeout_seconds)) ? Number(question.timeout_seconds) : 600,
    expires_at: typeof question.expires_at === 'string' ? question.expires_at : '',
  }
}

function questionExpired(question?: AgentQuestion | null) {
  void questionClock.value
  if (!question?.expires_at) return false
  const expiresAt = Date.parse(question.expires_at)
  return Number.isFinite(expiresAt) && expiresAt <= Date.now()
}

function questionRemaining(question?: AgentQuestion | null) {
  if (!question?.expires_at) return ''
  const remaining = Math.max(0, Date.parse(question.expires_at) - Date.now())
  if (!Number.isFinite(remaining)) return ''
  const seconds = Math.ceil(remaining / 1000)
  if (seconds <= 0) return '已过期，可追加 Prompt 继续'
  const minutes = Math.floor(seconds / 60)
  return minutes ? `${minutes} 分钟内有效` : `${seconds} 秒内有效`
}

function pendingQuestionFor(source: AgentMessage[]) {
  let pending: AgentMessage | null = null
  for (const message of source) {
    if (message.role === 'assistant' && message.metadata.workflow_status === 'waiting_for_input') pending = message
    if (message.role === 'user' && pending) {
      const question = questionFromMessage(pending)
      if (question && message.metadata.question_id === question.id) pending = null
    }
  }
  const question = questionFromMessage(pending)
  return questionExpired(question) ? null : pending
}

function artifactsFrom(source: AgentMessage[]) {
  for (const message of [...source].reverse()) {
    if (!Array.isArray(message.metadata.artifacts)) continue
    return (message.metadata.artifacts as AgentArtifact[]).filter(artifact => artifact?.type === 'svg' && typeof artifact.content === 'string')
  }
  return []
}

function artifactsByToolMessage(source: AgentMessage[], outputs: AgentArtifact[]) {
  const result = new Map<number, AgentArtifact>()
  const renderMessages = source.filter(message => message.role === 'tool' && metadataString(message, 'tool_name') === 'render_svg')
  for (const [index, message] of renderMessages.entries()) {
    let artifactId = ''
    try {
      const content = JSON.parse(message.content)
      artifactId = typeof content?.artifact_id === 'string' ? content.artifact_id : ''
    } catch { artifactId = '' }
    const artifact = outputs.find(item => item.id === artifactId) || outputs[index]
    if (artifact) result.set(message.id, artifact)
  }
  return result
}

function suggestionsFrom(source: AgentMessage[]) {
  const latestTool = [...source].reverse().find(message => message.role === 'tool' && metadataString(message, 'tool_name') === 'suggest_next_steps')
  const toolSuggestions = suggestionsFromToolMessage(latestTool)
  if (toolSuggestions.length) return toolSuggestions
  const latestResult = [...source].reverse().find(message => message.role === 'assistant' && message.metadata.workflow_kind === 'agent_run')
  return latestResult ? filterSuggestions(latestResult.metadata.suggestions) : []
}

function suggestionsFromToolMessage(message: AgentMessage | null | undefined) {
  if (message?.role !== 'tool' || metadataString(message, 'tool_name') !== 'suggest_next_steps') return []
  const input = message.metadata.tool_input
  if (!input || typeof input !== 'object' || Array.isArray(input)) return []
  return filterSuggestions((input as Record<string, unknown>).suggestions)
}

function citationsFromMessage(message: AgentMessage) {
  if (!Array.isArray(message.metadata.citations)) return []
  return message.metadata.citations.flatMap(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return []
    const citation = item as Partial<AgentCitation>
    const messageId = Number(citation.message_id)
    if (!Number.isSafeInteger(messageId) || messageId <= 0) return []
    return [{
      message_id: messageId,
      username: typeof citation.username === 'string' ? citation.username : '',
      content: typeof citation.content === 'string' ? citation.content : '',
      area: typeof citation.area === 'string' ? citation.area : '',
      create_time: typeof citation.create_time === 'string' ? citation.create_time : '',
    }]
  }).slice(0, 24)
}

function playerProfileFromMessage(message: AgentMessage): AgentPlayerProfile | null {
  const value = message.metadata.player_profile
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const profile = value as Partial<AgentPlayerProfile>
  const username = typeof profile.username === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(profile.username) ? profile.username : ''
  if (!username) return null
  const premium = profile.premium === true ? true : profile.premium === false ? false : null
  return {
    username,
    premium,
    uuid: typeof profile.uuid === 'string' && /^[a-f0-9-]{32,36}$/i.test(profile.uuid) ? profile.uuid : null,
    avatar_url: premium
      ? `https://land.wupeng1.top/api/generate/minimal/mojang/${encodeURIComponent(username)}?type=head&scale=150`
      : `https://littleskin.cn/avatar/player/${encodeURIComponent(username)}`,
    profile_url: premium ? `https://mcprofiles.me/player/${encodeURIComponent(username)}` : null,
  }
}

function playerProfilesFrom(source: AgentMessage[]) {
  const profiles = new Map<number, AgentPlayerProfile>()
  for (const message of source) {
    const profile = playerProfileFromMessage(message)
    if (profile) profiles.set(message.id, profile)
  }
  return profiles
}

function avatarInitial(username: string) {
  return username.trim().slice(0, 1).toUpperCase() || '?'
}

function avatarFailed(username: string) {
  return failedAvatarUsers.value.has(username)
}

function markAvatarFailed(username: string) {
  if (!username || failedAvatarUsers.value.has(username)) return
  failedAvatarUsers.value = new Set([...failedAvatarUsers.value, username])
}

function escapeProfileHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character] || character))
}

function playerProfileDocument(profile?: AgentPlayerProfile) {
  if (!profile?.premium || !profile.uuid || !profile.profile_url) return ''
  const username = escapeProfileHtml(profile.username)
  const uuid = escapeProfileHtml(profile.uuid)
  const avatarUrl = escapeProfileHtml(profile.avatar_url)
  const profileUrl = escapeProfileHtml(profile.profile_url)
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}html{color-scheme:light dark}body{margin:0;padding:18px;font:14px/1.5 system-ui,sans-serif;color:CanvasText;background:Canvas}.profile{display:grid;grid-template-columns:86px minmax(0,1fr);gap:18px;align-items:center;min-height:128px}.avatar{position:relative;width:86px;height:86px;overflow:hidden;border:1px solid GrayText;background:ButtonFace}.avatar-fallback{display:grid;place-items:center;width:100%;height:100%;color:ButtonText;background:ButtonFace;font-size:34px;font-weight:800}.avatar img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;image-rendering:pixelated}.profile div{min-width:0}.eyebrow{margin:0 0 4px;color:#20a36a;font-size:11px;font-weight:800;text-transform:uppercase}.name{margin:0;font-size:24px;overflow-wrap:anywhere}.uuid{margin:8px 0 14px;color:GrayText;font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}.link{display:inline-flex;align-items:center;min-height:32px;padding:0 10px;color:ButtonText;background:ButtonFace;border:1px solid GrayText;text-decoration:none;font-size:12px;font-weight:700}@media(max-width:420px){body{padding:12px}.profile{grid-template-columns:58px minmax(0,1fr);gap:12px}.avatar{width:58px;height:58px}.avatar-fallback{font-size:22px}.name{font-size:19px}}</style></head><body><main class="profile"><div class="avatar"><span class="avatar-fallback">${username.slice(0, 1).toUpperCase()}</span><img src="${avatarUrl}" alt="${username} 的 Minecraft 头像"></div><div><p class="eyebrow">Minecraft Premium Profile</p><h1 class="name">${username}</h1><p class="uuid">UUID ${uuid}</p><a class="link" href="${profileUrl}" target="_blank" rel="noreferrer">在 MCProfiles 查看完整档案</a></div></main></body></html>`
}

function intentText(value: string) {
  if (/<\s*(?:tool_call\b|function=|parameter=)/i.test(value)) return '已调用本轮所需工具并基于真实结果完成整理。'
  const lines = value.replace(/\*{0,2}执行计划[:：]?\*{0,2}/g, '').split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !/^\|?\s*:?-{2,}/.test(line) && !line.includes('|'))
  const visible = lines.slice(0, 4).join('\n').slice(0, 240).trim()
  return visible || '已调用本轮所需工具并基于真实结果整理输出。'
}

function suggestionItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string' || !value.trim()) return []
  const parseList = (source: string): unknown[] | null => {
    try {
      const parsed = JSON.parse(source)
      return Array.isArray(parsed) ? parsed : typeof parsed === 'string' ? [parsed] : []
    } catch { return null }
  }
  const candidate = value.trim()
  const parsed = parseList(candidate)
  if (parsed !== null) return parsed
  const lineItems = candidate.split(/\r?\n/).flatMap(line => parseList(line.trim()) || [])
  return lineItems.length ? lineItems : [candidate]
}

function filterSuggestions(value: unknown) {
  const items = suggestionItems(value)
  return items.filter((item): item is string => {
    if (typeof item !== 'string') return false
    const content = item.toLowerCase().replace(/\s+/g, '')
    const commerce = /(商店|百货|商品|物品|价格|售价|收购价|卖价|买价|行情)/.test(content)
    const comparison = /(对比|比较|vs\.?|更便宜|更贵|最低价|最高价|最划算|性价比|优劣|排名|哪家|哪个好|哪个更)/.test(content)
    const otherShop = /商店索引|(?:其他|其它|另一|别家).{0,8}(?:商店|百货)|(?:商店|百货).{0,8}(?:其他|其它|另一|别家)/.test(content)
    return !(commerce && comparison) && !otherShop
  }).slice(0, 4)
}

const taskMessage = computed(() => messages.value.find(message => message.role === 'user' && message.metadata.workflow_stage !== 'input_response') || null)
const pendingQuestionMessage = computed(() => pendingQuestionFor(messages.value))
const pendingQuestion = computed(() => questionFromMessage(pendingQuestionMessage.value))
const latestThinkingMessage = computed(() => [...messages.value].reverse().find(message => metadataString(message, 'thinking_summary') || message.metadata.thinking_streaming === true) || null)
const thinkingText = computed(() => latestThinkingMessage.value ? intentText(metadataString(latestThinkingMessage.value, 'thinking_summary')) : '')
const activityMessages = computed(() => messages.value.filter(message => message !== taskMessage.value && (
  message.role === 'tool' || message.role === 'user' || message.role === 'assistant'
)))
const artifacts = computed(() => liveArtifacts.value.length ? liveArtifacts.value : artifactsFrom(messages.value))
const inlineArtifacts = computed(() => artifactsByToolMessage(activityMessages.value, artifacts.value))
const playerProfiles = computed(() => playerProfilesFrom(messages.value))
const suggestions = computed(() => liveSuggestions.value.length ? liveSuggestions.value : suggestionsFrom(messages.value))
const canPublish = computed(() => Boolean(activeConversation.value && taskMessage.value && !sending.value && !recoveringRun.value))

const publicTask = computed(() => publicMessages.value.find(message => message.role === 'user' && message.metadata.workflow_stage !== 'input_response') || null)
const publicPendingQuestionMessage = computed(() => pendingQuestionFor(publicMessages.value))
const publicLatestThinking = computed(() => [...publicMessages.value].reverse().find(message => metadataString(message, 'thinking_summary') || message.metadata.thinking_streaming === true) || null)
const publicThinkingText = computed(() => publicLatestThinking.value ? intentText(metadataString(publicLatestThinking.value, 'thinking_summary')) : '')
const publicActivityMessages = computed(() => publicMessages.value.filter(message => message !== publicTask.value && (
  message.role === 'tool' || message.role === 'user' || message.role === 'assistant'
)))
const publicArtifacts = computed(() => publicLiveArtifacts.value.length ? publicLiveArtifacts.value : artifactsFrom(publicMessages.value))
const publicInlineArtifacts = computed(() => artifactsByToolMessage(publicActivityMessages.value, publicArtifacts.value))
const publicPlayerProfiles = computed(() => playerProfilesFrom(publicMessages.value))
const publicRunActive = ref(false)
const publicSuggestions = computed(() => publicLiveSuggestions.value.length ? publicLiveSuggestions.value : publicRunActive.value ? [] : suggestionsFrom(publicMessages.value))

function formatDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'}).format(date)
}

function formatContextTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(date)
}

function messageContent(value: string) {
  const separator = value.lastIndexOf('»')
  return separator === -1 ? value : value.slice(separator + 1).trimStart()
}

async function loadMessageContext(messageId: number, nextPage?: number) {
  const serial = ++contextRequestSerial
  contextLoading.value = true
  contextError.value = ''
  try {
    const result = await messageContextRequest(messageId, nextPage, {})
    if (serial !== contextRequestSerial) return
    contextMessages.value = result.messages
    contextCenterId.value = result.center_id
    contextPage.value = result.pagination.page
    contextTotal.value = result.pagination.total
    contextTotalPages.value = result.pagination.total_pages
    contextHasPrevious.value = result.pagination.has_previous
    contextHasNext.value = result.pagination.has_next
  } catch (error) {
    if (serial !== contextRequestSerial) return
    contextError.value = error instanceof Error ? error.message : '消息上下文加载失败'
  } finally {
    if (serial === contextRequestSerial) contextLoading.value = false
  }
}

function openMessageContext(messageId: number) {
  contextOpen.value = true
  contextCenterId.value = messageId
  contextMessages.value = []
  contextPage.value = 1
  contextTotal.value = 0
  contextTotalPages.value = 1
  contextHasPrevious.value = false
  contextHasNext.value = false
  void loadMessageContext(messageId)
}

function preview(value?: string | null) {
  const text = (value || '尚未运行任务').replace(/\s+/g, ' ').trim()
  if (text.startsWith('{')) return '工具调用已完成'
  return text.slice(0, 72)
}

function statusLabel(status?: string) {
  return ({draft: '草稿', running: '执行中', waiting_for_input: '等待输入', completed: '已完成', error: '失败'} as Record<string, string>)[status || 'draft'] || '草稿'
}

function sessionMeta(conversation: AgentConversation) {
  return isAdmin.value ? `${conversation.owner_username || '匿名玩家'} · ${workflowStatus(conversation)}` : workflowStatus(conversation)
}

function workflowStatus(conversation: AgentConversation) {
  if (activeConversation.value?.id === conversation.id && sending.value) return runPhase.value === 'waiting' ? '等待输入' : '执行中'
  if (activeConversation.value?.id === conversation.id && conversation.workflow_status === 'waiting_for_input' && !pendingQuestion.value) return '问题已过期，可继续'
  return statusLabel(conversation.workflow_status)
}

function messageKind(message: AgentMessage) {
  if (message.role === 'tool') return 'tool'
  if (message.role === 'user') return 'response'
  if (message.metadata.workflow_status === 'waiting_for_input') return 'question'
  if (message.metadata.workflow_status === 'error') return 'error'
  return 'output'
}

function messageTitle(message: AgentMessage) {
  const kind = messageKind(message)
  if (kind === 'tool') return toolLabels[metadataString(message, 'tool_name')] || metadataString(message, 'tool_name') || '工具调用'
  if (kind === 'response') return '玩家 Prompt'
  if (kind === 'question') return '等待玩家输入'
  if (kind === 'error') return 'Session 失败'
  return message.streaming ? '正在生成结果' : 'Agent Result'
}

function messageStatus(message: AgentMessage) {
  if (message.streaming) return '进行中'
  if (message.role === 'tool') return message.metadata.tool_status === 'error' ? '失败' : '已完成'
  if (message.metadata.workflow_status === 'waiting_for_input') return questionExpired(questionFromMessage(message)) ? '已过期' : '已暂停'
  if (message.metadata.workflow_status === 'error') return '失败'
  return '已完成'
}

function toolProgress(message: AgentMessage): AgentToolProgress | null {
  const value = message.metadata.tool_progress
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const progress = value as Partial<AgentToolProgress>
  const current = Number(progress.current)
  const total = Number(progress.total)
  if (!['loading', 'research', 'merging'].includes(String(progress.phase)) || !Number.isFinite(current) || !Number.isFinite(total)) return null
  return {
    phase: progress.phase as AgentToolProgress['phase'],
    current: Math.max(0, current),
    total: Math.max(0, total),
    unit: progress.unit,
    completed_batches: Number.isFinite(Number(progress.completed_batches)) ? Number(progress.completed_batches) : undefined,
    total_batches: Number.isFinite(Number(progress.total_batches)) ? Number(progress.total_batches) : undefined,
  }
}

function toolProgressPercent(message: AgentMessage) {
  const progress = toolProgress(message)
  if (!progress?.total) return 0
  return Math.max(0, Math.min(100, Math.round(progress.current / progress.total * 100)))
}

function toolProgressLabel(message: AgentMessage) {
  const progress = toolProgress(message)
  if (!progress) return metadataString(message, 'tool_summary') || '工具正在运行'
  const detail = metadataString(message, 'tool_summary')
  const withDetail = (value: string) => detail ? `${value} · ${detail}` : value
  const label = ({loading: '读取调查数据', research: '子 Agent 并行调查', merging: '合并调查结果'} as const)[progress.phase]
  if (progress.unit === 'tokens') {
    const formatTokens = (value: number) => value >= 10000 ? `${(value / 10000).toFixed(1).replace(/\.0$/, '')} 万` : value.toLocaleString('zh-CN')
    const batches = progress.total_batches ? ` · ${progress.completed_batches || 0}/${progress.total_batches} 个子 Agent` : ''
    return withDetail(`${label} · 约 ${formatTokens(Math.min(progress.current, progress.total))}/${formatTokens(progress.total)} 输入 Token${batches}`)
  }
  const unit = progress.unit === 'messages' ? ' 条消息' : ''
  return withDetail(progress.total ? `${label} ${Math.min(progress.current, progress.total)}/${progress.total}${unit}` : `${label} · 第 ${progress.current} 层`)
}

function displayMessageContent(message: AgentMessage) {
  if (messageKind(message) !== 'output') return message.content
  const lines = message.content.split(/\r?\n/)
  const headingIndex = lines.findIndex((line) => {
    const heading = line
      .trim()
      .replace(/^#{1,6}\s*/, '')
      .replace(/[*_~`]/g, '')
      .replace(/^[^A-Za-z0-9\u3400-\u9fff]+|[^A-Za-z0-9\u3400-\u9fff]+$/g, '')
    return heading === '下一步' || heading === '下一步建议'
  })
  return headingIndex >= 0 ? lines.slice(0, headingIndex).join('\n').trimEnd() : message.content
}

function toolInput(message: AgentMessage) {
  const input = message.metadata.tool_input
  if (!input || typeof input !== 'object') return '{}'
  return JSON.stringify(compactToolValue(input, 0, 6), null, 2).slice(0, 800)
}

function toolResult(message: AgentMessage) {
  try { return JSON.stringify(compactToolValue(JSON.parse(message.content), 0, 4), null, 2).slice(0, 1800) }
  catch { return message.content.slice(0, 1200) }
}

function compactToolValue(value: unknown, depth: number, itemLimit: number): unknown {
  if (typeof value === 'string') return value.length > 320 ? `${value.slice(0, 320)}...` : value
  if (typeof value !== 'object' || value === null) return value
  if (depth >= 3) return Array.isArray(value) ? `[${value.length} items]` : '[object]'
  if (Array.isArray(value)) {
    const visible = value.slice(0, itemLimit).map(item => compactToolValue(item, depth + 1, itemLimit))
    return value.length > itemLimit ? [...visible, `... ${value.length - itemLimit} more`] : visible
  }
  const entries = Object.entries(value as Record<string, unknown>)
  const compact = Object.fromEntries(entries.slice(0, 10).map(([key, item]) => [key, compactToolValue(item, depth + 1, itemLimit)]))
  if (entries.length > 10) compact._omitted_fields = entries.length - 10
  return compact
}

function svgUrl(artifact?: AgentArtifact) {
  if (!artifact) return ''
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artifact.content)}`
}

function phaseFromConversation(conversation: AgentConversation, source: AgentMessage[]): RunPhase {
  if (!source.some(message => message.role === 'user')) return 'idle'
  if (pendingQuestionFor(source)) return 'waiting'
  if (conversation.workflow_status === 'waiting_for_input') return 'completed'
  if (conversation.workflow_status === 'completed') return 'completed'
  if (conversation.workflow_status === 'error') return 'error'
  if (source.some(message => message.metadata.workflow_status === 'completed' || message.metadata.workflow_kind === 'single_task')) return 'completed'
  return conversation.workflow_status === 'running' ? 'running' : 'error'
}

async function scrollRunToBottom() {
  await nextTick()
  const viewport = runViewport.value?.querySelector<HTMLElement>('.session-scroll') || runViewport.value
  if (viewport) viewport.scrollTop = viewport.scrollHeight
}

async function scrollPublicToBottom() {
  await nextTick()
  if (publicViewport.value) publicViewport.value.scrollTop = publicViewport.value.scrollHeight
}

function replaceConversation(conversation: AgentConversation) {
  activeConversation.value = conversation
  const index = conversations.value.findIndex(item => item.id === conversation.id)
  if (index >= 0) conversations.value.splice(index, 1, conversation)
  else if (conversationsPage.value === 1 && (conversation.message_count || 0) > 0) conversations.value.unshift(conversation)
}

function stopRunRecovery() {
  if (recoveryTimer) clearInterval(recoveryTimer)
  recoveryTimer = null
  recoveringRun.value = false
  if (privateStreamController) {
    privateStreamController.abort()
    privateStreamController = null
  }
}

function restoreActiveRun(snapshot: AgentActiveRun) {
  runPhase.value = snapshot.phase === 'thinking' ? 'planning' : 'running'
  const draft: AgentMessage = {
    id: -1_000_000_000 - (activeConversation.value?.id || 0),
    conversation_id: activeConversation.value?.id || 0,
    role: 'assistant',
    content: snapshot.output || '',
    metadata: {
      workflow_stage: 'output',
      workflow_status: 'running',
      run_id: snapshot.run_id,
      thinking_summary: snapshot.thinking_summary || snapshot.summary,
      thinking_streaming: snapshot.phase === 'thinking',
    },
    created_at: snapshot.updated_at,
    streaming: true,
  }
  const existingIndex = messages.value.findIndex(message =>
    message.role === 'assistant' && message.streaming && message.metadata.run_id === snapshot.run_id,
  )
  if (existingIndex >= 0) messages.value.splice(existingIndex, 1, draft)
  else messages.value.push(draft)
  if (snapshot.phase === 'tool' && snapshot.tool_call_id) {
    upsertToolMessage({
      tool_call_id: snapshot.tool_call_id,
      tool_name: snapshot.tool_name,
      label: snapshot.label,
      input: snapshot.input,
      summary: snapshot.summary,
      progress: snapshot.progress,
    }, false)
  }
}

async function refreshRecoveredRun() {
  const conversation = activeConversation.value
  if (!conversation || !recoveringRun.value) return
  try {
    const result = await getAgentConversation(conversation.id)
    if (activeConversation.value?.id !== conversation.id) return
    activeConversation.value = result.conversation
    messages.value = result.messages
    if (result.active_run) {
      restoreActiveRun(result.active_run)
      await scrollRunToBottom()
      return
    }
    runPhase.value = phaseFromConversation(result.conversation, result.messages)
    await scrollRunToBottom()
    stopRunRecovery()
    await loadConversations(activeConversation.value?.id)
  } catch {}
}

function startRunRecovery(activeRun: AgentActiveRun | null) {
  stopRunRecovery()
  if (!activeRun) return
  restoreActiveRun(activeRun)
  recoveringRun.value = true
  recoveryTimer = setInterval(() => void refreshRecoveredRun(), 2_000)
  // 页面刷新后重新连接运行中的会话流，实时接收思考链与正文增量。
  const conversationId = activeConversation.value?.id
  if (conversationId) {
    const controller = new AbortController()
    privateStreamController = controller
    void streamAgentConversation(conversationId, () => authStore.resourceToken, () => authStore.refreshAccessToken(), event => {
      handleRecoveredStreamEvent(event)
    }, controller.signal).catch(() => {})
  }
}

function handleRecoveredStreamEvent(event: {event: string; data: Record<string, any>}) {
  const runId = String(event.data.run_id || '')
  const draftIndex = () => messages.value.findIndex(message => message.role === 'assistant' && message.streaming && (!runId || message.metadata.run_id === runId))
  if (event.event === 'thinking.delta' && runId) {
    const index = draftIndex()
    const draft = index >= 0 ? messages.value[index] : null
    if (draft) draft.metadata = {...draft.metadata, thinking_summary: event.data.replay ? String(event.data.content || '') : `${metadataString(draft, 'thinking_summary')}${String(event.data.content || '')}`, thinking_streaming: true}
  }
  if (event.event === 'thinking.completed' && runId) {
    const index = draftIndex()
    const draft = index >= 0 ? messages.value[index] : null
    if (draft) draft.metadata = {...draft.metadata, thinking_summary: String(event.data.content || metadataString(draft, 'thinking_summary')), thinking_streaming: false}
  }
  if (event.event === 'run.progress' && runId) {
    const index = draftIndex()
    const draft = index >= 0 ? messages.value[index] : null
    if (draft) draft.metadata = {...draft.metadata, thinking_summary: String(event.data.summary || metadataString(draft, 'thinking_summary')), thinking_streaming: false}
  }
  if (event.event === 'tool.delta' || event.event === 'tool.started' || event.event === 'tool.progress') upsertToolMessage(event.data, false)
  if (event.event === 'tool.cancelled') cancelToolMessage(event.data)
  if (event.event === 'tool.completed') upsertToolMessage(event.data, true)
  if (event.event === 'message.delta' && runId) {
    const index = draftIndex()
    if (index >= 0) {
      const draft = messages.value[index]!
      draft.content = event.data.replay ? String(event.data.content || '') : draft.content + String(event.data.content || '')
    }
  }
  if (event.event === 'message.completed' && event.data.message) {
    const index = draftIndex()
    if (index >= 0) messages.value.splice(index, 1, event.data.message)
    else if (!messages.value.some(message => message.id === event.data.message.id)) messages.value.push(event.data.message)
  }
  if (event.event === 'run.completed' || event.event === 'run.error') void refreshRecoveredRun()
  void scrollRunToBottom()
}

async function loadAvailableTools() {
  if (availableToolsLoading.value) return
  availableToolsLoading.value = true
  availableToolsError.value = ''
  try {
    availableTools.value = (await listAgentTools()).tools
  } catch (error) {
    availableToolsError.value = error instanceof Error ? error.message : '请稍后重试'
  } finally { availableToolsLoading.value = false }
}

async function loadConversations(preferredId?: number, page = conversationsPage.value, selectFallback = false) {
  conversationsLoading.value = true
  try {
    const result = await listAgentConversations(page)
    conversations.value = result.conversations
    conversationsPage.value = result.pagination.page
    conversationsTotal.value = result.pagination.total
    conversationsTotalPages.value = result.pagination.total_pages
    const target = conversations.value.find(item => item.id === preferredId)
      || conversations.value.find(item => item.id === activeConversation.value?.id)
      || (selectFallback ? conversations.value[0] : null)
    if (target && target.id !== activeConversation.value?.id) await selectConversation(target.id)
    else if (!target && selectFallback) {
      activeConversation.value = null
      messages.value = []
      composer.value = ''
      checkpointAnswer.value = ''
      liveArtifacts.value = []
      liveSuggestions.value = []
      publishOnRun.value = true
      publishAnonymous.value = false
      runPhase.value = 'idle'
    }
  } catch (error) { alertStore.error('读取 Agent Sessions 失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { conversationsLoading.value = false }
}

function loadConversationPage(page: number) {
  if (sending.value || recoveringRun.value) return
  void loadConversations(undefined, page)
}

async function selectConversation(id: number) {
  if (sending.value || recoveringRun.value) return
  messagesLoading.value = true
  try {
    const result = await getAgentConversation(id)
    activeConversation.value = result.conversation
    messages.value = result.messages
    publishOnRun.value = result.conversation.visibility === 'public'
    publishAnonymous.value = result.conversation.anonymous
    composer.value = ''
    checkpointAnswer.value = ''
    liveArtifacts.value = []
    liveSuggestions.value = []
    runPhase.value = phaseFromConversation(result.conversation, result.messages)
    startRunRecovery(result.active_run)
    await scrollRunToBottom()
  } catch (error) { alertStore.error('读取 Agent Session 失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { messagesLoading.value = false }
}

function createConversation(seed = '') {
  if (sending.value || recoveringRun.value) return
  activeConversation.value = null
  messages.value = []
  composer.value = seed
  checkpointAnswer.value = ''
  liveArtifacts.value = []
  liveSuggestions.value = []
  publishOnRun.value = true
  publishAnonymous.value = false
  runPhase.value = 'idle'
  stopPublicStream()
  view.value = 'workspace'
}

function openRenameConversation() {
  const conversation = activeConversation.value
  if (!conversation) return
  renameTitle.value = conversation.title
  renameError.value = ''
  renameOpen.value = true
}

async function renameConversation() {
  const conversation = activeConversation.value
  const title = renameTitle.value.trim()
  if (!conversation || renameLoading.value) return
  if (!title || title === conversation.title) return
  renameLoading.value = true
  renameError.value = ''
  try { replaceConversation((await renameAgentConversation(conversation.id, title)).conversation); renameOpen.value = false }
  catch (error) { renameError.value = error instanceof Error ? error.message : '请稍后重试' }
  finally { renameLoading.value = false }
}

async function withdrawPrompt(message: AgentMessage) {
  const conversation = activeConversation.value
  if (!conversation || message.role !== 'user') return
  if (sending.value || recoveringRun.value) {
    alertStore.warning('暂不能撤回', '当前 Session 正在执行，请等待本轮完成')
    return
  }
  confirmTarget.value = message
  confirmAction.value = 'withdraw'
  confirmError.value = ''
}

async function confirmWithdraw() {
  const conversation = activeConversation.value
  const message = confirmTarget.value
  if (!conversation || !message || confirmLoading.value) return
  confirmLoading.value = true
  confirmError.value = ''
  try {
    const result = await rollbackAgentConversation(conversation.id, message.id)
    activeConversation.value = result.conversation
    messages.value = result.messages
    composer.value = ''
    checkpointAnswer.value = ''
    liveArtifacts.value = []
    liveSuggestions.value = []
    runPhase.value = phaseFromConversation(result.conversation, result.messages)
    stopRunRecovery()
    await loadConversations(conversation.id)
    confirmAction.value = null
    alertStore.success('Prompt 已撤回', '该 Prompt 及其后续上下文已删除')
    await scrollRunToBottom()
  } catch (error) {
    confirmError.value = error instanceof Error ? error.message : '请稍后重试'
  } finally { confirmLoading.value = false }
}

function removeConversation() {
  const conversation = activeConversation.value
  if (!conversation || sending.value) return
  confirmTarget.value = null
  confirmAction.value = 'delete'
  confirmError.value = ''
}

async function confirmDeleteConversation() {
  const conversation = activeConversation.value
  if (!conversation || confirmLoading.value) return
  confirmLoading.value = true
  confirmError.value = ''
  try {
    await deleteAgentConversation(conversation.id)
    activeConversation.value = null
    messages.value = []
    conversations.value = conversations.value.filter(item => item.id !== conversation.id)
    await loadConversations(undefined, conversationsPage.value, true)
    confirmAction.value = null
  } catch (error) { confirmError.value = error instanceof Error ? error.message : '请稍后重试' }
  finally { confirmLoading.value = false }
}

function upsertToolMessage(event: Record<string, any>, completed: boolean) {
  const toolCallId = String(event.tool_call_id || '')
  const existingIndex = messages.value.findIndex(message => message.role === 'tool' && message.metadata.tool_call_id === toolCallId)
  if (completed && event.message) {
    if (existingIndex >= 0) messages.value.splice(existingIndex, 1, event.message)
    else {
      const draftIndex = messages.value.findIndex(message => message.role === 'assistant' && message.streaming)
      messages.value.splice(draftIndex >= 0 ? draftIndex : messages.value.length, 0, event.message)
    }
    return
  }
  if (existingIndex >= 0) {
    const message = messages.value[existingIndex]!
    message.metadata = {
      ...message.metadata,
      tool_name: event.tool_name || message.metadata.tool_name,
      tool_summary: String(event.summary || message.metadata.tool_summary || '工具正在运行'),
      tool_status: 'running',
      ...(Object.prototype.hasOwnProperty.call(event, 'input') ? {tool_input: event.input || {}} : {}),
      ...(event.progress ? {tool_progress: event.progress} : {}),
    }
    message.streaming = true
    return
  }
  const toolMessage: AgentMessage = {
    id: -Date.now() - messages.value.length,
    conversation_id: activeConversation.value?.id || 0,
    role: 'tool',
    content: '',
    metadata: {
      workflow_stage: 'tool', workflow_status: 'running', tool_call_id: toolCallId,
      tool_name: event.tool_name, tool_summary: String(event.summary || `${event.label || event.tool_name || '工具'}正在运行`),
      tool_status: 'running', tool_input: event.input || {}, ...(event.progress ? {tool_progress: event.progress} : {}),
    },
    created_at: new Date().toISOString(),
    streaming: !completed,
  }
  const draftIndex = messages.value.findIndex(message => message.role === 'assistant' && message.streaming)
  messages.value.splice(draftIndex >= 0 ? draftIndex : messages.value.length, 0, toolMessage)
}

function cancelToolMessage(event: Record<string, any>) {
  const toolCallId = String(event.tool_call_id || '')
  messages.value = messages.value.filter(message => !(message.role === 'tool' && message.streaming && message.metadata.tool_call_id === toolCallId))
}

async function runAgent(providedContent?: string) {
  let conversation = activeConversation.value
  const answering = Boolean(pendingQuestion.value)
  const existingTask = taskMessage.value
  const content = (providedContent ?? (answering ? checkpointAnswer.value : composer.value)).trim()
  if (!content || sending.value || recoveringRun.value) return
  if (!conversation) {
    try {
      conversation = (await createAgentConversation()).conversation
      activeConversation.value = conversation
    } catch (error) {
      alertStore.error('创建 Agent Session 失败', error instanceof Error ? error.message : '请稍后重试')
      return
    }
  }

  const now = new Date().toISOString()
  let localUser: AgentMessage | null = null
  if (answering) {
    localUser = {id: -Date.now(), conversation_id: conversation.id, role: 'user', content, metadata: {workflow_stage: 'input_response', question_id: pendingQuestion.value?.id, workflow_status: 'running'}, created_at: now}
    messages.value.push(localUser)
  } else if (!existingTask) {
    localUser = {id: -Date.now(), conversation_id: conversation.id, role: 'user', content, metadata: {workflow_stage: 'task', workflow_status: 'running'}, created_at: now}
    messages.value.push(localUser)
  } else {
    localUser = {id: -Date.now(), conversation_id: conversation.id, role: 'user', content, metadata: {workflow_stage: 'follow_up', workflow_status: 'running'}, created_at: now}
    messages.value.push(localUser)
  }
  const localAssistant: AgentMessage = {id: -Date.now() - 1, conversation_id: conversation.id, role: 'assistant', content: '', metadata: {workflow_stage: 'output'}, created_at: now, streaming: true}
  messages.value.push(localAssistant)
  composer.value = ''
  checkpointAnswer.value = ''
  liveSuggestions.value = []
  sending.value = true
  runPhase.value = 'planning'
  await scrollRunToBottom()

  const draftIndex = () => messages.value.findIndex(message => message === localAssistant || message.id === localAssistant.id)
  let streamError = ''
  const refundNotice = {point: 0, balance: null as number | null}
  let waitingForInput = false
  try {
    await streamAgentMessage(conversation.id, content, () => authStore.resourceToken, () => authStore.refreshAccessToken(), event => {
      if (event.event === 'workflow.started' && event.data.conversation) {
        replaceConversation(event.data.conversation)
        publishOnRun.value = event.data.conversation.visibility === 'public'
        if (event.data.run_id) localAssistant.metadata = {...localAssistant.metadata, run_id: String(event.data.run_id)}
        const chargedPoint = Number(event.data.billing?.charged_point)
        const remainingPoint = Number(event.data.billing?.point)
        if (Number.isFinite(chargedPoint) && chargedPoint > 0) {
          alertStore.info(
            `已扣除 ${chargedPoint.toLocaleString('zh-CN')} 积分`,
            Number.isFinite(remainingPoint) ? `剩余 ${remainingPoint.toLocaleString('zh-CN')} 积分` : '本次 Prompt 已开始执行',
          )
        }
      }
      if (event.event === 'message.started' && event.data.user_message && localUser) Object.assign(localUser, event.data.user_message)
      if (event.event === 'thinking.started') {
        runPhase.value = 'planning'
        const index = draftIndex()
        if (index >= 0) messages.value[index]!.metadata = {...messages.value[index]!.metadata, thinking_summary: '', thinking_streaming: true}
      }
      if (event.event === 'thinking.delta') {
        const index = draftIndex()
        const draft = index >= 0 ? messages.value[index] : null
        if (draft) draft.metadata = {...draft.metadata, thinking_summary: `${metadataString(draft, 'thinking_summary')}${String(event.data.content || '')}`, thinking_streaming: true}
      }
      if (event.event === 'thinking.completed') {
        runPhase.value = 'running'
        const index = draftIndex()
        const draft = index >= 0 ? messages.value[index] : null
        if (draft) draft.metadata = {...draft.metadata, thinking_summary: String(event.data.content || metadataString(draft, 'thinking_summary')), thinking_streaming: false}
      }
      if (event.event === 'run.progress') {
        runPhase.value = 'running'
        const index = draftIndex()
        const draft = index >= 0 ? messages.value[index] : null
        if (draft) draft.metadata = {...draft.metadata, thinking_summary: String(event.data.summary || metadataString(draft, 'thinking_summary')), thinking_streaming: false}
      }
      if (event.event === 'tool.delta') { runPhase.value = 'running'; upsertToolMessage(event.data, false) }
      if (event.event === 'tool.started') { runPhase.value = 'running'; upsertToolMessage(event.data, false) }
      if (event.event === 'tool.progress') { runPhase.value = 'running'; upsertToolMessage(event.data, false) }
      if (event.event === 'tool.cancelled') cancelToolMessage(event.data)
      if (event.event === 'tool.completed') {
        upsertToolMessage(event.data, true)
        const toolSuggestions = suggestionsFromToolMessage(event.data.message)
        if (toolSuggestions.length) liveSuggestions.value = toolSuggestions
      }
      if (event.event === 'artifact.created' && event.data.artifact) liveArtifacts.value = [...liveArtifacts.value.filter(item => item.id !== event.data.artifact.id), event.data.artifact]
      if (event.event === 'suggestions.ready') {
        const nextSuggestions = filterSuggestions(event.data.suggestions)
        if (nextSuggestions.length) liveSuggestions.value = nextSuggestions
      }
      if (event.event === 'input.required' && event.data.message) {
        const index = draftIndex()
        if (index >= 0) messages.value.splice(index, 1, event.data.message)
        else messages.value.push(event.data.message)
        waitingForInput = true
        runPhase.value = 'waiting'
      }
      if (event.event === 'run.paused') {
        waitingForInput = true
        runPhase.value = 'waiting'
        if (event.data.conversation) replaceConversation(event.data.conversation)
      }
      if (event.event === 'message.delta') {
        runPhase.value = 'running'
        const index = draftIndex()
        if (index >= 0) messages.value[index]!.content += String(event.data.content || '')
      }
      if (event.event === 'message.completed' && event.data.message) {
        const index = draftIndex()
        if (index >= 0) messages.value.splice(index, 1, event.data.message)
        else messages.value.push(event.data.message)
        runPhase.value = 'completed'
      }
      if (event.event === 'run.completed' && event.data.conversation) replaceConversation(event.data.conversation)
      if (event.event === 'run.error') {
        const index = draftIndex()
        if (event.data.error_message && index >= 0) messages.value.splice(index, 1, event.data.error_message)
        const refund = Number(event.data.billing?.refunded_point)
        const balance = Number(event.data.billing?.point)
        if (Number.isFinite(refund) && refund > 0) {
          refundNotice.point = refund
          refundNotice.balance = Number.isFinite(balance) ? balance : null
        }
        runPhase.value = 'error'
        streamError = String(event.data.message || 'Agent Session 失败')
      }
      void scrollRunToBottom()
    }, {publish: publishOnRun.value, anonymous: publishAnonymous.value})
    if (streamError) throw new Error(streamError)
    const index = draftIndex()
    if (index >= 0 && !messages.value[index]!.content.trim() && !waitingForInput) messages.value.splice(index, 1)
    await loadConversations(activeConversation.value?.id, 1)
  } catch (error) {
    const index = draftIndex()
    if (index >= 0 && !messages.value[index]!.content.trim()) messages.value.splice(index, 1)
    else if (index >= 0) messages.value[index]!.streaming = false
    if (localUser && localUser.id < 0) messages.value = messages.value.filter(message => message !== localUser)
    runPhase.value = 'error'
    const message = error instanceof Error ? error.message : '请稍后重试'
    if (refundNotice.point > 0) alertStore.info(`AI 执行失败，已返还 ${refundNotice.point.toLocaleString('zh-CN')} 积分`, refundNotice.balance === null ? '本次 Prompt 不计费' : `当前积分：${refundNotice.balance.toLocaleString('zh-CN')}`)
    alertStore.error(message.includes('积分') ? 'Prompt 未发送' : 'Agent Session 失败', message)
  } finally { sending.value = false; await scrollRunToBottom() }
}

function composerKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void runAgent() }
}

function applyTaskTemplate(content: string) { composer.value = content }
function chooseAnswer(content: string) { checkpointAnswer.value = content }
function useSuggestion(content: string) { void runAgent(content) }

function downloadArtifact(artifact?: AgentArtifact) {
  if (!artifact) return
  const blob = new Blob([artifact.content], {type: 'image/svg+xml;charset=utf-8'})
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${artifact.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'agent-artifact'}.svg`
  anchor.click()
  URL.revokeObjectURL(url)
}

function svgCanvasSize(content: string): {width: number; height: number} {
  const fallback = {width: 1200, height: 800}
  try {
    const root = new DOMParser().parseFromString(content, 'image/svg+xml').documentElement
    const viewBox = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number)
    const viewBoxWidth = viewBox[2] ?? 0
    const viewBoxHeight = viewBox[3] ?? 0
    if (viewBox.length === 4 && viewBoxWidth > 0 && viewBoxHeight > 0) return {width: viewBoxWidth, height: viewBoxHeight}
    const parseLength = (value: string | null) => {
      const parsed = Number.parseFloat(value || '')
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    }
    const width = parseLength(root.getAttribute('width'))
    const height = parseLength(root.getAttribute('height'))
    if (width && height) return {width, height}
  } catch {}
  return fallback
}

async function downloadArtifactPng(artifact?: AgentArtifact) {
  if (!artifact) return
  const sourceUrl = URL.createObjectURL(new Blob([artifact.content], {type: 'image/svg+xml;charset=utf-8'}))
  try {
    const image = new Image()
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('SVG 无法转换为 PNG'))
    })
    image.src = sourceUrl
    await loaded
    const sourceSize = svgCanvasSize(artifact.content)
    const scale = Math.min(2, 4096 / Math.max(sourceSize.width, sourceSize.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sourceSize.width * scale))
    canvas.height = Math.max(1, Math.round(sourceSize.height * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('浏览器不支持图片导出')
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const png = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
    if (!png) throw new Error('PNG 导出失败')
    const downloadUrl = URL.createObjectURL(png)
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = `${artifact.title.replace(/[\\/:*?"<>|]+/g, '-').slice(0, 80) || 'agent-artifact'}.png`
    anchor.click()
    URL.revokeObjectURL(downloadUrl)
  } catch (error) {
    alertStore.error('导出 PNG 失败', error instanceof Error ? error.message : '请稍后重试')
  } finally {
    URL.revokeObjectURL(sourceUrl)
  }
}

function openPublish() {
  const conversation = activeConversation.value
  if (!conversation || !canPublish.value) return
  publishAnonymous.value = conversation.anonymous
  publishOpen.value = true
}

async function publishConversation() {
  const conversation = activeConversation.value
  if (!conversation) return
  publishLoading.value = true
  try {
    const result = await publishAgentConversation(conversation.id, {anonymous: publishAnonymous.value})
    replaceConversation(result.conversation)
    publishOnRun.value = true
    publishOpen.value = false
    alertStore.success('已设为公开', '工具调用、提问、产物和结果将实时同步')
  } catch (error) { alertStore.error('发布失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { publishLoading.value = false }
}

function unpublishConversation() {
  const conversation = activeConversation.value
  if (!conversation) return
  confirmTarget.value = null
  confirmAction.value = 'unpublish'
  confirmError.value = ''
}

async function confirmUnpublishConversation() {
  const conversation = activeConversation.value
  if (!conversation || confirmLoading.value) return
  confirmLoading.value = true
  confirmError.value = ''
  try { replaceConversation((await unpublishAgentConversation(conversation.id)).conversation); publishOnRun.value = false; confirmAction.value = null; alertStore.success('已设为私密') }
  catch (error) { confirmError.value = error instanceof Error ? error.message : '请稍后重试' }
  finally { confirmLoading.value = false }
}

function stopPublicStream() {
  publicStreamController?.abort()
  publicStreamController = null
}

function openWorkspace() { stopPublicStream(); view.value = 'workspace' }
function closePublicConversation() { stopPublicStream(); publicConversation.value = null; publicMessages.value = []; publicLiveArtifacts.value = []; publicLiveSuggestions.value = [] }

async function openLobby() {
  stopPublicStream()
  view.value = 'lobby'
  publicConversation.value = null
  publicMessages.value = []
  await loadLobby(1)
}

async function loadLobby(page = lobbyPage.value) {
  lobbyLoading.value = true
  try {
    const result = await listAgentLobby(page, lobbyKeyword.value)
    lobbyItems.value = result.conversations
    lobbyPage.value = result.pagination.page
    lobbyTotalPages.value = result.pagination.total_pages
  } catch (error) { alertStore.error('读取公开 Runs 失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { lobbyLoading.value = false }
}

function upsertPublicTool(event: Record<string, any>, completed: boolean) {
  const toolCallId = String(event.tool_call_id || '')
  const runId = String(event.run_id || '')
  const index = publicMessages.value.findIndex(message => message.role === 'tool' && message.metadata.tool_call_id === toolCallId)
  if (completed && event.message) {
    if (index >= 0) publicMessages.value.splice(index, 1, event.message)
    else {
      const draftIndex = publicMessages.value.findIndex(message => message.role === 'assistant' && message.streaming && (!runId || message.metadata.run_id === runId))
      publicMessages.value.splice(draftIndex >= 0 ? draftIndex : publicMessages.value.length, 0, event.message)
    }
    return
  }
  if (index >= 0) {
    const message = publicMessages.value[index]!
    message.metadata = {
      ...message.metadata,
      tool_name: event.tool_name || message.metadata.tool_name,
      tool_summary: String(event.summary || message.metadata.tool_summary || '工具正在运行'),
      tool_status: 'running',
      ...(Object.prototype.hasOwnProperty.call(event, 'input') ? {tool_input: event.input || {}} : {}),
      ...(event.progress ? {tool_progress: event.progress} : {}),
    }
    message.streaming = true
    return
  }
  if (!publicConversation.value) return
  const toolMessage: AgentMessage = {id: -Date.now(), conversation_id: publicConversation.value.id, role: 'tool', content: '', metadata: {
    run_id: runId, workflow_stage: 'tool', workflow_status: 'running', tool_call_id: toolCallId, tool_name: event.tool_name,
    tool_summary: String(event.summary || `${event.label || event.tool_name || '工具'}正在运行`),
    tool_status: 'running', tool_input: event.input || {}, ...(event.progress ? {tool_progress: event.progress} : {}),
  }, created_at: new Date().toISOString(), streaming: true}
  const draftIndex = publicMessages.value.findIndex(message => message.role === 'assistant' && message.streaming && (!runId || message.metadata.run_id === runId))
  publicMessages.value.splice(draftIndex >= 0 ? draftIndex : publicMessages.value.length, 0, toolMessage)
}

function cancelPublicTool(event: Record<string, any>) {
  const toolCallId = String(event.tool_call_id || '')
  publicMessages.value = publicMessages.value.filter(message => !(message.role === 'tool' && message.streaming && message.metadata.tool_call_id === toolCallId))
}

function ensurePublicDraft(runId: string) {
  let draft = publicMessages.value.find(message => message.metadata.run_id === runId && message.streaming)
  if (draft || !publicConversation.value) return draft
  draft = {id: -Date.now() - publicMessages.value.length, conversation_id: publicConversation.value.id, role: 'assistant', content: '', metadata: {run_id: runId, workflow_stage: 'output'}, created_at: new Date().toISOString(), streaming: true}
  publicMessages.value.push(draft)
  return publicMessages.value[publicMessages.value.length - 1]
}

function restorePublicActiveRun(snapshot: AgentActiveRun) {
  publicRunActive.value = true
  const draft = ensurePublicDraft(snapshot.run_id)
  if (draft) {
    draft.content = snapshot.output || ''
    draft.created_at = snapshot.updated_at
    draft.metadata = {
      ...draft.metadata,
      thinking_summary: snapshot.thinking_summary || snapshot.summary,
      thinking_streaming: snapshot.phase === 'thinking',
    }
  }
  if (snapshot.phase === 'tool' && snapshot.tool_call_id) {
    upsertPublicTool({
      run_id: snapshot.run_id,
      tool_call_id: snapshot.tool_call_id,
      tool_name: snapshot.tool_name,
      label: snapshot.label,
      input: snapshot.input,
      summary: snapshot.summary,
      progress: snapshot.progress,
    }, false)
  }
}

async function openPublicConversation(slug: string) {
  stopPublicStream()
  publicLoading.value = true
  try {
    const result = await getPublicAgentConversation(slug)
    publicConversation.value = result.conversation
    publicMessages.value = result.messages
    publicLiveArtifacts.value = []
    publicLiveSuggestions.value = []
    if (result.active_run) restorePublicActiveRun(result.active_run)
    else publicRunActive.value = false
    await scrollPublicToBottom()
    const controller = new AbortController()
    publicStreamController = controller
    void streamPublicAgentConversation(slug, () => authStore.resourceToken, () => authStore.refreshAccessToken(), event => {
      if (event.event === 'conversation.updated' && event.data.conversation) publicConversation.value = event.data.conversation
      if (event.event === 'conversation.unavailable') { alertStore.warning('公开 Run 已关闭'); closePublicConversation(); return }
      if (event.event === 'message.appended' && event.data.message && !publicMessages.value.some(message => message.id === event.data.message.id)) publicMessages.value.push(event.data.message)
      const runId = String(event.data.run_id || '')
      if (event.event === 'workflow.started') {
        publicRunActive.value = true
        publicLiveSuggestions.value = []
      }
      if (event.event === 'thinking.started' && runId) {
        const draft = ensurePublicDraft(runId)
        if (draft) draft.metadata = {...draft.metadata, thinking_summary: '', thinking_streaming: true}
      }
      if (event.event === 'thinking.delta' && runId) {
        const draft = ensurePublicDraft(runId)
        if (draft) draft.metadata = {...draft.metadata, thinking_summary: event.data.replay ? String(event.data.content || '') : `${metadataString(draft, 'thinking_summary')}${String(event.data.content || '')}`, thinking_streaming: true}
      }
      if (event.event === 'thinking.completed' && runId) {
        const draft = ensurePublicDraft(runId)
        if (draft) draft.metadata = {...draft.metadata, thinking_summary: String(event.data.content || metadataString(draft, 'thinking_summary')), thinking_streaming: false}
      }
      if (event.event === 'run.progress' && runId) {
        const draft = ensurePublicDraft(runId)
        if (draft) draft.metadata = {...draft.metadata, thinking_summary: String(event.data.summary || metadataString(draft, 'thinking_summary')), thinking_streaming: false}
      }
      if (event.event === 'tool.delta') upsertPublicTool(event.data, false)
      if (event.event === 'tool.started') upsertPublicTool(event.data, false)
      if (event.event === 'tool.progress') upsertPublicTool(event.data, false)
      if (event.event === 'tool.cancelled') cancelPublicTool(event.data)
      if (event.event === 'tool.completed') {
        upsertPublicTool(event.data, true)
        const toolSuggestions = suggestionsFromToolMessage(event.data.message)
        if (toolSuggestions.length) publicLiveSuggestions.value = toolSuggestions
      }
      if (event.event === 'artifact.created' && event.data.artifact) publicLiveArtifacts.value = [...publicLiveArtifacts.value.filter(item => item.id !== event.data.artifact.id), event.data.artifact]
      if (event.event === 'suggestions.ready') {
        const nextSuggestions = filterSuggestions(event.data.suggestions)
        if (nextSuggestions.length) publicLiveSuggestions.value = nextSuggestions
      }
      if (event.event === 'input.required' && event.data.message) {
        const draftIndex = publicMessages.value.findIndex(message => message.metadata.run_id === runId && message.streaming)
        if (draftIndex >= 0) publicMessages.value.splice(draftIndex, 1, event.data.message)
        else publicMessages.value.push(event.data.message)
      }
      if (event.event === 'message.delta' && runId) {
        const draft = ensurePublicDraft(runId)
        if (draft) draft.content = event.data.replay ? String(event.data.content || '') : draft.content + String(event.data.content || '')
      }
      if (event.event === 'message.completed' && event.data.message) {
        const draftIndex = publicMessages.value.findIndex(message => message.metadata.run_id === runId && message.streaming)
        if (draftIndex >= 0) publicMessages.value.splice(draftIndex, 1, event.data.message)
        else if (!publicMessages.value.some(message => message.id === event.data.message.id)) publicMessages.value.push(event.data.message)
        publicRunActive.value = false
      }
      if (event.event === 'run.error' && event.data.error_message) {
        const draftIndex = publicMessages.value.findIndex(message => message.metadata.run_id === runId && message.streaming)
        if (draftIndex >= 0) publicMessages.value.splice(draftIndex, 1, event.data.error_message)
        else publicMessages.value.push(event.data.error_message)
        publicRunActive.value = false
      }
      void scrollPublicToBottom()
    }, controller.signal).catch(error => {
      if (!controller.signal.aborted) alertStore.warning('实时同步已断开', error instanceof Error ? error.message : '请重新打开 Run')
    })
  } catch (error) { alertStore.error('读取公开 Run 失败', error instanceof Error ? error.message : '请稍后重试') }
  finally { publicLoading.value = false }
}

onMounted(() => {
  questionTimer = setInterval(() => { questionClock.value = Date.now() }, 1_000)
  void loadAvailableTools()
  void loadConversations(undefined, 1, true)
})
onBeforeUnmount(() => {
  stopPublicStream()
  stopRunRecovery()
  if (questionTimer) clearInterval(questionTimer)
  questionTimer = null
})
</script>

<template>
  <section class="agent-page">
    <header class="agent-topbar">
      <div class="agent-brand"><span>AI</span><div><strong>邦溪 Agent</strong><small>PROMPTS / TOOLS / OUTPUTS</small></div></div>
      <nav aria-label="Agent 页面视图"><button :class="{active: view === 'workspace'}" type="button" @click="openWorkspace">{{ isAdmin ? '全部 Sessions' : '我的 Sessions' }}</button><button :class="{active: view === 'lobby'}" type="button" @click="openLobby">公开 Sessions</button></nav>
      <button :disabled="sending || recoveringRun" class="new-run" type="button" @click="createConversation()">＋ 新建 Session</button>
    </header>

    <div v-if="view === 'workspace'" class="agent-workspace">
      <aside class="run-sidebar">
        <header><strong>{{ isAdmin ? '全部 Agent Sessions' : 'Agent Sessions' }}</strong><span>{{ conversationsTotal }}</span></header>
        <div class="run-list">
          <p v-if="conversationsLoading" class="side-state">正在读取...</p>
          <button v-for="conversation in conversations" v-else :key="conversation.id" :class="{active: activeConversation?.id === conversation.id}" :disabled="sending || recoveringRun" type="button" @click="selectConversation(conversation.id)">
            <span class="run-state" :class="conversation.workflow_status"/><span><strong>{{ conversation.title }}</strong><small>{{ sessionMeta(conversation) }} · {{ preview(conversation.last_message) }}</small></span><time>{{ formatDate(conversation.updated_at) }}</time>
          </button>
        </div>
        <footer v-if="conversationsTotalPages > 1" class="session-pagination"><button :disabled="conversationsPage <= 1 || conversationsLoading" type="button" @click="loadConversationPage(conversationsPage - 1)">上一页</button><span>{{ conversationsPage }} / {{ conversationsTotalPages }}</span><button :disabled="conversationsPage >= conversationsTotalPages || conversationsLoading" type="button" @click="loadConversationPage(conversationsPage + 1)">下一页</button></footer>
      </aside>

      <main class="agent-console">
        <header class="console-header">
           <div><strong>{{ activeConversation?.title || 'Agent Session' }}</strong><small v-if="activeConversation"><span :class="activeConversation.visibility">{{ activeConversation.visibility === 'public' ? '实时公开' : '私密' }}</span><b v-if="isAdmin">{{ activeConversation.owner_username || '匿名玩家' }}</b><b>{{ workflowStatus(activeConversation) }}</b></small></div>
           <div v-if="activeConversation" class="console-actions"><button :disabled="sending || recoveringRun" type="button" @click="openRenameConversation">重命名</button><button v-if="activeConversation.visibility === 'public'" :disabled="sending || recoveringRun" type="button" @click="unpublishConversation">设为私密</button><button :disabled="!canPublish" class="primary" type="button" @click="openPublish">{{ activeConversation.visibility === 'public' ? '公开设置' : '设为公开' }}</button><button :disabled="sending || recoveringRun" class="danger" type="button" @click="removeConversation">删除</button></div>
        </header>

        <div ref="runViewport" class="console-viewport" :class="{'has-session': activeConversation && taskMessage, 'new-session': activeConversation && !taskMessage}">
          <div v-if="messagesLoading" class="agent-empty"><span class="loader"><i/><i/><i/></span><strong>正在读取 Agent Session</strong></div>
          <form v-else-if="!taskMessage" class="run-builder" @submit.prevent="runAgent()">
            <div class="run-builder-scroll">
              <header><span>NEW AGENT SESSION</span><h1>交给 Agent 一个目标</h1></header>
              <details class="tool-catalog" open>
                <summary><span><strong>AI 可调用工具</strong><small>Agent 会按任务需要自行选择和组合调用</small></span><b>{{ availableTools.length || '...' }} TOOLS</b></summary>
                <p v-if="availableToolsLoading" class="tool-catalog-state">正在读取工具目录...</p>
                <p v-else-if="availableToolsError" class="tool-catalog-state error">工具目录暂不可用：{{ availableToolsError }}<button type="button" @click="loadAvailableTools">重试</button></p>
                <div v-else class="tool-catalog-grid"><article v-for="tool in availableTools" :key="tool.name"><header><strong>{{ toolLabels[tool.name] || tool.name }}</strong><code>{{ tool.name }}</code></header><p>{{ tool.description }}</p><footer><span v-if="!tool.inputs.length">无需参数</span><span v-for="input in tool.inputs" :key="input.name" :title="input.description"><b>{{ input.name }}</b><i v-if="input.required">必填</i></span></footer></article></div>
              </details>
            </div>
            <div class="run-builder-composer">
              <label><span>Prompt</span><textarea v-model="composer" :disabled="sending || recoveringRun" maxlength="8000" placeholder="描述目标、约束和期望产物" rows="3" @keydown="composerKeydown"/></label>
              <div class="task-templates"><button :disabled="sending || recoveringRun" type="button" @click="applyTaskTemplate('查询当前服务器状态和在线玩家，并生成一张 SVG 状态看板')">服务器状态看板</button><button :disabled="sending || recoveringRun" type="button" @click="applyTaskTemplate('检索最近与建筑相关的公开聊天，整理成项目线索并给出下一步建议')">建筑线索整理</button><button :disabled="sending || recoveringRun" type="button" @click="applyTaskTemplate('调查刚刚服务器公开聊天中为什么有人吵架：先读取当前真实时间，再按时间升序检索近期公开聊天，对关键消息读取上下文；给出时间线、参与者、触发点、升级过程、引用证据和不确定性。')">最近争执调查</button><button :disabled="sending || recoveringRun" type="button" @click="applyTaskTemplate('读取商店索引，先询问我关注的商店，再分析该商店最新快照')">商店分析</button></div>
              <div class="run-options"><BaseCheckbox v-model="publishOnRun" :label="publishOnRun ? '公开运行并实时同步' : '私密运行'"/><BaseCheckbox v-if="publishOnRun" v-model="publishAnonymous" label="匿名公开"/></div>
              <footer><span>{{ composer.length }}/8000 · 每次 Prompt 消耗 {{ AGENT_PROMPT_POINT_COST }} 积分</span><button :disabled="!composer.trim() || sending || recoveringRun" type="submit"><span>▶</span>{{ sending || recoveringRun ? '启动中' : `运行 Agent · ${AGENT_PROMPT_POINT_COST} 积分` }}</button></footer>
            </div>
          </form>

          <div v-else-if="activeConversation && taskMessage" class="session-layout">
            <section class="run-main session-run-main">
              <div class="session-scroll">
                <header class="session-header"><div><span>AGENT SESSION CONSOLE</span><strong>{{ workflowStatus(activeConversation) }}</strong></div><time>{{ formatDate(taskMessage.created_at) }}</time></header>
                <details class="tool-catalog" open>
                  <summary><span><strong>AI 可调用工具</strong><small>Agent 会按任务需要自行选择和组合调用</small></span><b>{{ availableTools.length || '...' }} TOOLS</b></summary>
                  <p v-if="availableToolsLoading" class="tool-catalog-state">正在读取工具目录...</p>
                  <p v-else-if="availableToolsError" class="tool-catalog-state error">工具目录暂不可用：{{ availableToolsError }}<button type="button" @click="loadAvailableTools">重试</button></p>
                  <div v-else class="tool-catalog-grid"><article v-for="tool in availableTools" :key="tool.name"><header><strong>{{ toolLabels[tool.name] || tool.name }}</strong><code>{{ tool.name }}</code></header><p>{{ tool.description }}</p><footer><span v-if="!tool.inputs.length">无需参数</span><span v-for="input in tool.inputs" :key="input.name" :title="input.description"><b>{{ input.name }}</b><i v-if="input.required">必填</i></span></footer></article></div>
                </details>
                <section class="prompt-brief"><header><span>PLAYER PROMPT</span><div><small>{{ authStore.user?.username || '玩家' }}</small><button :disabled="sending || recoveringRun" class="withdraw" title="撤回此 Prompt 及其后续上下文" type="button" @click="withdrawPrompt(taskMessage)">撤回</button></div></header><AgentMarkdown :content="taskMessage.content"/></section>
                <section v-if="thinkingText || sending || recoveringRun" class="agent-intent" :class="{active: sending || recoveringRun}"><header><span>AGENT INTENT</span><b><i v-if="sending || recoveringRun"/>{{ runPhase === 'planning' ? 'STREAMING' : runPhase === 'running' ? 'LIVE' : 'UPDATED' }}</b></header><AgentMarkdown :content="thinkingText || '正在准备查询与交付'" :streaming="latestThinkingMessage?.metadata.thinking_streaming === true"/></section>
                <div class="session-log">
                  <article v-for="message in activityMessages" :key="message.id" class="session-entry" :class="messageKind(message)">
                    <header><div><span>{{ messageKind(message) === 'tool' ? 'TOOL CALL' : messageKind(message) === 'question' ? 'INPUT REQUIRED' : messageKind(message) === 'response' ? 'PLAYER PROMPT' : messageKind(message) === 'error' ? 'ERROR' : 'RESULT' }}</span><strong>{{ messageTitle(message) }}</strong></div><div><small>{{ messageKind(message) === 'tool' ? metadataString(message, 'tool_name') : formatDate(message.created_at) }}</small><button v-if="messageKind(message) === 'response'" :disabled="sending || recoveringRun" class="withdraw" title="撤回此 Prompt 及其后续上下文" type="button" @click.stop="withdrawPrompt(message)">撤回</button><b>{{ messageStatus(message) }}</b></div></header>
                    <div class="entry-content">
                      <template v-if="messageKind(message) === 'tool'"><div v-if="message.streaming" class="execution-meter" :class="{indeterminate: !toolProgress(message)?.total}"><header><span>{{ toolProgressLabel(message) }}</span><b v-if="toolProgress(message)?.total">{{ toolProgressPercent(message) }}%</b><b v-else>LIVE</b></header><i><b :style="toolProgress(message)?.total ? {width: `${toolProgressPercent(message)}%`} : undefined"/></i></div><AgentMarkdown :content="metadataString(message, 'tool_summary') || '工具调用完成'"/><div v-if="message.metadata.tool_status === 'error'" class="tool-failure"><strong>工具暂未返回完整结果</strong><p>{{ metadataString(message, 'tool_summary') || '本次调查没有返回有效结果。' }}</p><small>已保留本次真实查询参数，Agent 会继续使用可用证据整理结果。</small></div><div class="backend-io"><section><span>BACKEND QUERY</span><pre>{{ toolInput(message) }}</pre></section><section><span>BACKEND RESPONSE</span><pre>{{ toolResult(message) || (message.streaming ? '等待工具返回...' : '无返回内容') }}</pre></section></div><section v-if="inlineArtifacts.has(message.id)" class="inline-visual"><header><div><span>VISUAL OUTPUT</span><strong>按需生成</strong></div><button title="下载 SVG" type="button" @click="downloadArtifact(inlineArtifacts.get(message.id))">↓ SVG</button><button title="下载 PNG" type="button" @click="void downloadArtifactPng(inlineArtifacts.get(message.id))">↓ PNG</button></header><figure><figcaption><strong>{{ inlineArtifacts.get(message.id)?.title }}</strong><small>{{ inlineArtifacts.get(message.id)?.caption || 'SVG OUTPUT' }}</small></figcaption><img :alt="inlineArtifacts.get(message.id)?.title" :src="svgUrl(inlineArtifacts.get(message.id))"></figure></section></template>
                       <template v-else-if="messageKind(message) === 'question'"><AgentMarkdown :content="questionFromMessage(message)?.prompt || message.content"/><div v-if="pendingQuestionMessage?.id === message.id" class="checkpoint"><small class="question-deadline">{{ questionRemaining(pendingQuestion) }} · 回复消耗 {{ AGENT_PROMPT_POINT_COST }} 积分</small><div v-if="pendingQuestion?.options.length" class="answer-options"><button v-for="option in pendingQuestion.options" :key="option" :class="{active: checkpointAnswer === option}" :disabled="sending || recoveringRun" type="button" @click="chooseAnswer(option)">{{ option }}</button></div><textarea v-if="pendingQuestion?.allow_free_text" v-model="checkpointAnswer" :disabled="sending || recoveringRun" placeholder="回复 Agent" rows="3"/><button :disabled="!checkpointAnswer.trim() || sending || recoveringRun" class="resume" type="button" @click="runAgent(checkpointAnswer)">{{ sending || recoveringRun ? '继续中' : `继续 Session · ${AGENT_PROMPT_POINT_COST} 积分` }}</button></div></template>
                      <template v-else>
                         <section v-if="playerProfiles.get(message.id)" class="player-report-profile"><header><span v-if="avatarFailed(playerProfiles.get(message.id)!.username)" class="profile-avatar-fallback">{{ avatarInitial(playerProfiles.get(message.id)!.username) }}</span><img v-else :alt="`${playerProfiles.get(message.id)?.username} 的头像`" :src="playerProfiles.get(message.id)?.avatar_url" loading="lazy" @error="markAvatarFailed(playerProfiles.get(message.id)!.username)"><div><span>PLAYER PROFILE</span><strong>{{ playerProfiles.get(message.id)?.username }}</strong><small>{{ playerProfiles.get(message.id)?.premium === true ? '正版账号' : playerProfiles.get(message.id)?.premium === false ? '第三方皮肤档案' : '正版状态待核验' }}</small></div><b v-if="playerProfiles.get(message.id)?.premium">PREMIUM</b></header><iframe v-if="playerProfiles.get(message.id)?.premium" :srcdoc="playerProfileDocument(playerProfiles.get(message.id))" :title="`${playerProfiles.get(message.id)?.username} 的正版 Minecraft 档案`" loading="lazy" sandbox="allow-popups"/></section>
                        <div v-if="message.streaming" class="generation-state"><span><i/><i/><i/></span><strong>{{ message.content ? '正在生成正文' : '等待模型输出' }}</strong><small>{{ message.content.length }} 字符</small></div>
                        <AgentMarkdown :content="displayMessageContent(message)" :streaming="message.streaming && Boolean(message.content)" @open-message-context="openMessageContext"/>
                        <section v-if="citationsFromMessage(message).length" class="message-evidence"><header><div><span>EVIDENCE</span><strong>引用证据</strong></div><small>{{ citationsFromMessage(message).length }} 条消息</small></header><div class="evidence-list"><button v-for="citation in citationsFromMessage(message)" :key="citation.message_id" type="button" @click="openMessageContext(citation.message_id)"><span><b>#{{ citation.message_id }}</b><strong>{{ citation.username || '未知玩家' }}</strong><time>{{ formatDate(citation.create_time) }}</time></span><p>{{ messageContent(citation.content) || '（空消息）' }}</p></button></div></section>
                      </template>
                    </div>
                  </article>
                </div>
                <div v-if="suggestions.length && runPhase === 'completed'" class="next-actions"><header><strong>下一步</strong><span>执行建议将消耗 {{ AGENT_PROMPT_POINT_COST }} 积分</span></header><button v-for="suggestion in suggestions" :key="suggestion" type="button" @click="useSuggestion(suggestion)"><span>↗</span>{{ suggestion }}</button></div>
              </div>
              <footer v-if="pendingQuestion" class="run-footer"><span>等待玩家输入后继续执行</span></footer>
              <form v-else class="run-continuation" @submit.prevent="runAgent()"><header><div><strong>追加 Prompt</strong><span>SESSION CONTEXT</span></div><b>{{ sending || recoveringRun ? '执行中' : `每次 ${AGENT_PROMPT_POINT_COST} 积分` }}</b></header><textarea v-model="composer" :disabled="sending || recoveringRun" maxlength="8000" placeholder="向当前 Session 追加任务指令" rows="3" @keydown="composerKeydown"/><footer><span>{{ composer.length }}/8000 · 每次提交扣除 {{ AGENT_PROMPT_POINT_COST }} 积分</span><button :disabled="!composer.trim() || sending || recoveringRun" type="submit">{{ sending || recoveringRun ? '执行中' : `执行 Prompt · ${AGENT_PROMPT_POINT_COST} 积分` }}</button></footer></form>
            </section>

          </div>
        </div>
      </main>
    </div>

    <main v-else class="lobby-panel">
      <template v-if="publicConversation">
        <header class="public-header"><button type="button" @click="closePublicConversation">← 返回</button><div><strong>{{ publicConversation.title }}</strong><small>{{ publicConversation.owner_username || '匿名玩家' }} · 实时同步 · 只读不可复制 · {{ publicConversation.view_count }} 浏览</small></div><span class="live"><i/> LIVE</span></header>
        <div ref="publicViewport" class="public-viewport" @copy.prevent>
          <div class="session-layout public-run"><section class="run-main"><header class="session-header"><div><span>PUBLIC SESSION CONSOLE</span><strong>{{ statusLabel(publicConversation.workflow_status) }}</strong></div></header>
            <section v-if="publicTask" class="prompt-brief"><header><span>PLAYER PROMPT</span><small>{{ publicConversation.owner_username || '匿名玩家' }}</small></header><AgentMarkdown :content="publicTask.content"/></section>
            <section v-if="publicThinkingText" class="agent-intent" :class="{active: publicRunActive}"><header><span>AGENT INTENT</span><b><i v-if="publicRunActive"/>LIVE</b></header><AgentMarkdown :content="publicThinkingText" :streaming="publicLatestThinking?.metadata.thinking_streaming === true"/></section>
            <div class="session-log">
              <article v-for="message in publicActivityMessages" :key="message.id" class="session-entry" :class="messageKind(message)">
                <header><div><span>{{ messageKind(message) === 'tool' ? 'TOOL CALL' : messageKind(message) === 'question' ? 'INPUT REQUIRED' : messageKind(message) === 'response' ? 'PLAYER PROMPT' : messageKind(message) === 'error' ? 'ERROR' : 'RESULT' }}</span><strong>{{ messageTitle(message) }}</strong></div><div><small>{{ messageKind(message) === 'tool' ? metadataString(message, 'tool_name') : formatDate(message.created_at) }}</small><b>{{ messageStatus(message) }}</b></div></header>
                <div class="entry-content">
                  <template v-if="messageKind(message) === 'tool'">
                    <div v-if="message.streaming" class="execution-meter" :class="{indeterminate: !toolProgress(message)?.total}"><header><span>{{ toolProgressLabel(message) }}</span><b v-if="toolProgress(message)?.total">{{ toolProgressPercent(message) }}%</b><b v-else>LIVE</b></header><i><b :style="toolProgress(message)?.total ? {width: `${toolProgressPercent(message)}%`} : undefined"/></i></div>
                    <AgentMarkdown :content="metadataString(message, 'tool_summary') || '工具调用完成'"/><div v-if="message.metadata.tool_status === 'error'" class="tool-failure"><strong>工具暂未返回完整结果</strong><p>{{ metadataString(message, 'tool_summary') || '本次调查没有返回有效结果。' }}</p><small>已保留本次真实查询参数，Agent 会继续使用可用证据整理结果。</small></div>
                    <div class="backend-io"><section><span>BACKEND QUERY</span><pre>{{ toolInput(message) }}</pre></section><section><span>BACKEND RESPONSE</span><pre>{{ toolResult(message) || (message.streaming ? '等待工具返回...' : '无返回内容') }}</pre></section></div>
                    <section v-if="publicInlineArtifacts.has(message.id)" class="inline-visual"><header><div><span>VISUAL OUTPUT</span><strong>按需生成</strong></div></header><figure><figcaption><strong>{{ publicInlineArtifacts.get(message.id)?.title }}</strong><small>{{ publicInlineArtifacts.get(message.id)?.caption || 'SVG OUTPUT' }}</small></figcaption><img :alt="publicInlineArtifacts.get(message.id)?.title" :src="svgUrl(publicInlineArtifacts.get(message.id))"></figure></section>
                  </template>
                   <template v-else-if="messageKind(message) === 'question'"><AgentMarkdown :content="questionFromMessage(message)?.prompt || message.content"/><div v-if="publicPendingQuestionMessage?.id === message.id" class="readonly-options"><small class="question-deadline">{{ questionRemaining(questionFromMessage(message)) }}</small><span v-for="option in questionFromMessage(message)?.options || []" :key="option">{{ option }}</span></div></template>
                  <template v-else>
                     <section v-if="publicPlayerProfiles.get(message.id)" class="player-report-profile"><header><span v-if="avatarFailed(publicPlayerProfiles.get(message.id)!.username)" class="profile-avatar-fallback">{{ avatarInitial(publicPlayerProfiles.get(message.id)!.username) }}</span><img v-else :alt="`${publicPlayerProfiles.get(message.id)?.username} 的头像`" :src="publicPlayerProfiles.get(message.id)?.avatar_url" loading="lazy" @error="markAvatarFailed(publicPlayerProfiles.get(message.id)!.username)"><div><span>PLAYER PROFILE</span><strong>{{ publicPlayerProfiles.get(message.id)?.username }}</strong><small>{{ publicPlayerProfiles.get(message.id)?.premium === true ? '正版账号' : publicPlayerProfiles.get(message.id)?.premium === false ? '第三方皮肤档案' : '正版状态待核验' }}</small></div><b v-if="publicPlayerProfiles.get(message.id)?.premium">PREMIUM</b></header><iframe v-if="publicPlayerProfiles.get(message.id)?.premium" :srcdoc="playerProfileDocument(publicPlayerProfiles.get(message.id))" :title="`${publicPlayerProfiles.get(message.id)?.username} 的正版 Minecraft 档案`" loading="lazy" sandbox="allow-popups"/></section>
                    <div v-if="message.streaming" class="generation-state"><span><i/><i/><i/></span><strong>{{ message.content ? '正在生成正文' : '等待模型输出' }}</strong><small>{{ message.content.length }} 字符</small></div>
                    <AgentMarkdown :content="displayMessageContent(message)" :streaming="message.streaming && Boolean(message.content)" @open-message-context="openMessageContext"/>
                    <section v-if="citationsFromMessage(message).length" class="message-evidence"><header><div><span>EVIDENCE</span><strong>引用证据</strong></div><small>{{ citationsFromMessage(message).length }} 条消息</small></header><div class="evidence-list"><button v-for="citation in citationsFromMessage(message)" :key="citation.message_id" type="button" @click="openMessageContext(citation.message_id)"><span><b>#{{ citation.message_id }}</b><strong>{{ citation.username || '未知玩家' }}</strong><time>{{ formatDate(citation.create_time) }}</time></span><p>{{ messageContent(citation.content) || '（空消息）' }}</p></button></div></section>
                  </template>
                </div>
              </article>
            </div>
            <div v-if="publicSuggestions.length" class="next-actions readonly"><header><strong>下一步建议</strong></header><span v-for="suggestion in publicSuggestions" :key="suggestion">{{ suggestion }}</span></div></section>
          </div>
        </div>
      </template>
      <template v-else><header class="lobby-header"><div><strong>公开 Agent Sessions</strong><small>实时查询日志与按需输出</small></div><form @submit.prevent="loadLobby(1)"><input v-model="lobbyKeyword" placeholder="搜索标题或发布者"><button type="submit">搜索</button></form></header><div v-if="lobbyLoading || publicLoading" class="agent-empty"><span class="loader"><i/><i/><i/></span><strong>正在读取公开 Sessions</strong></div><div v-else-if="!lobbyItems.length" class="agent-empty"><span class="empty-code">NO PUBLIC SESSIONS</span><strong>暂无匹配的公开 Session</strong></div><div v-else class="lobby-grid"><button v-for="conversation in lobbyItems" :key="conversation.id" type="button" @click="conversation.public_slug && openPublicConversation(conversation.public_slug)"><header><span>{{ conversation.owner_username?.slice(0, 1).toUpperCase() || '匿' }}</span><div><strong>{{ conversation.owner_username || '匿名玩家' }}</strong><small>{{ formatDate(conversation.updated_at) }}</small></div><b>{{ statusLabel(conversation.workflow_status) }}</b></header><h2>{{ conversation.title }}</h2><p>{{ preview(conversation.last_message) }}</p><footer><span>PROMPTS + TOOLS</span><span>{{ conversation.view_count }} 浏览</span><b>实时 · 只读</b></footer></button></div><footer v-if="lobbyTotalPages > 1" class="pagination"><button :disabled="lobbyPage <= 1" @click="loadLobby(lobbyPage - 1)">上一页</button><span>{{ lobbyPage }} / {{ lobbyTotalPages }}</span><button :disabled="lobbyPage >= lobbyTotalPages" @click="loadLobby(lobbyPage + 1)">下一页</button></footer></template>
    </main>

    <BaseDialog :open="publishOpen" :title="activeConversation?.visibility === 'public' ? '公开设置' : '发布 Agent Session'" @close="publishOpen = false"><div class="publish-dialog"><div class="publish-preview"><span>实时公开</span><strong>Session 与大厅持续同步</strong><p>Prompt、工具查询、玩家输入、按需视觉输出和最终结果都会公开。</p></div><BaseCheckbox v-model="publishAnonymous" label="匿名发布，不显示用户名"/><p class="publish-warning">公开 Session 只读且不提供复制或派生入口。请勿提交密码、Token 或其他敏感信息。</p><div class="publish-actions"><button type="button" @click="publishOpen = false">取消</button><button :disabled="publishLoading" class="primary" type="button" @click="publishConversation">{{ publishLoading ? '发布中' : '确认发布' }}</button></div></div></BaseDialog>
    <BaseDialog :open="renameOpen" title="重命名 Agent Session" @close="renameOpen = false"><form class="agent-dialog" @submit.prevent="renameConversation"><label><span>Session 名称</span><input v-model="renameTitle" :disabled="renameLoading" maxlength="120" autofocus></label><p v-if="renameError" class="dialog-error">{{ renameError }}</p><div class="publish-actions"><button type="button" @click="renameOpen = false">取消</button><button :disabled="renameLoading || !renameTitle.trim()" class="primary" type="submit">{{ renameLoading ? '保存中' : '保存名称' }}</button></div></form></BaseDialog>
    <BaseDialog :open="confirmAction !== null" :title="confirmAction === 'withdraw' ? '撤回 Prompt' : confirmAction === 'delete' ? '删除 Agent Session' : '设为私密'" @close="!confirmLoading && (confirmAction = null)"><div class="agent-dialog confirm-dialog"><p v-if="confirmAction === 'withdraw'">将删除这条 Prompt 及其后的工具调用、结果与后续 Prompt，此操作无法恢复。</p><p v-else-if="confirmAction === 'delete'">将永久删除“{{ activeConversation?.title }}”及全部 Session 上下文，此操作无法恢复。</p><p v-else>设为私密后，公开大厅中的链接将立即无法访问。</p><p v-if="confirmError" class="dialog-error">{{ confirmError }}</p><div class="publish-actions"><button :disabled="confirmLoading" type="button" @click="confirmAction = null">取消</button><button v-if="confirmAction === 'withdraw'" :disabled="confirmLoading" class="danger" type="button" @click="confirmWithdraw">{{ confirmLoading ? '撤回中' : '确认撤回' }}</button><button v-else-if="confirmAction === 'delete'" :disabled="confirmLoading" class="danger" type="button" @click="confirmDeleteConversation">{{ confirmLoading ? '删除中' : '确认删除' }}</button><button v-else :disabled="confirmLoading" class="primary" type="button" @click="confirmUnpublishConversation">{{ confirmLoading ? '处理中' : '设为私密' }}</button></div></div></BaseDialog>
    <BaseDialog :open="contextOpen" :title="contextCenterId ? `消息 #${contextCenterId} 上下文` : '消息上下文'" size="wide" panel-class="dialog-context" @close="contextOpen = false"><div class="evidence-context" @copy.prevent><p>当前筛选条件下共 {{ contextTotal }} 条消息，已定位到引用消息所在页。</p><div v-if="contextLoading" class="context-state">正在读取消息上下文...</div><div v-else-if="contextError" class="context-state error">{{ contextError }}</div><div v-else class="context-stream"><article v-for="message in contextMessages" :key="message.id" :class="{focused: message.id === contextCenterId}"><time>{{ formatContextTime(message.create_time) }}</time><strong>{{ message.username }}</strong><b>#{{ message.id }}</b><p>{{ messageContent(message.content) || '（空消息）' }}</p></article></div><footer v-if="contextTotalPages > 1" class="context-pagination"><button type="button" :disabled="contextLoading || !contextHasPrevious" @click="contextCenterId && loadMessageContext(contextCenterId, contextPage - 1)">上一页</button><span>{{ contextPage }} / {{ contextTotalPages }}</span><button type="button" :disabled="contextLoading || !contextHasNext" @click="contextCenterId && loadMessageContext(contextCenterId, contextPage + 1)">下一页</button></footer></div></BaseDialog>
  </section>
</template>

<style scoped>
.agent-page{display:flex;flex-direction:column;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:5px;box-shadow:0 18px 46px var(--shadow)}
.agent-topbar{display:grid;flex:0 0 50px;grid-template-columns:minmax(190px,1fr) auto minmax(190px,1fr);align-items:center;gap:12px;min-height:50px;padding:5px 10px;background:color-mix(in srgb,var(--surface) 34%,var(--panel-bg));border-bottom:1px solid var(--border)}
.agent-brand{display:flex;align-items:center;gap:9px;min-width:0}.agent-brand>span{display:grid;place-items:center;width:30px;height:30px;color:var(--accent-contrast);background:var(--accent);border-radius:4px;font:800 12px ui-monospace,monospace}.agent-brand>div{display:grid;gap:1px}.agent-brand strong{font-size:15px}.agent-brand small{color:var(--muted-text);font:10px ui-monospace,monospace;letter-spacing:.1em}
.agent-topbar nav{display:flex;padding:3px;background:var(--surface);border:1px solid var(--border);border-radius:4px}.agent-topbar nav button{min-height:28px;padding:0 13px;color:var(--muted-text);background:transparent;border:0;border-radius:3px;font-size:12px;font-weight:750}.agent-topbar nav button.active{color:var(--accent-contrast);background:var(--accent)}
.new-run{justify-self:end;min-height:32px;padding:0 11px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:12px;font-weight:750}.new-run:hover{border-color:var(--accent)}
.agent-workspace{display:grid;flex:1 1 auto;grid-template-columns:240px minmax(0,1fr);min-height:0}.run-sidebar{display:flex;flex-direction:column;min-width:0;min-height:0;background:color-mix(in srgb,var(--surface) 26%,var(--panel-bg));border-right:1px solid var(--border)}.run-sidebar>header{display:flex;align-items:center;justify-content:space-between;min-height:40px;padding:0 11px;border-bottom:1px solid var(--border)}.run-sidebar>header strong{font-size:12px}.run-sidebar>header span{color:var(--muted-text);font:11px ui-monospace,monospace}
.run-list{flex:1;min-height:0;padding:5px;overflow-y:auto}.run-list>button{display:grid;grid-template-columns:7px minmax(0,1fr) auto;align-items:start;gap:8px;width:100%;padding:9px 7px;color:var(--panel-text);background:transparent;border:1px solid transparent;border-radius:4px;text-align:left}.run-list>button:hover{background:var(--surface-hover)}.run-list>button.active{background:var(--surface-selected);border-color:color-mix(in srgb,var(--accent) 42%,var(--border))}.run-list>button>span:nth-child(2){display:grid;gap:3px;min-width:0}.run-list strong,.run-list small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.run-list strong{font-size:12px}.run-list small{color:var(--muted-text);font-size:10px}.run-list time{color:var(--muted-text);font-size:9px;white-space:nowrap}.run-state{width:6px;height:6px;margin-top:3px;background:var(--muted-text);border-radius:50%}.run-state.running{background:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 12%,transparent)}.run-state.waiting_for_input{background:var(--warning-text)}.run-state.completed{background:var(--success)}.run-state.error{background:var(--danger)}.side-state{padding:14px 8px;color:var(--muted-text);font-size:12px}
.agent-console{display:flex;flex-direction:column;min-width:0;min-height:0}.console-header{display:flex;flex:0 0 46px;align-items:center;justify-content:space-between;gap:12px;min-height:46px;padding:5px 9px;border-bottom:1px solid var(--border)}.console-header>div:first-child{display:grid;gap:2px;min-width:0}.console-header>div:first-child>strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}.console-header small{display:flex;gap:7px;color:var(--muted-text);font-size:10px}.console-header small span.public{color:var(--success-text)}.console-header small b{color:var(--accent)}.console-actions{display:flex;gap:4px}.console-actions button,.publish-actions button,.public-header>button,.lobby-header button,.pagination button,.run-footer button{min-height:28px;padding:0 8px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:11px;font-weight:700}.console-actions .primary,.publish-actions .primary,.run-footer button{color:var(--accent-contrast);background:var(--accent);border-color:var(--accent)}.console-actions .danger{color:var(--danger)}.console-actions button:disabled{cursor:not-allowed;opacity:.4}
.console-viewport,.public-viewport{flex:1;min-height:0;padding:14px;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.console-viewport.has-session,.console-viewport.new-session{padding:0;overflow:hidden}.run-builder{display:grid;grid-template-rows:minmax(0,1fr) auto;width:100%;height:100%;min-height:0;background:var(--panel-bg)}.run-builder-scroll{display:grid;align-content:start;gap:14px;min-height:0;padding:22px;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.run-builder-scroll>header{display:grid;gap:5px}.run-builder-scroll>header span{color:var(--accent);font:800 12px ui-monospace,monospace;letter-spacing:.14em}.run-builder h1{margin:0;font-size:28px;letter-spacing:0}.run-builder .tool-catalog>summary strong{font-size:14px}.run-builder .tool-catalog>summary small{font-size:12px}.run-builder .tool-catalog>summary>b{font-size:12px}.run-builder .tool-catalog-grid article strong{font-size:13px}.run-builder .tool-catalog-grid article code{font-size:11px}.run-builder .tool-catalog-grid article p{font-size:12px}.run-builder .tool-catalog-grid article footer span{font-size:10px}.run-builder-composer{display:grid;gap:8px;padding:10px 22px 12px;background:color-mix(in srgb,var(--surface) 70%,var(--panel-bg));border-top:1px solid var(--border);box-shadow:0 -10px 28px color-mix(in srgb,var(--shadow) 55%,transparent)}.run-builder-composer>label{display:grid;gap:6px}.run-builder-composer>label>span{font-size:13px;font-weight:800}.run-builder textarea,.checkpoint textarea{width:100%;resize:vertical;padding:10px 12px;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:4px;outline:0;font:15px/1.55 inherit}.run-builder textarea:focus,.checkpoint textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 10%,transparent)}.task-templates{display:flex;flex-wrap:wrap;gap:5px}.task-templates button{min-height:28px;padding:0 9px;color:var(--muted-text);background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:12px}.task-templates button:hover{color:var(--panel-text);border-color:var(--accent)}.run-options{display:flex;flex-wrap:wrap;gap:14px;padding:8px 10px;background:color-mix(in srgb,var(--accent) 4%,var(--panel-bg));border:1px solid color-mix(in srgb,var(--accent) 20%,var(--border));border-radius:4px}.run-builder-composer>footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding-top:8px;border-top:1px solid var(--border)}.run-builder-composer>footer>span{color:var(--muted-text);font-size:12px}.run-builder-composer>footer button{display:flex;align-items:center;gap:6px;min-height:36px;padding:0 14px;color:var(--accent-contrast);background:var(--accent);border:1px solid var(--accent);border-radius:4px;font-size:13px;font-weight:800}.run-builder-composer>footer button:disabled{opacity:.4}
.run-main{min-width:0}.console-viewport.has-session>.session-layout{height:100%}.session-run-main{display:grid;grid-template-rows:minmax(0,1fr) auto;height:100%;min-height:0}.session-scroll{min-height:0;padding:14px;overflow:auto;scrollbar-width:thin;scrollbar-color:var(--border) transparent}
.checkpoint{display:grid;gap:8px;margin-top:10px;padding-top:9px;border-top:1px solid var(--border)}.question-deadline{color:var(--warning-text);font:800 10px ui-monospace,monospace}.answer-options{display:flex;flex-wrap:wrap;gap:5px}.answer-options button,.readonly-options span{min-height:28px;padding:0 8px;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:4px;font-size:10px}.answer-options button.active{color:var(--accent-contrast);background:var(--accent);border-color:var(--accent)}.checkpoint .resume{justify-self:end;min-height:30px;padding:0 10px;color:var(--accent-contrast);background:var(--accent);border:0;border-radius:4px;font-size:11px;font-weight:800}.checkpoint .resume:disabled{opacity:.4}.readonly-options{display:flex;flex-wrap:wrap;gap:5px;margin-top:8px}.readonly-options span{display:flex;align-items:center;color:var(--muted-text)}
.next-actions{display:grid;gap:5px;margin:3px 0 10px;padding:9px;background:var(--surface);border:1px solid var(--border);border-radius:5px}.next-actions header{display:flex;align-items:center;justify-content:space-between;margin-bottom:2px}.next-actions header strong{font-size:11px}.next-actions header span{color:var(--muted-text);font-size:9px}.next-actions>button{display:flex;align-items:flex-start;gap:7px;width:100%;padding:7px 8px;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:4px;text-align:left;font-size:11px;line-height:1.45}.next-actions>button:hover{border-color:var(--accent)}.next-actions>button span{color:var(--accent)}.next-actions.readonly>span{padding:6px 7px;color:var(--muted-text);background:var(--panel-bg);border-radius:3px;font-size:10px}.run-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px 9px;color:var(--muted-text);background:var(--surface);border:1px solid var(--border);border-radius:4px;font-size:10px}
/*
.run-continuation{display:grid;gap:8px;margin:0 14px 14px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:5px;box-shadow:0 -10px 28px color-mix(in srgb,var(--shadow) 65%,transparent)}.run-continuation>header,.run-continuation>footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.run-continuation>header>div{display:grid;gap:1px}.run-continuation>header strong{font-size:12px}.run-continuation>header span,.run-continuation>footer span{color:var(--muted-text);font-size:10px}.run-continuation>header b{color:var(--accent);font:800 10px ui-monospace,monospace}.run-continuation textarea{width:100%;resize:vertical;padding:9px 10px;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:4px;outline:0;font:13px/1.6 inherit}.run-continuation textarea:focus{border-color:va…4661 tokens truncated….message-evidence>header span{color:var(--accent);font:800 7px ui-monospace,monospace}.message-evidence>header strong{font-size:9px}.message-evidence>header small{color:var(--muted-text);font-size:7px}.evidence-list{display:grid;max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:3px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.evidence-list>button{display:grid;gap:3px;width:100%;padding:7px 8px;color:var(--panel-text);background:var(--panel-bg);border:0;border-bottom:1px solid var(--border);text-align:left}.evidence-list>button:last-child{border-bottom:0}.evidence-list>button:hover{background:var(--surface-hover)}.evidence-list>button>span{display:flex;align-items:center;gap:7px;min-width:0}.evidence-list b{color:var(--accent);font:800 8px ui-monospace,monospace}.evidence-list strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:8px}.evidence-list time{margin-left:auto;color:var(--muted-text);font-size:7px;white-space:nowrap}.evidence-list p{margin:0;color:var(--muted-text);font-size:9px;line-height:1.45;overflow-wrap:anywhere}.evidence-context{display:grid;gap:9px}.evidence-context>p{margin:0;color:var(--muted-text);font-size:9px}.context-state{padding:42px 10px;color:var(--muted-text);text-align:center;font-size:10px}.context-state.error{color:var(--danger)}.context-stream{display:grid;max-height:min(62dvh,620px);overflow:auto;border:1px solid var(--border);border-radius:4px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.context-stream article{display:grid;grid-template-columns:145px 110px 72px minmax(0,1fr);align-items:baseline;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border)}.context-stream article:last-child{border-bottom:0}.context-stream article.focused{background:color-mix(in srgb,var(--accent) 14%,var(--surface));box-shadow:inset 3px 0 0 var(--accent)}.context-stream time{color:var(--muted-text);font-size:8px}.context-stream strong{color:var(--accent);font-size:9px;overflow-wrap:anywhere}.context-stream b{color:var(--muted-text);font:800 8px ui-monospace,monospace}.context-stream article.focused b{color:var(--accent)}.context-stream article p{margin:0;color:var(--panel-text);font-size:10px;line-height:1.45;overflow-wrap:anywhere}
.message-evidence{display:grid;gap:7px;margin-top:10px;padding-top:9px;border-top:1px solid var(--border)}.message-evidence>header{display:flex;align-items:end;justify-content:space-between;gap:10px}.message-evidence>header>div{display:grid;gap:1px}.message-evidence>header span{color:var(--accent);font:800 9px ui-monospace,monospace}.message-evidence>header strong{font-size:11px}.message-evidence>header small{color:var(--muted-text);font-size:9px}.evidence-list{display:grid;max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:3px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.evidence-list>button{display:grid;gap:3px;width:100%;padding:7px 8px;color:var(--panel-text);background:var(--panel-bg);border:0;border-bottom:1px solid var(--border);text-align:left}.evidence-list>button:last-child{border-bottom:0}.evidence-list>button:hover{background:var(--surface-hover)}.evidence-list>button>span{display:flex;align-items:center;gap:7px;min-width:0}.evidence-list b{color:var(--accent);font:800 10px ui-monospace,monospace}.evidence-list strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.evidence-list time{margin-left:auto;color:var(--muted-text);font-size:9px;white-space:nowrap}.evidence-list p{margin:0;color:var(--muted-text);font-size:11px;line-height:1.45;overflow-wrap:anywhere}.evidence-context{display:grid;gap:9px}.evidence-context>p{margin:0;color:var(--muted-text);font-size:11px}.context-state{padding:42px 10px;color:var(--muted-text);text-align:center;font-size:12px}.context-state.error{color:var(--danger)}.context-stream{display:grid;max-height:min(62dvh,620px);overflow:auto;border:1px solid var(--border);border-radius:4px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.context-stream article{display:grid;grid-template-columns:145px 110px 72px minmax(0,1fr);align-items:baseline;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border)}.context-stream article:last-child{border-bottom:0}.context-stream article.focused{background:color-mix(in srgb,var(--accent) 14%,var(--surface));box-shadow:inset 3px 0 0 var(--accent)}.context-stream time{color:var(--muted-text);font-size:10px}.context-stream strong{color:var(--accent);font-size:11px;overflow-wrap:anywhere}.context-stream b{color:var(--muted-text);font:800 10px ui-monospace,monospace}.context-stream article.focused b{color:var(--accent)}.context-stream article p{margin:0;color:var(--panel-text);font-size:12px;line-height:1.45;overflow-wrap:anywhere}
*/
.run-continuation{display:grid;gap:8px;margin:0 14px 14px;padding:10px;background:var(--surface);border:1px solid var(--border);border-radius:5px;box-shadow:0 -10px 28px color-mix(in srgb,var(--shadow) 65%,transparent)}.run-continuation>header,.run-continuation>footer{display:flex;align-items:center;justify-content:space-between;gap:10px}.run-continuation>header>div{display:grid;gap:1px}.run-continuation>header strong{font-size:11px}.run-continuation>header span,.run-continuation>footer span{color:var(--muted-text);font-size:9px}.run-continuation>header b{color:var(--accent);font:800 9px ui-monospace,monospace}.run-continuation textarea{width:100%;resize:vertical;padding:9px 10px;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:4px;outline:0;font:12px/1.6 inherit}.run-continuation textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 10%,transparent)}.run-continuation textarea:disabled{opacity:.6}.run-continuation button{min-height:30px;padding:0 10px;color:var(--accent-contrast);background:var(--accent);border:1px solid var(--accent);border-radius:4px;font-size:11px;font-weight:800}.run-continuation button:disabled{cursor:not-allowed;opacity:.4}.session-run-main>.run-footer{margin:0 14px 14px}
.message-evidence{display:grid;gap:7px;margin-top:10px;padding-top:9px;border-top:1px solid var(--border)}.message-evidence>header{display:flex;align-items:end;justify-content:space-between;gap:10px}.message-evidence>header>div{display:grid;gap:1px}.message-evidence>header span{color:var(--accent);font:800 10px ui-monospace,monospace}.message-evidence>header strong{font-size:12px}.message-evidence>header small{color:var(--muted-text);font-size:10px}.evidence-list{display:grid;max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:3px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.evidence-list>button{display:grid;gap:3px;width:100%;padding:7px 8px;color:var(--panel-text);background:var(--panel-bg);border:0;border-bottom:1px solid var(--border);text-align:left}.evidence-list>button:last-child{border-bottom:0}.evidence-list>button:hover{background:var(--surface-hover)}.evidence-list>button>span{display:flex;align-items:center;gap:7px;min-width:0}.evidence-list b{color:var(--accent);font:800 11px ui-monospace,monospace}.evidence-list strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.evidence-list time{margin-left:auto;color:var(--muted-text);font-size:10px;white-space:nowrap}.evidence-list p{margin:0;color:var(--muted-text);font-size:12px;line-height:1.45;overflow-wrap:anywhere}.evidence-context{display:grid;gap:9px}.evidence-context>p{margin:0;color:var(--muted-text);font-size:12px}.context-state{padding:42px 10px;color:var(--muted-text);text-align:center;font-size:13px}.context-state.error{color:var(--danger)}.context-stream{display:grid;max-height:min(62dvh,620px);overflow:auto;border:1px solid var(--border);border-radius:4px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.context-stream article{display:grid;grid-template-columns:145px 110px 72px minmax(0,1fr);align-items:baseline;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border)}.context-stream article:last-child{border-bottom:0}.context-stream article.focused{background:color-mix(in srgb,var(--accent) 14%,var(--surface));box-shadow:inset 3px 0 0 var(--accent)}.context-stream time{color:var(--muted-text);font-size:11px}.context-stream strong{color:var(--accent);font-size:12px;overflow-wrap:anywhere}.context-stream b{color:var(--muted-text);font:800 11px ui-monospace,monospace}.context-stream article.focused b{color:var(--accent)}.context-stream article p{margin:0;color:var(--panel-text);font-size:13px;line-height:1.45;overflow-wrap:anywhere}
.lobby-panel{display:flex;flex:1;flex-direction:column;min-height:0}.lobby-header,.public-header{display:grid;flex:0 0 52px;grid-template-columns:minmax(180px,1fr) minmax(260px,430px);align-items:center;gap:12px;min-height:52px;padding:6px 11px;border-bottom:1px solid var(--border)}.public-header{grid-template-columns:auto minmax(0,1fr) auto}.lobby-header>div,.public-header>div{display:grid;gap:2px}.lobby-header strong,.public-header strong{font-size:14px}.lobby-header small,.public-header small{color:var(--muted-text);font-size:11px}.lobby-header form{display:grid;grid-template-columns:minmax(0,1fr) auto}.lobby-header input{min-width:0;height:32px;padding:0 9px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-right:0;border-radius:4px 0 0 4px;outline:0;font-size:12px}.lobby-header button{height:32px;border-radius:0 4px 4px 0}.live{display:flex;align-items:center;gap:5px;color:var(--danger);font:800 10px ui-monospace,monospace}.live i{width:6px;height:6px;background:var(--danger);border-radius:50%;animation:live 1.4s ease-in-out infinite}.public-viewport{user-select:none}.public-run{margin:0 auto}
.lobby-grid{display:grid;flex:1;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));align-content:start;gap:9px;min-height:0;padding:11px;overflow:auto}.lobby-grid>button{display:flex;flex-direction:column;min-height:178px;padding:12px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:5px;text-align:left;transition:transform .16s ease,border-color .16s ease}.lobby-grid>button:hover{border-color:var(--accent);transform:translateY(-2px)}.lobby-grid header{display:flex;align-items:center;gap:7px}.lobby-grid header>span{display:grid;place-items:center;width:28px;height:28px;color:var(--accent-contrast);background:var(--accent);border-radius:4px;font-size:11px;font-weight:800}.lobby-grid header div{display:grid;gap:1px}.lobby-grid header strong{font-size:11px}.lobby-grid header small{color:var(--muted-text);font-size:9px}.lobby-grid header b{margin-left:auto;padding:3px 6px;color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,transparent);border-radius:999px;font-size:9px}.lobby-grid h2{margin:15px 0 6px;font-size:16px;letter-spacing:0}.lobby-grid p{flex:1;margin:0;color:var(--muted-text);font-size:11px;line-height:1.55}.lobby-grid footer{display:flex;align-items:center;gap:8px;margin-top:13px;padding-top:8px;color:var(--muted-text);border-top:1px solid var(--border);font-size:10px}.lobby-grid footer b{margin-left:auto;color:var(--accent)}.pagination{display:flex;flex:0 0 40px;align-items:center;justify-content:center;gap:9px;border-top:1px solid var(--border)}.pagination span{color:var(--muted-text);font-size:11px}
.agent-empty{display:grid;place-content:center;justify-items:center;gap:8px;width:100%;height:100%;min-height:220px;color:var(--muted-text);text-align:center}.agent-empty strong{color:var(--panel-text);font-size:14px}.loader{display:flex;align-items:end;gap:3px;height:22px}.loader i{width:4px;height:9px;background:var(--accent);animation:bars .7s ease-in-out infinite alternate}.loader i:nth-child(2){height:18px;animation-delay:-.3s}.loader i:nth-child(3){height:13px;animation-delay:-.5s}.empty-code{color:var(--accent);font:800 10px ui-monospace,monospace;letter-spacing:.12em}
.publish-dialog{display:grid;gap:10px}.publish-preview{padding:11px;background:var(--surface);border:1px solid var(--border);border-radius:4px}.publish-preview span{display:block;color:var(--muted-text);font-size:10px}.publish-preview strong{display:block;margin:4px 0;font-size:13px}.publish-preview p,.publish-warning{margin:0;color:var(--muted-text);font-size:11px;line-height:1.55}.publish-warning{padding:8px 9px;color:var(--warning-text);background:var(--warning-soft);border-radius:4px}.publish-actions{display:flex;justify-content:flex-end;gap:6px}
.agent-dialog{display:grid;gap:12px}.agent-dialog label{display:grid;gap:6px;color:var(--muted-text);font-size:11px;font-weight:700}.agent-dialog input{width:100%;height:36px;padding:0 10px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:4px;font:inherit;font-size:13px;outline:0}.agent-dialog input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 11%,transparent)}.agent-dialog p{margin:0;color:var(--muted-text);font-size:12px;line-height:1.6}.agent-dialog .dialog-error{padding:8px 9px;color:var(--danger);background:color-mix(in srgb,var(--danger) 7%,var(--panel-bg));border:1px solid color-mix(in srgb,var(--danger) 30%,var(--border));border-radius:4px}.publish-actions .danger{color:#fff;background:var(--danger);border-color:var(--danger)}
.session-layout{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;width:min(1180px,100%);margin:0 auto}.session-header{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:9px;padding:2px 2px 8px;border-bottom:1px solid var(--border)}.session-header>div{display:grid;gap:2px}.session-header span,.prompt-brief span,.agent-intent span,.session-entry>header span,.backend-io span{color:var(--accent);font:800 9px ui-monospace,monospace;letter-spacing:0}.session-header strong{font-size:15px}.session-header time{color:var(--muted-text);font-size:10px}.prompt-brief{display:grid;gap:7px;margin-bottom:8px;padding:11px 12px;background:var(--panel-bg);border:1px solid color-mix(in srgb,var(--accent) 34%,var(--border));border-left:3px solid var(--accent);border-radius:4px}.prompt-brief header,.agent-intent header{display:flex;align-items:center;justify-content:space-between;gap:10px}.prompt-brief small,.agent-intent b{color:var(--muted-text);font-size:9px}.agent-intent header b{display:flex;align-items:center;gap:5px}.agent-intent header b i{width:5px;height:5px;background:var(--accent);border-radius:50%;animation:activity-pulse 1s ease-in-out infinite}.prompt-brief p,.agent-intent p,.entry-content>p{margin:0;color:var(--panel-text);font-size:12px;line-height:1.72;white-space:pre-wrap;overflow-wrap:anywhere}.agent-intent{position:relative;display:grid;gap:6px;margin-bottom:8px;padding:8px 10px;overflow:hidden;background:color-mix(in srgb,var(--accent) 5%,var(--surface));border:1px dashed color-mix(in srgb,var(--accent) 36%,var(--border));border-radius:4px}.agent-intent.active::after{position:absolute;inset:0;content:"";pointer-events:none;background:linear-gradient(100deg,transparent 30%,color-mix(in srgb,var(--accent) 10%,transparent) 50%,transparent 70%);transform:translateX(-100%);animation:activity-sweep 2.2s ease-in-out infinite}.session-log{display:grid;gap:6px}.session-entry{overflow:hidden;background:color-mix(in srgb,var(--surface) 58%,var(--panel-bg));border:1px solid var(--border);border-radius:4px}.session-entry.tool{border-left:3px solid var(--accent)}.session-entry.question{border-color:color-mix(in srgb,var(--warning-text) 45%,var(--border))}.session-entry.error{border-color:color-mix(in srgb,var(--danger) 48%,var(--border))}.session-entry.output{border-color:color-mix(in srgb,var(--success) 30%,var(--border))}.session-entry>header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:38px;padding:6px 9px;background:color-mix(in srgb,var(--surface) 72%,var(--panel-bg));border-bottom:1px solid var(--border)}.session-entry>header>div{display:grid;gap:1px}.session-entry>header>div:last-child{justify-items:end}.session-entry>header strong{font-size:11px}.session-entry>header small,.session-entry>header b{color:var(--muted-text);font-size:9px}.entry-content{padding:9px 10px}.execution-meter{display:grid;gap:5px;margin-bottom:8px;padding:7px 8px;background:color-mix(in srgb,var(--accent) 5%,var(--panel-bg));border:1px solid color-mix(in srgb,var(--accent) 25%,var(--border));border-radius:3px}.execution-meter>header{display:flex;align-items:center;justify-content:space-between;gap:8px;color:var(--muted-text);font-size:10px}.execution-meter>header span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.execution-meter>header b{color:var(--accent);font:800 9px ui-monospace,monospace}.execution-meter>i{position:relative;display:block;height:3px;overflow:hidden;background:color-mix(in srgb,var(--accent) 12%,var(--surface));border-radius:999px}.execution-meter>i>b{position:absolute;inset:0 auto 0 0;min-width:3px;background:var(--accent);border-radius:inherit;transition:width .25s ease}.execution-meter.indeterminate>i>b{width:32%;animation:meter-slide 1.15s ease-in-out infinite}.generation-state{display:flex;align-items:center;gap:7px;margin-bottom:8px;padding:7px 8px;color:var(--muted-text);background:color-mix(in srgb,var(--success) 5%,var(--panel-bg));border:1px solid color-mix(in srgb,var(--success) 22%,var(--border));border-radius:3px;font-size:10px}.generation-state>span{display:flex;align-items:center;gap:2px}.generation-state>span i{width:4px;height:4px;background:var(--success);border-radius:50%;animation:typing-dot .8s ease-in-out infinite alternate}.generation-state>span i:nth-child(2){animation-delay:.15s}.generation-state>span i:nth-child(3){animation-delay:.3s}.generation-state strong{color:var(--panel-text);font-size:10px}.generation-state small{margin-left:auto;font:9px ui-monospace,monospace}.backend-io{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:6px;margin-top:8px}.backend-io section{min-width:0;overflow:hidden;background:var(--panel-bg);border:1px solid var(--border);border-radius:3px}.backend-io span{display:block;padding:5px 7px;border-bottom:1px solid var(--border)}.backend-io pre{max-height:128px;margin:0;padding:6px 7px;overflow:auto;color:var(--muted-text);font:10px/1.5 ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere}.public-run{margin:0 auto}
.message-evidence{display:grid;gap:7px;margin-top:10px;padding-top:9px;border-top:1px solid var(--border)}.message-evidence>header{display:flex;align-items:end;justify-content:space-between;gap:10px}.message-evidence>header>div{display:grid;gap:1px}.message-evidence>header span{color:var(--accent);font:800 9px ui-monospace,monospace}.message-evidence>header strong{font-size:11px}.message-evidence>header small{color:var(--muted-text);font-size:9px}.evidence-list{display:grid;max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:3px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.evidence-list>button{display:grid;gap:3px;width:100%;padding:7px 8px;color:var(--panel-text);background:var(--panel-bg);border:0;border-bottom:1px solid var(--border);text-align:left}.evidence-list>button:last-child{border-bottom:0}.evidence-list>button:hover{background:var(--surface-hover)}.evidence-list>button>span{display:flex;align-items:center;gap:7px;min-width:0}.evidence-list b{color:var(--accent);font:800 10px ui-monospace,monospace}.evidence-list strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:10px}.evidence-list time{margin-left:auto;color:var(--muted-text);font-size:9px;white-space:nowrap}.evidence-list p{margin:0;color:var(--muted-text);font-size:11px;line-height:1.45;overflow-wrap:anywhere}.evidence-context{display:grid;gap:9px}.evidence-context>p{margin:0;color:var(--muted-text);font-size:11px}.context-state{padding:42px 10px;color:var(--muted-text);text-align:center;font-size:12px}.context-state.error{color:var(--danger)}.context-stream{display:grid;max-height:min(62dvh,620px);overflow:auto;border:1px solid var(--border);border-radius:4px;scrollbar-width:thin;scrollbar-color:var(--border) transparent}.context-stream article{display:grid;grid-template-columns:145px 110px 72px minmax(0,1fr);align-items:baseline;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border)}.context-stream article:last-child{border-bottom:0}.context-stream article.focused{background:color-mix(in srgb,var(--accent) 14%,var(--surface));box-shadow:inset 3px 0 0 var(--accent)}.context-stream time{color:var(--muted-text);font-size:10px}.context-stream strong{color:var(--accent);font-size:11px;overflow-wrap:anywhere}.context-stream b{color:var(--muted-text);font:800 10px ui-monospace,monospace}.context-stream article.focused b{color:var(--accent)}.context-stream article p{margin:0;color:var(--panel-text);font-size:12px;line-height:1.45;overflow-wrap:anywhere}
.player-report-profile{display:grid;gap:8px;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid var(--border)}.player-report-profile>header{display:grid;grid-template-columns:52px minmax(0,1fr) auto;align-items:center;gap:10px}.player-report-profile>header>img,.profile-avatar-fallback{width:52px;height:52px;object-fit:cover;image-rendering:pixelated;background:var(--panel-bg);border:1px solid var(--border);border-radius:3px}.profile-avatar-fallback{display:grid;place-items:center;color:var(--accent-contrast);background:var(--accent);font-size:18px;font-weight:800}.player-report-profile>header>div{display:grid;gap:2px;min-width:0}.player-report-profile>header span:not(.profile-avatar-fallback){color:var(--accent);font:800 9px ui-monospace,monospace}.player-report-profile>header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:16px}.player-report-profile>header small{color:var(--muted-text);font-size:10px}.player-report-profile>header>b{padding:4px 6px;color:var(--success-text);background:color-mix(in srgb,var(--success) 12%,var(--panel-bg));border:1px solid color-mix(in srgb,var(--success) 34%,var(--border));border-radius:3px;font:800 9px ui-monospace,monospace}.player-report-profile iframe{display:block;width:100%;height:178px;background:var(--panel-bg);border:1px solid var(--border);border-radius:3px}
.prompt-brief header>div{display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:0}.withdraw{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:22px;padding:0 7px;color:var(--danger);background:transparent;border:1px solid color-mix(in srgb,var(--danger) 38%,var(--border));border-radius:3px;font-size:9px;line-height:1;white-space:nowrap}.withdraw:hover:not(:disabled){background:color-mix(in srgb,var(--danger) 8%,transparent)}.withdraw:disabled{cursor:not-allowed;opacity:.45}.session-entry>header>div:last-child{display:flex;align-items:center;justify-content:flex-end;gap:7px}.tool-failure{display:grid;gap:3px;margin:8px 0;padding:8px 9px;color:var(--danger);background:color-mix(in srgb,var(--danger) 6%,var(--panel-bg));border:1px solid color-mix(in srgb,var(--danger) 28%,var(--border));border-radius:3px}.tool-failure strong{font-size:11px}.tool-failure p,.tool-failure small{margin:0;color:var(--muted-text);font-size:10px;line-height:1.45}.tool-failure p{color:var(--panel-text)}
@media(max-width:760px){.backend-io{grid-template-columns:1fr}.session-entry>header{align-items:flex-start}.profile-avatar-fallback{width:44px;height:44px}}
.inline-visual{display:grid;gap:7px;margin-top:9px;padding-top:9px;border-top:1px solid var(--border)}.inline-visual>header{display:flex;align-items:center;justify-content:space-between;gap:10px}.inline-visual>header>div,.inline-visual figcaption{display:grid;gap:1px;min-width:0}.inline-visual>header span{color:var(--accent);font:800 9px ui-monospace,monospace}.inline-visual>header strong,.inline-visual figcaption strong{font-size:11px}.inline-visual>header button{display:grid;place-items:center;width:25px;height:25px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:3px}.inline-visual figure{min-width:0;margin:0;overflow:hidden;background:var(--panel-bg);border:1px solid var(--border);border-radius:3px}.inline-visual figcaption{padding:7px 8px;border-bottom:1px solid var(--border)}.inline-visual figcaption strong,.inline-visual figcaption small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.inline-visual figcaption small{color:var(--muted-text);font-size:9px}.inline-visual img{display:block;width:100%;max-height:420px;padding:8px;background:#fff;object-fit:contain}
@keyframes bars{from{transform:scaleY(.45)}to{transform:scaleY(1)}}@keyframes live{50%{opacity:.4;transform:scale(.8)}}@keyframes activity-pulse{50%{opacity:.35;transform:scale(.7)}}@keyframes activity-sweep{55%,100%{transform:translateX(100%)}}@keyframes meter-slide{0%{left:-34%}55%{left:68%}100%{left:100%}}@keyframes typing-dot{to{opacity:.25;transform:translateY(-2px)}}
@media(max-width:1000px){.console-actions button:not(.primary){display:none}}
@media(max-width:760px){.agent-topbar{grid-template-columns:minmax(0,1fr) auto}.agent-brand{display:none}.agent-topbar nav{justify-self:start}.new-run{grid-column:2;grid-row:1}.agent-workspace{display:flex;flex-direction:column}.run-sidebar{flex:0 0 92px;border-right:0;border-bottom:1px solid var(--border)}.run-sidebar>header{display:none}.run-list{display:flex;gap:5px;overflow-x:auto;overflow-y:hidden}.run-list>button{flex:0 0 170px;grid-template-columns:6px minmax(0,1fr)}.run-list time{display:none}.console-actions button{display:none!important}.console-actions .primary{display:block!important}.console-viewport,.public-viewport{padding:8px}.console-viewport.has-session,.console-viewport.new-session{padding:0}.session-scroll{padding:8px}.run-continuation,.session-run-main>.run-footer{margin:0 8px 8px}.run-builder-scroll{gap:12px;padding:14px 14px 10px}.run-builder-composer{gap:8px;padding:10px 14px 12px}.run-builder h1{font-size:21px}.run-builder-composer>footer{align-items:stretch;flex-direction:column}.run-builder-composer>footer button{justify-content:center}.lobby-header{grid-template-columns:1fr;height:auto;padding:8px}.lobby-grid{grid-template-columns:1fr;padding:7px}.public-header{grid-template-columns:auto minmax(0,1fr) auto}.public-header small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.context-stream article{grid-template-columns:1fr;gap:3px}.context-stream article p{margin-top:2px}.player-report-profile>header{grid-template-columns:44px minmax(0,1fr)}.player-report-profile>header>img{width:44px;height:44px}.player-report-profile>header>b{display:none}.player-report-profile iframe{height:210px}}
@media(prefers-reduced-motion:reduce){.loader i,.live i,.agent-intent header b i,.agent-intent.active::after,.execution-meter.indeterminate>i>b,.generation-state>span i{animation:none}.execution-meter>i>b,.lobby-grid>button{transition:none}}
.inline-visual>header button{width:auto;min-width:25px;padding:0 6px;font-size:9px}
.run-builder-composer>footer>span,.run-continuation>footer span{font-size:12px}
.tool-catalog{display:grid;gap:9px;margin:0;padding:9px 10px;background:color-mix(in srgb,var(--surface) 56%,var(--panel-bg));border:1px solid color-mix(in srgb,var(--accent) 28%,var(--border));border-radius:4px}.tool-catalog>summary{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;list-style:none}.tool-catalog>summary::-webkit-details-marker{display:none}.tool-catalog>summary>span{display:grid;gap:2px;min-width:0}.tool-catalog>summary strong{font-size:12px}.tool-catalog>summary small{color:var(--muted-text);font-size:10px}.tool-catalog>summary>b{flex:0 0 auto;color:var(--accent);font:800 10px ui-monospace,monospace}.tool-catalog-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:6px}.tool-catalog-grid article{display:grid;grid-template-rows:auto minmax(0,1fr) auto;gap:5px;min-width:0;padding:8px;background:var(--panel-bg);border:1px solid var(--border);border-radius:3px}.tool-catalog-grid article>header{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}.tool-catalog-grid article strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px}.tool-catalog-grid article code{overflow:hidden;color:var(--accent);font:9px ui-monospace,monospace;text-overflow:ellipsis;white-space:nowrap}.tool-catalog-grid article p{min-height:32px;margin:0;color:var(--muted-text);font-size:10px;line-height:1.45;overflow-wrap:anywhere}.tool-catalog-grid article footer{display:flex;flex-wrap:wrap;gap:4px}.tool-catalog-grid article footer span{display:inline-flex;align-items:center;gap:3px;min-width:0;padding:3px 4px;color:var(--muted-text);background:var(--surface);border:1px solid var(--border);border-radius:2px;font:9px ui-monospace,monospace}.tool-catalog-grid article footer b{color:var(--panel-text);font:inherit}.tool-catalog-grid article footer i{color:var(--warning-text);font-style:normal}.tool-catalog-state{display:flex;align-items:center;gap:7px;margin:0;color:var(--muted-text);font-size:11px}.tool-catalog-state.error{color:var(--danger)}.tool-catalog-state button{min-height:24px;padding:0 7px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:3px;font-size:10px}
.session-pagination{display:flex;flex:0 0 38px;align-items:center;justify-content:space-between;gap:6px;padding:5px 7px;border-top:1px solid var(--border)}.session-pagination button{min-height:26px;padding:0 7px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:3px;font-size:10px;font-weight:700}.session-pagination button:disabled{cursor:not-allowed;opacity:.42}.session-pagination span{color:var(--muted-text);font:10px ui-monospace,monospace;white-space:nowrap}@media(max-width:760px){.run-sidebar{flex-basis:128px}.session-pagination{flex-basis:34px;padding:4px 7px}.session-pagination button{min-height:24px;font-size:9px}.session-pagination span{font-size:9px}}
.context-pagination{display:flex;align-items:center;justify-content:flex-end;gap:8px;color:var(--muted-text);font-size:10px}.context-pagination button{height:28px;padding:0 9px;color:var(--panel-text);background:var(--surface);border:1px solid var(--border);border-radius:3px;font-size:10px}.context-pagination button:disabled{cursor:not-allowed;opacity:.45}.context-pagination button:hover:not(:disabled){color:var(--accent-contrast);background:var(--accent);border-color:var(--accent)}
.evidence-context{grid-template-rows:auto minmax(0,1fr) auto;min-height:0}.evidence-context .context-stream{align-content:start;min-height:0;max-height:none}
</style>
