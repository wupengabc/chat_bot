export class RequestError extends Error {
  constructor(public status: number, message: string, public data: unknown = null) {
    super(message)
    this.name = 'RequestError'
  }
}

type RequestOptions = RequestInit & { skipAuthRefresh?: boolean }
let accessTokenProvider: (() => string | null) | undefined
let refreshHandler: (() => Promise<string | null>) | undefined
let refreshPromise: Promise<string | null> | undefined

export function configureRequest(options: {
  getAccessToken: () => string | null
  refreshAccessToken: () => Promise<string | null>
}) {
  accessTokenProvider = options.getAccessToken
  refreshHandler = options.refreshAccessToken
}

export function getAccessToken() { return accessTokenProvider?.() || null }

async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = refreshHandler?.().finally(() => { refreshPromise = undefined }) || Promise.resolve(null)
  }
  return refreshPromise
}

export async function request<T>(url: string, options: RequestOptions = {}, canRefresh = true): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const token = accessTokenProvider?.()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(url, { ...options, headers })
  if (response.status === 401 && canRefresh && !options.skipAuthRefresh) {
    const refreshedToken = await refreshAccessToken()
    if (refreshedToken) return request<T>(url, { ...options, skipAuthRefresh: true }, false)
  }

  const text = await response.text()
  let data: unknown = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!response.ok) {
    const message = typeof data === 'object' && data !== null && 'message' in data
      ? String(data.message)
      : `请求失败（${response.status}）`
    throw new RequestError(response.status, message, data)
  }
  return data as T
}

export const get = <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'GET' })
export const post = <T>(url: string, body: unknown, options?: RequestOptions) => request<T>(url, { ...options, method: 'POST', body: JSON.stringify(body) })
export const patch = <T>(url: string, body: unknown, options?: RequestOptions) => request<T>(url, { ...options, method: 'PATCH', body: JSON.stringify(body) })
export const del = <T>(url: string, options?: RequestOptions) => request<T>(url, { ...options, method: 'DELETE' })

export async function getBlob(url: string, canRefresh = true): Promise<Blob> {
  const headers = new Headers()
  const token = accessTokenProvider?.()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, {headers})
  if (response.status === 401 && canRefresh) {
    const refreshedToken = await refreshAccessToken()
    if (refreshedToken) return getBlob(url, false)
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null) as {message?: string} | null
    throw new RequestError(response.status, data?.message || `请求失败（${response.status}）`, data)
  }
  return response.blob()
}

export async function download(url: string, filename: string) {
  const headers = new Headers()
  const token = accessTokenProvider?.()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  const response = await fetch(url, {headers})
  if (!response.ok) throw new RequestError(response.status, `下载失败（${response.status}）`)
  const objectUrl = URL.createObjectURL(await response.blob())
  const link = document.createElement('a'); link.href = objectUrl; link.download = filename; link.click()
  URL.revokeObjectURL(objectUrl)
}
