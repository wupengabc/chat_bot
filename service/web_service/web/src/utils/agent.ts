import {del, get, patch, post, RequestError} from './request'

export type AgentMessageRole = 'user' | 'assistant' | 'tool'

export interface AgentConversation {
  id: number
  owner_username: string | null
  title: string
  visibility: 'private' | 'public'
  public_slug: string | null
  anonymous: boolean
  view_count: number
  created_at: string
  updated_at: string
  message_count?: number
  last_message?: string | null
  workflow_status?: 'draft' | 'running' | 'waiting_for_input' | 'completed' | 'error'
}

export interface AgentMessage {
  id: number
  conversation_id: number
  role: AgentMessageRole
  content: string
  metadata: Record<string, unknown>
  created_at: string
  streaming?: boolean
}

export interface AgentActiveRun {
  run_id: string
  phase: 'thinking' | 'deciding' | 'tool' | 'writing'
  summary: string
  thinking_summary: string
  output: string
  tool_call_id?: string
  tool_name?: string
  label?: string
  input?: unknown
  progress?: {
    phase: 'loading' | 'research' | 'merging'
    current: number
    total: number
    unit?: 'messages' | 'tokens' | 'steps'
    completed_batches?: number
    total_batches?: number
  }
  updated_at: string
}

export interface AgentToolDefinition {
  name: string
  description: string
  inputs: Array<{name: string; required: boolean; description: string}>
}

export interface AgentConversationDetail {
  success: true
  conversation: AgentConversation
  messages: AgentMessage[]
  active_run: AgentActiveRun | null
}

export interface AgentPagination {
  page: number
  limit: number
  total: number
  total_pages: number
}

export interface AgentStreamEvent {
  event: 'workflow.started' | 'workflow.completed' | 'message.started' | 'thinking.started' | 'thinking.delta' | 'thinking.completed' | 'tool.delta' | 'tool.started' | 'tool.progress' | 'tool.cancelled' | 'tool.completed' | 'artifact.created' | 'input.required' | 'suggestions.ready' | 'run.progress' | 'run.paused' | 'message.delta' | 'message.completed' | 'run.completed' | 'run.error'
  data: Record<string, any>
}

function waitForPaint() {
  return new Promise<void>(resolve => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 0)
  })
}

export function listAgentConversations(page = 1) {
  const params = new URLSearchParams({page: String(page), limit: '18'})
  return get<{success: true; conversations: AgentConversation[]; pagination: AgentPagination}>(`/api/agent/conversations?${params}`)
}
export const listAgentTools = () => get<{success: true; tools: AgentToolDefinition[]}>('/api/agent/tools')
export const createAgentConversation = (title?: string) => post<{success: true; conversation: AgentConversation}>('/api/agent/conversations', {title})
export const getAgentConversation = (id: number) => get<AgentConversationDetail>(`/api/agent/conversations/${id}`)
export const renameAgentConversation = (id: number, title: string) => patch<{success: true; conversation: AgentConversation}>(`/api/agent/conversations/${id}`, {title})
export const rollbackAgentConversation = (id: number, messageId: number) =>
  post<AgentConversationDetail>(`/api/agent/conversations/${id}/rollback`, {message_id: messageId})
export const deleteAgentConversation = (id: number) => del<{success: true}>(`/api/agent/conversations/${id}`)
export const publishAgentConversation = (id: number, options: {anonymous: boolean}) =>
  post<{success: true; conversation: AgentConversation}>(`/api/agent/conversations/${id}/publish`, options)
export const unpublishAgentConversation = (id: number) =>
  post<{success: true; conversation: AgentConversation}>(`/api/agent/conversations/${id}/unpublish`, {})

export async function listAgentLobby(page = 1, keyword = '') {
  const params = new URLSearchParams({page: String(page), limit: '18'})
  if (keyword.trim()) params.set('keyword', keyword.trim())
  return get<{success: true; conversations: AgentConversation[]; pagination: AgentPagination}>(`/api/agent/lobby?${params}`)
}

export const getPublicAgentConversation = (slug: string) =>
  get<AgentConversationDetail>(`/api/agent/lobby/${encodeURIComponent(slug)}`)

