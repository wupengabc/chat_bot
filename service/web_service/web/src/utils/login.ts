import { get, post } from './request'

export interface AuthUser {
  username?: string
  name?: string
  role?: string
  [key: string]: unknown
}

export interface AuthTokens {
  resource_token: string
  refresh_token: string
  resource_expires_in?: number
  refresh_expires_in?: number
  resource_token_expires_in?: number
  refresh_token_expires_in?: number
  user?: AuthUser
}

export interface AuthMeResponse {
  user?: AuthUser
  [key: string]: unknown
}

export interface ApiKeyStatusResponse { success: boolean; configured: boolean }
export interface CreateApiKeyResponse { success: boolean; apikey: string }
export type PointLogCategory = 'all' | 'sign' | 'recharge' | 'player_info' | 'agent' | 'map_share' | 'shop' | 'public_api' | 'admin' | 'manual'
export interface PointLog {
  id: number
  game_id: string
  action: 'add' | 'remove'
  num: number
  reason: string
  ext: string | null
  category: Exclude<PointLogCategory, 'all'>
  create_at: string
}
export interface PointLogsResponse {
  success: boolean
  username: string
  logs: PointLog[]
  pagination: HistoryPagination
}

export interface MinecraftMotdInfo {
  status: 'online'
  host: string
  ip: string
  port: number
  motd: string
  motd_html: string
  agreement: number
  version: string
  online: number
  max: number
  sample: Array<{ id: string; name: string }>
  favicon: string
  delay: number
}

export interface MotdResponse { success: boolean; available: boolean; motd: MinecraftMotdInfo | null }
export interface GameInfoResponse { success: boolean; available: boolean; bot_username: string | null }
export interface OnlinePlayer { username: string; display_name: string; ping: number | null; uuid: string | null }
export interface PlayersResponse { success: boolean; available: boolean; players: OnlinePlayer[] }
export interface PlayerNamesResponse {
  success: boolean
  names: string[]
  pagination: {
    page: number
    limit: number
    total: number
    total_pages: number
    has_previous: boolean
    has_next: boolean
  }
}

export interface PublicMessage {
  id: number
  username: string
  content: string
  address: string
  area: string
  message_type: string
  position: string
  create_time: string
}
export interface MessagesResponse {
  success: boolean
  messages: PublicMessage[]
  pagination: {
    page: number
    limit: number
    total: number
    total_pages: number
    has_previous: boolean
    has_next: boolean
  }
}
export interface MessageContextResponse {
  success: boolean
  center_id: number
  messages: PublicMessage[]
  pagination: MessagesResponse['pagination']
}

export interface MoneyHistoryEntry { money: number | string; timestamp: string }
export interface OnlineSession { start: string; end: string | null; duration: number | null }
export interface Landmark { name: string; description: string; owner: string; visits: number; price: string; item_id: string; updated_at: string }
export interface SelfUser extends AuthUser {
  username: string
  online: boolean
  money?: number
  point?: number
  message_count?: number
  online_time?: number
  first_record_time?: string
  last_join_time?: string | null
  last_leave_time?: string | null
  address_list?: string[]
  role?: string
  money_history: MoneyHistoryEntry[]
  online_session: OnlineSession[]
  landmarks: Landmark[]
  wallet: { amount: number | string | null; fetched_at: string | null; source: 'live' | 'cache' | 'history' | 'unavailable' }
}

export interface SelfResponse { success: boolean; user: SelfUser }
export const USER_HISTORY_PAGE_SIZE = 10
export interface HistoryPagination {
  page: number
  page_size: number
  total: number
  total_pages: number
  has_previous: boolean
  has_next: boolean
}
export interface HistoryPageResponse<T> { success: boolean; items: T[]; pagination: HistoryPagination }
export interface AvatarItem { username: string; avatar_url: string }
export interface AvatarResponse { success: boolean; avatars: AvatarItem[] }

export function playerAvatarUrl(username: string) {
  return `https://mineskin.eu/helm/${encodeURIComponent(username)}`
}

export function loginRequest(username: string, password: string) {
  return post<AuthTokens>('/api/user/auth/login', { username, password }, { skipAuthRefresh: true })
}

export function refreshRequest(refresh_token: string) {
  return post<AuthTokens>('/api/user/auth/refresh', { refresh_token }, { skipAuthRefresh: true })
}

export function meRequest() {
  return get<AuthMeResponse>('/api/user/auth/me')
}

export function apiKeyStatusRequest() {
  return get<ApiKeyStatusResponse>('/api/user/auth/api-key')
}

export function createApiKeyRequest() {
  return post<CreateApiKeyResponse>('/api/user/auth/api-key', {})
}

