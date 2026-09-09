import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { configureRequest, RequestError } from '../utils/request'
import { loginRequest, meRequest, refreshRequest, type AuthTokens, type AuthUser } from '../utils/login'

const storageKey = 'wp-bx-auth'
interface StoredAuth {
  resource_token: string
  refresh_token: string
  user: AuthUser | null
  resourceExpiresAt: number | null
  refreshExpiresAt: number | null
}

export const useAuthStore = defineStore('auth', () => {
  const resourceToken = ref<string | null>(null)
  const refreshToken = ref<string | null>(null)
  const user = ref<AuthUser | null>(null)
  const resourceExpiresAt = ref<number | null>(null)
  const refreshExpiresAt = ref<number | null>(null)
  const initialized = ref(false)
  const isLoggedIn = computed(() => Boolean(resourceToken.value && refreshToken.value && user.value))
  let refreshPromise: Promise<string | null> | undefined
  let refreshTimer: ReturnType<typeof setTimeout> | undefined

  function save() {
    if (typeof localStorage === 'undefined') return
    const value: StoredAuth = {
      resource_token: resourceToken.value || '', refresh_token: refreshToken.value || '', user: user.value,
      resourceExpiresAt: resourceExpiresAt.value, refreshExpiresAt: refreshExpiresAt.value,
    }
    localStorage.setItem(storageKey, JSON.stringify(value))
  }

  function clear() {
    if (refreshTimer) clearTimeout(refreshTimer)
    resourceToken.value = null; refreshToken.value = null; user.value = null
    resourceExpiresAt.value = null; refreshExpiresAt.value = null
    localStorage.removeItem(storageKey)
  }

  function expiry(value?: number) {
    return typeof value === 'number' ? Date.now() + value * 1000 : null
  }

  function applyTokens(tokens: AuthTokens) {
    resourceToken.value = tokens.resource_token
    refreshToken.value = tokens.refresh_token
    resourceExpiresAt.value = expiry(tokens.resource_expires_in ?? tokens.resource_token_expires_in)
    refreshExpiresAt.value = expiry(tokens.refresh_expires_in ?? tokens.refresh_token_expires_in)
    if (tokens.user) user.value = tokens.user
    save()
    scheduleRefresh()
  }

  function scheduleRefresh() {
    if (refreshTimer) clearTimeout(refreshTimer)
    if (!resourceExpiresAt.value || !refreshToken.value) return
    const delay = Math.max(0, resourceExpiresAt.value - Date.now() - 30_000)
    refreshTimer = setTimeout(() => void refreshAccessToken(), delay)
  }

  async function refreshAccessToken() {
    if (!refreshToken.value) return null
    if (refreshExpiresAt.value && Date.now() >= refreshExpiresAt.value) { clear(); return null }
    if (!refreshPromise) {
      refreshPromise = refreshRequest(refreshToken.value)
        .then(tokens => { applyTokens(tokens); return tokens.resource_token })
        .catch(error => {
          if (error instanceof RequestError && (error.status === 400 || error.status === 401)) clear()
          return null
        })
        .finally(() => { refreshPromise = undefined })
    }
    return refreshPromise
  }

  async function login(username: string, password: string) {
    const tokens = await loginRequest(username, password)
    applyTokens(tokens)
    if (!user.value) {
      const profile = await meRequest()
      user.value = profile.user || profile as AuthUser
      save()
    }
  }

  async function loadSession() {
    if (!refreshToken.value) return
    if (resourceExpiresAt.value && Date.now() >= resourceExpiresAt.value) await refreshAccessToken()
    if (!resourceToken.value) return
    try {
      const profile = await meRequest()
      user.value = profile.user || profile as AuthUser
      save()
    } catch (error) {
      if (error instanceof RequestError && error.status === 401) clear()
    }
  }

  async function initialize() {
    if (initialized.value) return
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || 'null') as StoredAuth | null
      if (stored) {
        resourceToken.value = stored.resource_token || null; refreshToken.value = stored.refresh_token || null
        user.value = stored.user || null; resourceExpiresAt.value = stored.resourceExpiresAt || null; refreshExpiresAt.value = stored.refreshExpiresAt || null
        scheduleRefresh()
      }
    } catch { clear() }
    configureRequest({ getAccessToken: () => resourceToken.value, refreshAccessToken })
    initialized.value = true
    await loadSession()
  }

  function logout() { clear() }
  return { user, isLoggedIn, resourceToken, initialize, login, logout, refreshAccessToken }
})