async function responseMessage(response: Response) {
  const text = await response.text()
  try {
    const data = JSON.parse(text) as {message?: string}
    return data.message || `请求失败（${response.status}）`
  } catch {
    return text || `请求失败（${response.status}）`
  }
}

export async function streamAgentMessage(
  conversationId: number,
  content: string,
  getAccessToken: () => string | null,
  refreshAccessToken: () => Promise<string | null>,
  onEvent: (event: AgentStreamEvent) => void,
  options: {publish?: boolean; anonymous?: boolean} = {},
) {
  async function execute(canRefresh: boolean): Promise<void> {
    const headers = new Headers({'Content-Type': 'application/json'})
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`/api/agent/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({content, ...options}),
    })
    if (response.status === 401 && canRefresh) {
      const refreshed = await refreshAccessToken()
      if (refreshed) return execute(false)
    }
    if (!response.ok || !response.body) throw new RequestError(response.status, await responseMessage(response))

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const {done, value} = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), {stream: !done}).replace(/\r\n/g, '\n')
      let shouldPaint = false
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim()
        const dataLine = block.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim()
        if (event && dataLine) {
          try {
            onEvent({event: event as AgentStreamEvent['event'], data: JSON.parse(dataLine)})
            shouldPaint ||= event === 'message.delta' || event === 'thinking.delta' || event === 'tool.delta' || event === 'tool.progress'
          } catch {}
        }
        boundary = buffer.indexOf('\n\n')
      }
      if (shouldPaint && !done) await waitForPaint()
      if (done) break
    }
  }
  await execute(true)
}

export async function streamAgentConversation(
  conversationId: number,
  getAccessToken: () => string | null,
  refreshAccessToken: () => Promise<string | null>,
  onEvent: (event: {event: string; data: Record<string, any>}) => void,
  signal: AbortSignal,
) {
  async function execute(canRefresh: boolean): Promise<void> {
    const headers = new Headers()
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`/api/agent/conversations/${conversationId}/stream`, {headers, signal})
    if (response.status === 401 && canRefresh) {
      const refreshed = await refreshAccessToken()
      if (refreshed) return execute(false)
    }
    if (!response.ok || !response.body) throw new RequestError(response.status, await responseMessage(response))
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const {done, value} = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), {stream: !done}).replace(/\r\n/g, '\n')
      let shouldPaint = false
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim()
        const dataLine = block.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim()
        if (event && dataLine) {
          try {
            onEvent({event, data: JSON.parse(dataLine)})
            shouldPaint ||= event === 'message.delta' || event === 'thinking.delta' || event === 'tool.delta' || event === 'tool.progress'
          } catch {}
        }
        boundary = buffer.indexOf('\n\n')
      }
      if (shouldPaint && !done) await waitForPaint()
      if (done) break
    }
  }
  await execute(true)
}

export async function streamPublicAgentConversation(
  slug: string,
  getAccessToken: () => string | null,
  refreshAccessToken: () => Promise<string | null>,
  onEvent: (event: {event: string; data: Record<string, any>}) => void,
  signal: AbortSignal,
) {
  async function execute(canRefresh: boolean): Promise<void> {
    const headers = new Headers()
    const token = getAccessToken()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`/api/agent/lobby/${encodeURIComponent(slug)}/stream`, {headers, signal})
    if (response.status === 401 && canRefresh) {
      const refreshed = await refreshAccessToken()
      if (refreshed) return execute(false)
    }
    if (!response.ok || !response.body) throw new RequestError(response.status, await responseMessage(response))
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const {done, value} = await reader.read()
      buffer += decoder.decode(value || new Uint8Array(), {stream: !done}).replace(/\r\n/g, '\n')
      let shouldPaint = false
      let boundary = buffer.indexOf('\n\n')
      while (boundary >= 0) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim()
        const dataLine = block.split('\n').find(line => line.startsWith('data:'))?.slice(5).trim()
        if (event && dataLine) {
          try {
            onEvent({event, data: JSON.parse(dataLine)})
            shouldPaint ||= event === 'message.delta' || event === 'thinking.delta' || event === 'tool.delta' || event === 'tool.progress'
          } catch {}
        }
        boundary = buffer.indexOf('\n\n')
      }
      if (shouldPaint && !done) await waitForPaint()
      if (done) break
    }
  }
  await execute(true)
}