export function pointLogsRequest(page: number, category: PointLogCategory) {
  const params = new URLSearchParams({ page: String(Math.max(1, Math.floor(page))), category })
  return get<PointLogsResponse>(`/api/user/info/point_logs?${params.toString()}`)
}

export function motdRequest() {
  return get<MotdResponse>('/api/motd', { skipAuthRefresh: true })
}

export function gameInfoRequest() {
  return get<GameInfoResponse>('/api/game/info', { skipAuthRefresh: true })
}

export function playersRequest() {
  return get<PlayersResponse>('/api/players', { skipAuthRefresh: true })
}

export function playerNamesRequest(page: number, limit: number, like: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), like })
  return get<PlayerNamesResponse>(`/api/players/names?${params}`)
}

export function messagesRequest(page: number, limit: number, filters: { username?: string; create_time_from?: string; create_time_to?: string; content?: string }) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (filters.username?.trim()) params.set('username', filters.username.trim())
  if (filters.create_time_from?.trim()) params.set('create_time_from', filters.create_time_from.trim())
  if (filters.create_time_to?.trim()) params.set('create_time_to', filters.create_time_to.trim())
  if (filters.content?.trim()) params.set('content', filters.content.trim())
  return get<MessagesResponse>(`/api/user/messages?${params.toString()}`)
}

export function adminMessagesRequest(page: number, limit: number, filters: { username?: string; create_time_from?: string; create_time_to?: string; content?: string; position?: string; message_type?: string }) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (filters.username?.trim()) params.set('username', filters.username.trim())
  if (filters.create_time_from?.trim()) params.set('create_time_from', filters.create_time_from.trim())
  if (filters.create_time_to?.trim()) params.set('create_time_to', filters.create_time_to.trim())
  if (filters.content?.trim()) params.set('content', filters.content.trim())
  if (filters.position?.trim()) params.set('position', filters.position.trim())
  if (filters.message_type?.trim()) params.set('message_type', filters.message_type.trim())
  return get<MessagesResponse>(`/api/admin/messages?${params.toString()}`)
}

function appendMessageFilters(params: URLSearchParams, filters: { username?: string; create_time_from?: string; create_time_to?: string; content?: string; position?: string; message_type?: string }) {
  if (filters.username?.trim()) params.set('username', filters.username.trim())
  if (filters.create_time_from?.trim()) params.set('create_time_from', filters.create_time_from.trim())
  if (filters.create_time_to?.trim()) params.set('create_time_to', filters.create_time_to.trim())
  if (filters.content?.trim()) params.set('content', filters.content.trim())
  if (filters.position?.trim()) params.set('position', filters.position.trim())
  if (filters.message_type?.trim()) params.set('message_type', filters.message_type.trim())
}

export function messageContextRequest(id: number, page: number | undefined, filters: { username?: string; create_time_from?: string; create_time_to?: string; content?: string }) {
  const params = new URLSearchParams({ limit: '30' })
  if (page) params.set('page', String(page))
  appendMessageFilters(params, filters)
  return get<MessageContextResponse>(`/api/user/messages/${id}/context?${params.toString()}`)
}

export function adminMessageContextRequest(id: number, page: number | undefined, filters: { username?: string; create_time_from?: string; create_time_to?: string; content?: string; position?: string; message_type?: string }) {
  const params = new URLSearchParams({ limit: '30' })
  if (page) params.set('page', String(page))
  appendMessageFilters(params, filters)
  return get<MessageContextResponse>(`/api/admin/messages/${id}/context?${params.toString()}`)
}

export function selfRequest() {
  return get<SelfResponse>('/api/user/info/self')
}

export function playerInfoRequest(username: string) {
  return get<SelfResponse>(`/api/user/info/player?username=${encodeURIComponent(username)}`)
}

function historyRequest<T>(path: string, page: number) {
  const safePage = Number.isInteger(page) ? Math.max(1, page) : 1
  return get<HistoryPageResponse<T>>(`${path}?page=${safePage}`).then(result => ({
    ...result,
    items: Array.isArray(result.items) ? result.items.slice(0, USER_HISTORY_PAGE_SIZE) : [],
  }))
}

export function sessionHistoryRequest(page: number) {
  return historyRequest<OnlineSession>('/api/user/info/sessions', page)
}

export function moneyHistoryRequest(page: number) {
  return historyRequest<MoneyHistoryEntry>('/api/user/info/money_history', page)
}

export function avatarRequest(usernames: string[]) {
  const params = new URLSearchParams()
  usernames.slice(0, 50).forEach(username => params.append('username', username))
  return get<AvatarResponse>(`/api/user/info/avatar?${params.toString()}`)
}
