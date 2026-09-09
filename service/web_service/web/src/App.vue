<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BaseDialog from './components/BaseDialog.vue'
import GlobalAlert from './components/GlobalAlert.vue'
import UserAvatar from './components/UserAvatar.vue'
import BaseTooltip from './components/BaseTooltip.vue'
import MusicPlayer from './components/MusicPlayer.vue'
import MusicPictureInPicture from './components/MusicPictureInPicture.vue'
import BaseSelect from './components/BaseSelect.vue'
import { useThemeStore, type ThemeMode, type ThemePalette } from './stores/theme'
import { useAuthStore } from './stores/auth'
import { useAlertStore } from './stores/alert'
import { usePlayerInfoStore } from './stores/playerInfo'
import { useMusicPlayerStore } from './stores/musicPlayer'
import { useSelfInfoStore } from './stores/selfInfo'
import { useAvatarStore } from './stores/avatar'
import { useHomeViewStore } from './stores/homeView'
import { closeLogin, loginDialogOpen, loginRequired, openLogin, takeIntendedRoute } from './router'
import { apiKeyStatusRequest, createApiKeyRequest, gameInfoRequest, pointLogsRequest, type PointLog, type PointLogCategory } from './utils/login'

const mobileOpen = ref(false)
const leftNavVisible = ref(true)
const themeStore = useThemeStore()
const authStore = useAuthStore()
const alertStore = useAlertStore()
const playerInfo = usePlayerInfoStore()
const musicPlayer = useMusicPlayerStore()
const selfInfo = useSelfInfoStore()
const avatarStore = useAvatarStore()
const homeViewStore = useHomeViewStore()
const route = useRoute()
const router = useRouter()
const themeDialogOpen = ref(false)
const username = ref('')
const password = ref('')
const loginError = ref('')
const loginLoading = ref(false)
const accountMenuOpen = ref(false)
const pointLogsOpen = ref(false)
const pointLogsLoading = ref(false)
const pointLogsError = ref('')
const pointLogs = ref<PointLog[]>([])
const pointLogsPage = ref(1)
const pointLogsTotalPages = ref(1)
const pointLogsTotal = ref(0)
const pointLogsCategory = ref<PointLogCategory>('all')
const pointRechargeOpen = ref(false)
const pointRechargeAmount = ref('1')
const gameBotUsername = ref('')
const gameInfoLoading = ref(false)
let pointLogsRequestId = 0
const pointLogCategoryOptions: Array<{ label: string; value: PointLogCategory }> = [
  { label: '全部分类', value: 'all' },
  { label: '每日签到', value: 'sign' },
  { label: '积分充值', value: 'recharge' },
  { label: '玩家查询', value: 'player_info' },
  { label: 'AI Agent', value: 'agent' },
  { label: '地图分享', value: 'map_share' },
  { label: '公共 API', value: 'public_api' },
  { label: '商店服务', value: 'shop' },
  { label: '管理员调整', value: 'admin' },
  { label: '其他', value: 'manual' },
]
const pointLogCategoryLabels = Object.fromEntries(pointLogCategoryOptions.filter(option => option.value !== 'all').map(option => [option.value, option.label])) as Record<PointLog['category'], string>
const apiKeyDialogOpen = ref(false)
const apiKeyConfirmOpen = ref(false)
const apiKeyRevealOpen = ref(false)
const apiKeyConfigured = ref(false)
const apiKeyLoading = ref(false)
const apiKeyError = ref('')
const revealedApiKey = ref('')
const musicDialogOpen = ref(false)
const musicPipWindow = ref<Window | null>(null)
let musicPipOpening = false
let musicPipRequest = 0
let musicPipStyleObserver: MutationObserver | null = null
let musicPipStyleSyncFrame = 0
const miniPlayerTitle = computed(() => musicPlayer.loading ? '正在读取歌单' : musicPlayer.current ? musicPlayer.currentLyric : '导航音乐')
const miniPlayerSubtitle = computed(() => musicPlayer.current ? musicPlayer.artist : musicPlayer.loadError || (musicPlayer.loaded ? '未配置导航歌单' : '准备中'))
const miniPlayerState = computed(() => musicPlayer.loading ? 'loading' : musicPlayer.loadError ? 'error' : musicPlayer.current ? (musicPlayer.playing ? 'playing' : 'paused') : 'empty')
const pointRechargeCommand = computed(() => {
  const amount = Number(pointRechargeAmount.value)
  if (!gameBotUsername.value || !Number.isFinite(amount) || amount <= 0) return ''
  return `/pay ${gameBotUsername.value} ${pointRechargeAmount.value.trim()}`
})
const miniTitle = ref<HTMLElement | null>(null)
const miniTitleOverflow = ref(false)
const miniTitleTravel = ref(0)
const navLeftStage = ref<HTMLElement | null>(null)
const defaultNavPanel = ref<HTMLElement | null>(null)
const adminNavPanel = ref<HTMLElement | null>(null)

const isAdminUser = computed(() => {
  const role = authStore.user?.role
  return role === 'admin' || role === 'owner'
})

const isAdminRoute = computed(() => route.path.startsWith('/admin'))

const navItems = computed(() => {
  const items = [
    { label: '首页', to: '/' },
    { label: '数据探索', to: '/explore' },
    { label: '玩家分享', to: '/shares' },
    { label: 'AI Agent', to: '/agent' },
  ]
  if (isAdminUser.value) {
    items.push({ label: '管理中心', to: '/admin' })
  }
  return items
})

const adminNavItems = [
  { label: '后台管理', to: '/admin' },
  { label: '数据管理', to: '/admin/data' },
  { label: '分享管理', to: '/admin/shares' },
  { label: '系统管理', to: '/admin/settings' },
]

function syncLeftNavWidth(animate = true) {
  const stage = navLeftStage.value
  const panel = isAdminRoute.value ? adminNavPanel.value : defaultNavPanel.value
  if (!stage || !panel) return

  stage.style.transitionDuration = animate ? '' : '0s'
  stage.style.width = `${panel.scrollWidth}px`
  if (!animate) {
    window.requestAnimationFrame(() => {
      stage.style.transitionDuration = ''
    })
  }
}

function syncMiniTitleOverflow() {
  void nextTick(() => {
    const title = miniTitle.value
    const viewport = title?.closest('.music-title-viewport')
    const travel = title && viewport ? Math.ceil(title.scrollWidth - viewport.clientWidth) : 0
    miniTitleOverflow.value = travel > 1
    miniTitleTravel.value = title && viewport ? Math.ceil(title.scrollWidth + 28) : 0
  })
}

function closeMenus() {
  mobileOpen.value = false
  themeDialogOpen.value = false
  closeLogin()
  accountMenuOpen.value = false
}

type DocumentPictureInPicture = {
  window: Window | null
  requestWindow(options?: { width?: number; height?: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }): Promise<Window>
}

function documentPictureInPicture() {
  return (window as Window & { documentPictureInPicture?: DocumentPictureInPicture }).documentPictureInPicture ?? null
}

function syncPictureInPictureStyles(source: Document, target: Document) {
  target.documentElement.className = source.documentElement.className
  for (const name of source.documentElement.getAttributeNames()) {
    if (name !== 'class') target.documentElement.setAttribute(name, source.documentElement.getAttribute(name) || '')
  }
  target.documentElement.style.cssText = source.documentElement.style.cssText
  target.body.className = `${source.body.className} music-pip-document`.trim()
  target.body.style.cssText = source.body.style.cssText
  target.head.querySelectorAll('[data-music-pip-style]').forEach(element => element.remove())
  const styleSheets = [...source.styleSheets, ...source.adoptedStyleSheets]
  for (const styleSheet of styleSheets) {
    try {
      const style = target.createElement('style')
      style.dataset.musicPipStyle = 'true'
      style.textContent = [...styleSheet.cssRules].map(rule => rule.cssText).join('\n')
      target.head.appendChild(style)
    } catch {
      if (!styleSheet.href) continue
      const link = target.createElement('link')
      link.dataset.musicPipStyle = 'true'
      link.rel = 'stylesheet'
      link.href = styleSheet.href
      target.head.appendChild(link)
    }
  }
}

function clonePictureInPictureStyles(source: Document, target: Document) {
  target.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(element => element.remove())
  target.body.innerHTML = ''
  syncPictureInPictureStyles(source, target)
}

function observePictureInPictureStyles() {
  if (!import.meta.env.DEV || musicPipStyleObserver) return
  musicPipStyleObserver = new MutationObserver(() => {
    const pipWindow = musicPipWindow.value
    if (!pipWindow || pipWindow.closed) return
    cancelAnimationFrame(musicPipStyleSyncFrame)
    musicPipStyleSyncFrame = requestAnimationFrame(() => {
      if (musicPipWindow.value && !musicPipWindow.value.closed) syncPictureInPictureStyles(document, musicPipWindow.value.document)
    })
  })
  musicPipStyleObserver.observe(document.head, { childList: true, subtree: true, characterData: true })
}

const MUSIC_PICTURE_IN_PICTURE_SIZE = { width: 282, height: 161 }

function closeMusicPictureInPicture() {
  musicPipRequest += 1
  if (!musicPipWindow.value || musicPipWindow.value.closed) {
    musicPipWindow.value = null
    return
  }
  musicPipWindow.value.close()
  musicPipWindow.value = null
}

async function openMusicPictureInPicture(origin: 'auto' | 'user' = 'auto') {
  const api = documentPictureInPicture()
  if (!authStore.isLoggedIn || !api || musicPipOpening || musicPipWindow.value || !musicPlayer.autoPictureInPicture || !musicPlayer.autoPictureInPictureConfirmed || !musicPlayer.playing) return false
  const request = ++musicPipRequest
  musicPipOpening = true
  try {
    const reusedWindow = Boolean(api.window && !api.window.closed)
    const nextWindow = reusedWindow && api.window ? api.window : await api.requestWindow({
      width: MUSIC_PICTURE_IN_PICTURE_SIZE.width,
      height: MUSIC_PICTURE_IN_PICTURE_SIZE.height,
      preferInitialWindowPlacement: true,
    })
    if (!reusedWindow) {
      try {
        nextWindow.resizeTo(MUSIC_PICTURE_IN_PICTURE_SIZE.width, MUSIC_PICTURE_IN_PICTURE_SIZE.height)
      } catch {
        // Chrome may reject resizing when the opener transient activation has expired.
      }
    }
    if (request !== musicPipRequest || (origin === 'auto' && !document.hidden)) {
      if (!reusedWindow) nextWindow.close()
      return false
    }
    clonePictureInPictureStyles(document, nextWindow.document)
    nextWindow.document.title = `${musicPlayer.title} - ${musicPlayer.playlistName}`
    nextWindow.addEventListener('pagehide', () => {
      if (musicPipWindow.value === nextWindow) musicPipWindow.value = null
    }, { once: true })
    musicPipWindow.value = nextWindow
    return true
  } catch (error) {
    if (request === musicPipRequest) musicPipWindow.value = null
    console.warn('[音乐画中画] 打开失败', error)
    return false
  } finally {
    musicPipOpening = false
  }
}

function requestMusicPictureInPicture(origin: 'auto' | 'user' = 'user') {
  void openMusicPictureInPicture(origin)
}

function handleMusicPictureInPictureVisibility() {
  if (document.hidden) requestMusicPictureInPicture('auto')
}

function formatPointLogDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value || '-' : new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date)
}

async function loadPointLogs(page = 1) {
  const requestId = ++pointLogsRequestId
  pointLogsLoading.value = true
  pointLogsError.value = ''
  try {
    const result = await pointLogsRequest(page, pointLogsCategory.value)
    if (requestId !== pointLogsRequestId) return
    pointLogs.value = result.logs
    pointLogsPage.value = result.pagination.page
    pointLogsTotalPages.value = result.pagination.total_pages
    pointLogsTotal.value = result.pagination.total
  } catch (error) {
    if (requestId !== pointLogsRequestId) return
    pointLogsError.value = error instanceof Error ? error.message : '无法读取积分流水'
  } finally {
    if (requestId === pointLogsRequestId) pointLogsLoading.value = false
  }
}

function openPointLogs() {
  accountMenuOpen.value = false
  pointLogsOpen.value = true
  pointLogs.value = []
  pointLogsCategory.value = 'all'
  pointLogsPage.value = 1
  void loadPointLogs(1)
}

function changePointLogCategory(value: string) {
  pointLogsCategory.value = value as PointLogCategory
  pointLogsPage.value = 1
  void loadPointLogs(1)
}

async function loadGameInfo() {
  gameInfoLoading.value = true
  try {
    gameBotUsername.value = (await gameInfoRequest()).bot_username || ''
  } catch {
    gameBotUsername.value = ''
  } finally {
    gameInfoLoading.value = false
  }
}

function openPointRecharge() {
  pointRechargeOpen.value = true
  void loadGameInfo()
}

async function copyPointRechargeCommand() {
  if (!pointRechargeCommand.value) return
  try {
    await navigator.clipboard.writeText(pointRechargeCommand.value)
    alertStore.success('已复制', '请在游戏内在线时发送这条转账命令。')
  } catch {
    alertStore.error('复制失败', '请手动复制转账命令。')
  }
}

async function openApiKeyDialog() {
  accountMenuOpen.value = false
  apiKeyDialogOpen.value = true
  apiKeyLoading.value = true
  apiKeyError.value = ''
  try {
    apiKeyConfigured.value = (await apiKeyStatusRequest()).configured
  } catch (error) {
    apiKeyError.value = error instanceof Error ? error.message : '无法读取 API key 状态'
  } finally {
    apiKeyLoading.value = false
  }
}

async function createApiKey() {
  apiKeyConfirmOpen.value = false
  apiKeyLoading.value = true
  apiKeyError.value = ''
  try {
    revealedApiKey.value = (await createApiKeyRequest()).apikey
    apiKeyConfigured.value = true
    apiKeyDialogOpen.value = false
    apiKeyRevealOpen.value = true
  } catch (error) {
    apiKeyError.value = error instanceof Error ? error.message : '无法创建 API key'
  } finally {
    apiKeyLoading.value = false
  }
}

async function copyApiKey() {
  if (!revealedApiKey.value) return
  try {
    await navigator.clipboard.writeText(revealedApiKey.value)
    alertStore.success('已复制', 'API key 已复制到剪贴板。')
  } catch {
    alertStore.error('复制失败', '请手动选择并复制 API key。')
  }
}

function closeApiKeyReveal() {
  apiKeyRevealOpen.value = false
  revealedApiKey.value = ''
}

async function submitLogin() {
  loginError.value = ''
  if (!username.value.trim() || !password.value) {
    alertStore.warning('登录信息不完整', '请输入游戏用户名和密码。')
    return
  }
  loginLoading.value = true
  try {
    await authStore.login(username.value.trim(), password.value)
    const intendedRoute = takeIntendedRoute()
    closeLogin()
    password.value = ''
    alertStore.success('登录成功', `欢迎回来，${authStore.user?.username || authStore.user?.name || username.value}。`)
    if (intendedRoute) await router.replace(intendedRoute)
  } catch (error) {
    loginError.value = error instanceof Error ? error.message : '登录失败，请稍后重试'
    alertStore.error('登录失败', loginError.value)
  } finally {
    loginLoading.value = false
  }
}

async function logout() {
  accountMenuOpen.value = false
  musicDialogOpen.value = false
  disposeMusicPlayer()
  musicPlayer.resetSession()
  authStore.logout()
  selfInfo.clear()
  avatarStore.clear()
  alertStore.info('已退出登录', '本地登录凭据已清除。')
}

let previousScrollY = 0
let workspaceDesktopLocked = false

function handleScroll() {
  const currentScrollY = window.scrollY
  if (currentScrollY <= 12) {
    leftNavVisible.value = true
  } else if (currentScrollY > previousScrollY + 2) {
    leftNavVisible.value = false
    mobileOpen.value = false
  } else if (currentScrollY < previousScrollY - 2) {
    leftNavVisible.value = true
  }
  previousScrollY = currentScrollY
}
function disposeMusicPlayer() {
  closeMusicPictureInPicture()
  musicPlayer.dispose()
}

onMounted(() => {
  observePictureInPictureStyles()
  window.addEventListener('scroll', handleScroll, { passive: true })
  window.addEventListener('resize', handleWorkspaceResize, { passive: true })
  window.addEventListener('pagehide', disposeMusicPlayer)
  document.addEventListener('visibilitychange', handleMusicPictureInPictureVisibility)
  musicPlayer.setPictureInPictureRequestHandler(reason => requestMusicPictureInPicture(reason === 'contentoccluded' ? 'auto' : 'user'))
  void authStore.initialize().then(() => {
    if (authStore.isLoggedIn) void musicPlayer.fetchPage(1).finally(syncMiniTitleOverflow)
  })
  if (loginDialogOpen.value) void loadGameInfo()
  if (route.path === '/') playerInfo.start()
  if (authStore.isLoggedIn) void selfInfo.load()
  if (authStore.isLoggedIn && authStore.user?.username) void avatarStore.load([authStore.user.username])
  updateWorkspaceScrollLock()
  void nextTick(() => syncLeftNavWidth(false))
})
onUnmounted(() => {
  musicPipStyleObserver?.disconnect()
  musicPipStyleObserver = null
  cancelAnimationFrame(musicPipStyleSyncFrame)
  window.removeEventListener('scroll', handleScroll)
  window.removeEventListener('resize', handleWorkspaceResize)
  window.removeEventListener('pagehide', disposeMusicPlayer)
  document.removeEventListener('visibilitychange', handleMusicPictureInPictureVisibility)
  musicPlayer.setPictureInPictureRequestHandler(null)
  disposeMusicPlayer()
  playerInfo.stop()
})

watch(loginRequired, (required, wasRequired) => {
  if (required && !wasRequired) {
    alertStore.warning('需要登录', '请先登录后再访问该页面。')
  }
}, { immediate: true })

watch(loginDialogOpen, open => {
  if (open) void loadGameInfo()
})

watch(() => authStore.isLoggedIn, isLoggedIn => {
  if (isLoggedIn) {
    musicPlayer.setPictureInPictureRequestHandler(reason => requestMusicPictureInPicture(reason === 'contentoccluded' ? 'auto' : 'user'))
    void selfInfo.load()
    if (!musicPlayer.loaded && !musicPlayer.loading) void musicPlayer.fetchPage(1).finally(syncMiniTitleOverflow)
  }
  if (!isLoggedIn) {
    musicDialogOpen.value = false
    disposeMusicPlayer()
    musicPlayer.resetSession()
  }
  if (isLoggedIn && authStore.user?.username) void avatarStore.load([authStore.user.username])
  else { selfInfo.clear(); avatarStore.clear() }
})

function handleWorkspaceResize() {
  updateWorkspaceScrollLock(true)
  window.requestAnimationFrame(() => syncLeftNavWidth(false))
  syncMiniTitleOverflow()
}

function updateWorkspaceScrollLock(transferScroll = false) {
  const shouldLock = authStore.isLoggedIn && route.path === '/' && homeViewStore.activeView === 'profile' && window.innerWidth >= 761
  if (shouldLock === workspaceDesktopLocked) {
    document.documentElement.classList.toggle('workspace-lock', shouldLock)
    return
  }
  const workspaceScrollPosition = shouldLock
    ? window.scrollY
    : document.querySelector<HTMLElement>('.workspace-scroll')?.scrollTop ?? window.scrollY
  workspaceDesktopLocked = shouldLock
  document.documentElement.classList.toggle('workspace-lock', shouldLock)
  if (!transferScroll) {
    if (shouldLock) {
      window.scrollTo(0, 0)
      previousScrollY = 0
      leftNavVisible.value = true
    }
    return
  }
  if (shouldLock) {
    window.scrollTo(0, 0)
    previousScrollY = 0
    leftNavVisible.value = true
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>('.workspace-scroll')?.scrollTo(0, workspaceScrollPosition)
    })
  } else {
    window.requestAnimationFrame(() => window.scrollTo(0, workspaceScrollPosition))
  }
}

watch([() => authStore.isLoggedIn, () => route.path, () => homeViewStore.activeView], () => updateWorkspaceScrollLock(), { immediate: true })
watch(() => route.path, path => {
  if (path === '/') playerInfo.start()
  else playerInfo.stop()
})
watch(isAdminRoute, () => {
  void nextTick(() => syncLeftNavWidth())
})
watch(isAdminUser, () => {
  void nextTick(() => syncLeftNavWidth(false))
})
watch(miniPlayerTitle, syncMiniTitleOverflow)
</script>

<template>
    <main class="page" :class="{ 'workspace-route': authStore.isLoggedIn && route.path === '/' && homeViewStore.activeView === 'profile', 'server-route': route.path === '/' && homeViewStore.activeView === 'server', 'explore-route': route.path === '/explore' || route.path === '/shares', 'agent-route': route.path === '/agent', 'admin-route': isAdminRoute }" @click.self="closeMenus">
    <nav class="navbar" aria-label="主导航">
      <div class="nav-island nav-left" :class="{ 'is-hidden': !leftNavVisible }">
        <div ref="navLeftStage" class="nav-left-stage">
          <div
            ref="adminNavPanel"
            class="nav-left-panel admin-panel"
            :class="{ 'is-active': isAdminRoute }"
            :aria-hidden="!isAdminRoute"
            :inert="!isAdminRoute"
          >
            <BaseTooltip text="返回主页">
              <RouterLink class="brand admin-brand" to="/" aria-label="返回主页">
                <svg class="home-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              </RouterLink>
            </BaseTooltip>
            <div class="nav-items">
              <RouterLink
                v-for="item in adminNavItems"
                :key="item.label"
                class="nav-link admin-nav-link"
                active-class="active"
                :to="item.to"
                :exact="item.to === '/admin'"
              >
                {{ item.label }}
              </RouterLink>
            </div>
          </div>
          <div
            ref="defaultNavPanel"
            class="nav-left-panel default-panel"
            :class="{ 'is-active': !isAdminRoute }"
            :aria-hidden="isAdminRoute"
            :inert="isAdminRoute"
          >
            <RouterLink class="brand" to="/" aria-label="WP BX INFO 首页">
              <img class="brand-mark" src="/bx_logo.png" alt="BX" />
              <span>WP BX INFO</span>
            </RouterLink>
            <div class="nav-items">
              <RouterLink
                v-for="item in navItems"
                :key="item.label"
                class="nav-link"
                active-class="active"
                :to="item.to"
              >
                {{ item.label }}
              </RouterLink>
            </div>
          </div>
        </div>
      </div>

      <div class="nav-island nav-right">
        <BaseTooltip v-if="authStore.isLoggedIn" :text="musicPlayer.current ? `${musicPlayer.title} - ${musicPlayer.artist}` : miniPlayerSubtitle">
          <div class="music-player" :class="`music-player--${miniPlayerState}`" :style="{ '--music-progress': `${musicPlayer.progress * 100}%` }" role="group">
            <button class="music-player-info" aria-label="打开音乐播放器" @click="musicDialogOpen = true">
              <span class="music-artwork">
                <img class="music-cover" :src="musicPlayer.playerCover" alt="当前歌曲封面" />
                <svg v-if="miniPlayerState === 'loading'" class="music-state-icon music-loading-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8" /><path d="M12 4a8 8 0 0 1 8 8" /></svg>
                <svg v-else-if="miniPlayerState === 'empty'" class="music-state-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4.5 18 5-5 3.5 3 2-2 4.5 4" /></svg>
                <svg v-else-if="miniPlayerState === 'error'" class="music-state-icon music-error-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5M12 16h.01" /></svg>
              </span>
              <span class="music-copy"><span class="music-title-viewport"><b :class="{ marquee: miniTitleOverflow }" :style="{ '--marquee-distance': `${miniTitleTravel}px` }"><span ref="miniTitle">{{ miniPlayerTitle }}</span><span v-if="miniTitleOverflow" aria-hidden="true">{{ miniPlayerTitle }}</span></b></span><small v-if="musicPlayer.current">歌手：{{ miniPlayerSubtitle }}</small><small v-else>{{ miniPlayerSubtitle }}</small></span>
            </button>
            <button class="music-control" :disabled="!musicPlayer.current || musicPlayer.loading" :aria-label="musicPlayer.playing ? '暂停音乐' : '播放音乐'" @click="musicPlayer.toggle">
              <span class="music-control-icon" :class="{ pause: musicPlayer.playing }" aria-hidden="true"><i /><i /></span>
            </button>
            <div v-if="musicPlayer.current" class="music-playback-row" aria-hidden="true"><span class="music-progress-line"><i :style="{ width: `${musicPlayer.progress * 100}%` }" /></span><span class="music-bars" :class="{ active: musicPlayer.playing }"><i v-for="(level, index) in musicPlayer.visualizerLevels" :key="index" :style="{ transform: `scaleY(${.22 + level})` }" /></span></div>
          </div>
        </BaseTooltip>
        <BaseTooltip :text="playerInfo.available ? '来自 BOT 的实时在线人数' : 'Bot 不在线或暂时无法获取实时人数'">
          <button class="status-button" :class="{ unavailable: !playerInfo.available }">
          <i class="online-dot" :class="{ muted: !playerInfo.available }" />
           <span class="desktop-status">{{ !playerInfo.playersLoaded || playerInfo.playersLoading ? '获取中...' : playerInfo.available ? `${playerInfo.playerCount} 在线` : 'BOT 离线' }}</span>
           <span class="mobile-status">{{ !playerInfo.playersLoaded || playerInfo.playersLoading ? '…' : playerInfo.available ? playerInfo.playerCount : '离线' }}</span>
          </button>
        </BaseTooltip>
        <BaseTooltip v-if="authStore.isLoggedIn" text="当前账户可用积分">
          <span class="points-control"><button class="points-button" aria-label="查看积分充值方式" @click="openPointRecharge"><span class="coin">✦</span><span>{{ selfInfo.user ? ((selfInfo.user.point || 0) / 100).toFixed(2) : '…' }}</span><b>积分</b></button><button class="points-add-button" aria-label="充值积分" type="button" @click="openPointRecharge">+</button></span>
        </BaseTooltip>
        <BaseTooltip text="选择明暗模式与配色方案">
          <button class="theme-button" aria-label="打开主题设置" @click.stop="themeDialogOpen = true">
          <span class="theme-icon" aria-hidden="true">{{ themeStore.icon }}</span>
          <span class="theme-label">主题</span>
          </button>
        </BaseTooltip>
        <span class="account-slot" :class="{ authenticated: authStore.isLoggedIn }">
          <Transition name="account" mode="out-in">
            <span v-if="!authStore.isLoggedIn" key="login" class="account-view account-login-view">
              <BaseTooltip text="登录后查看个人档案">
                <button class="login-button" @click.stop="openLogin">登录</button>
              </BaseTooltip>
            </span>
            <span v-else key="user" class="account-view account-user-view">
              <span class="account-menu-wrap">
                <button class="user-button" :aria-expanded="accountMenuOpen" aria-haspopup="menu" @click.stop="accountMenuOpen = !accountMenuOpen">
                  <UserAvatar :username="authStore.user?.username || authStore.user?.name" :url="avatarStore.get(authStore.user?.username)" :loading="avatarStore.loading" />
                  <span class="user-copy"><strong>{{ authStore.user?.username || authStore.user?.name || '已登录' }}</strong><small>{{ authStore.user?.role || '玩家账户' }}</small></span>
                  <span class="user-exit" aria-hidden="true">↗</span>
                </button>
                <Transition name="account-menu">
                  <div v-if="accountMenuOpen" class="account-menu" role="menu">
                    <button role="menuitem" @click="openPointLogs"><span>积分流水</span><b>↗</b></button>
                    <button role="menuitem" @click="openApiKeyDialog"><span>API Key</span><b>↗</b></button>
                    <button class="logout-menu-item" role="menuitem" @click="logout"><span>退出登录</span><b>↗</b></button>
                  </div>
                </Transition>
              </span>
            </span>
          </Transition>
        </span>
        <button class="mobile-menu-button" :aria-expanded="mobileOpen" :aria-label="mobileOpen ? '关闭菜单' : '打开菜单'" @click.stop="mobileOpen = !mobileOpen">{{ mobileOpen ? '×' : '☰' }}</button>
      </div>
      <Transition name="mobile-nav">
        <div v-if="mobileOpen" class="mobile-nav-menu" :class="{ 'admin-mode': isAdminRoute }">
          <template v-if="isAdminRoute">
            <RouterLink
              v-for="(item, index) in adminNavItems"
              :key="item.label"
              class="mobile-nav-link"
              active-class="active"
              :to="item.to"
              :exact="item.to === '/admin'"
              @click="mobileOpen = false"
            >
              <span>0{{ index + 1 }}</span><strong>{{ item.label }}</strong><b aria-hidden="true">↗</b>
            </RouterLink>
            <RouterLink
              class="mobile-nav-link home-link"
              to="/"
              @click="mobileOpen = false"
            >
              <span>←</span><strong>返回主页</strong><b aria-hidden="true">↗</b>
            </RouterLink>
          </template>
          <template v-else>
            <RouterLink
              v-for="(item, index) in navItems"
              :key="item.label"
              class="mobile-nav-link"
              active-class="active"
              :to="item.to"
              @click="mobileOpen = false"
            >
              <span>0{{ index + 1 }}</span><strong>{{ item.label }}</strong><b aria-hidden="true">↗</b>
            </RouterLink>
          </template>
        </div>
      </Transition>
    </nav>
    <MusicPlayer v-if="authStore.isLoggedIn" :open="musicDialogOpen" @close="musicDialogOpen = false" />
    <MusicPictureInPicture v-if="authStore.isLoggedIn" :pip-window="musicPipWindow" />

    <BaseDialog :open="authStore.isLoggedIn && musicPlayer.automationVerificationRequired" :dismissible="false" title="正在验证是否真人访问">
      <section class="autoplay-verification" aria-live="assertive">
        <span class="autoplay-verification-mark" aria-hidden="true"><i /><i /><i /></span>
        <div><strong>正在验证是否真人访问</strong></div>
        <button type="button" @click="musicPlayer.confirmMusicAutomation">确定访问<span aria-hidden="true">→</span></button>
      </section>
    </BaseDialog>

    <BaseDialog :open="themeDialogOpen" title="主题设置" @close="themeDialogOpen = false">
      <p class="theme-dialog-intro">选择适合当前环境的界面配色。</p>
      <div class="theme-options">
        <button v-for="option in ([
          { value: 'system', icon: '◐', label: '跟随系统', description: '根据操作系统自动切换' },
          { value: 'light', icon: '☼', label: '浅色模式', description: '清晰、明亮的纸张配色' },
          { value: 'dark', icon: '☾', label: '深色模式', description: '适合夜间使用的森林配色' },
        ] as { value: ThemeMode; icon: string; label: string; description: string }[])" :key="option.value" class="theme-option" :class="{ selected: themeStore.mode === option.value }" @click="themeStore.setMode(option.value)">
          <span class="option-icon">{{ option.icon }}</span>
          <span><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
          <span v-if="themeStore.mode === option.value" class="option-check">✓</span>
        </button>
      </div>
      <p class="theme-dialog-intro palette-title">配色方案</p>
      <div class="palette-options">
        <button v-for="option in ([
          { value: 'forest', label: '森林绿', color: '#719b40' },
          { value: 'md-blue', label: 'MD 蓝白', color: '#1976d2' },
          { value: 'violet', label: '紫罗兰', color: '#805ad5' },
          { value: 'amber', label: '琥珀橙', color: '#c17812' },
        ] as { value: ThemePalette; label: string; color: string }[])" :key="option.value" class="palette-option" :class="{ selected: themeStore.palette === option.value }" @click="themeStore.setPalette(option.value)">
          <i :style="{ backgroundColor: option.color }" />
          <span>{{ option.label }}</span>
          <b v-if="themeStore.palette === option.value">✓</b>
        </button>
      </div>
    </BaseDialog>

    <BaseDialog :open="loginDialogOpen" title="账户登录" size="wide" @close="closeLogin">
      <div class="login-layout">
        <aside class="account-help">
          <div class="help-brand"><img src="/bx_logo.png" alt="" /><span>WP BX INFO<small>GAME ACCOUNT</small></span></div>
          <div class="help-copy"><span>GAME COMMAND</span><h3>账户管理在游戏内完成</h3><p v-if="gameBotUsername">进入服务器后私信 <b>{{ gameBotUsername }}</b>，不要在公共频道发送密码。</p><p v-else>{{ gameInfoLoading ? '正在读取机器人用户名...' : '机器人当前不可用，请稍后再试。' }}</p></div>
          <template v-if="gameBotUsername">
            <div class="command-row"><span>注册</span><code>/tell {{ gameBotUsername }} reg 密码 重复密码</code></div>
            <div class="command-row"><span>改密</span><code>/tell {{ gameBotUsername }} cpwd 密码 重复密码</code></div>
          </template>
          <small>命令中的两次密码必须完全一致。</small>
        </aside>
        <section class="login-main">
          <div class="login-heading"><strong>欢迎回来</strong><p>使用你的邦溪游戏账户继续</p></div>
          <form class="login-form" @submit.prevent="submitLogin">
            <label><span>游戏用户名</span><input v-model="username" autocomplete="username" placeholder="例如：Steve" /></label>
            <label><span>账户密码</span><input v-model="password" type="password" autocomplete="current-password" placeholder="输入密码" /></label>
            <button class="login-submit" type="submit" :disabled="loginLoading"><span>{{ loginLoading ? '正在验证...' : '登录账户' }}</span><b aria-hidden="true">→</b></button>
          </form>
        </section>
      </div>
    </BaseDialog>

    <BaseDialog :open="pointLogsOpen" title="积分流水" size="wide" @close="pointLogsOpen = false">
      <div class="account-point-logs">
        <header class="point-log-toolbar">
          <div><strong>账户明细</strong><small>共 {{ pointLogsTotal }} 条记录</small></div>
          <BaseSelect :model-value="pointLogsCategory" :options="pointLogCategoryOptions" aria-label="积分流水分类" @update:model-value="changePointLogCategory" />
        </header>
        <div class="point-log-list" :class="{ loading: pointLogsLoading }">
          <p v-if="pointLogsLoading && !pointLogs.length">正在读取积分流水...</p>
          <p v-else-if="pointLogsError">{{ pointLogsError }}</p>
          <p v-else-if="!pointLogs.length">当前分类暂无积分流水。</p>
          <article v-for="log in pointLogs" v-else :key="log.id" :class="log.action">
            <strong>{{ log.action === 'add' ? '+' : '-' }}{{ (log.num / 100).toFixed(2) }}</strong>
            <span>{{ log.reason }}</span>
            <small>{{ formatPointLogDate(log.create_at) }}</small>
            <b>{{ pointLogCategoryLabels[log.category] }}</b>
          </article>
        </div>
        <footer class="point-log-pagination">
          <button type="button" :disabled="pointLogsLoading || pointLogsPage <= 1" aria-label="上一页" @click="loadPointLogs(pointLogsPage - 1)">←</button>
          <span>第 {{ pointLogsPage }} / {{ pointLogsTotalPages }} 页</span>
          <button type="button" :disabled="pointLogsLoading || pointLogsPage >= pointLogsTotalPages" aria-label="下一页" @click="loadPointLogs(pointLogsPage + 1)">→</button>
        </footer>
      </div>
    </BaseDialog>

    <BaseDialog :open="pointRechargeOpen" title="游戏内充值积分" @close="pointRechargeOpen = false">
      <section class="point-recharge">
        <header><span>GAME TRANSFER</span><strong>向机器人转账即可充值</strong></header>
        <p>当游戏账户 <b>{{ authStore.user?.username || authStore.user?.name || '当前账户' }}</b> 在线时，在游戏聊天栏向当前 Mineflayer 机器人转账。系统收到该账户的转账提示后会将相同数量计入网页积分。</p>
        <label>充值数量<input v-model="pointRechargeAmount" inputmode="decimal" min="0.01" step="0.01" type="number" /></label>
        <div v-if="gameInfoLoading" class="point-recharge-status">正在读取机器人用户名...</div>
        <template v-else-if="pointRechargeCommand">
          <div class="point-recharge-command"><code>{{ pointRechargeCommand }}</code><button type="button" @click="copyPointRechargeCommand">复制命令</button></div>
          <small>命令必须在游戏内发送；网页不会直接修改积分余额。</small>
        </template>
        <div v-else class="point-recharge-status">机器人当前不可用，暂时无法生成充值命令。</div>
      </section>
    </BaseDialog>

    <BaseDialog :open="apiKeyDialogOpen" title="API Key" @close="apiKeyDialogOpen = false">
      <div class="api-key-dialog">
        <p v-if="apiKeyLoading">正在读取 API key 状态...</p>
        <p v-else-if="apiKeyError" class="api-key-error">{{ apiKeyError }}</p>
        <template v-else>
          <p>{{ apiKeyConfigured ? '已创建 API key。重新生成将立即使旧 key 失效。' : '创建 API key 后可访问公开游戏信息接口。' }}</p>
          <button type="button" class="api-key-action" @click="apiKeyConfirmOpen = true">{{ apiKeyConfigured ? '重新生成 API key' : '创建 API key' }}</button>
        </template>
      </div>
    </BaseDialog>

    <BaseDialog :open="apiKeyConfirmOpen" title="确认创建 API Key" @close="apiKeyConfirmOpen = false">
      <div class="api-key-dialog">
        <p>创建新 key 会立即使当前 key 失效，且新 key 只会显示一次。</p>
        <div class="api-key-actions"><button type="button" class="api-key-secondary" @click="apiKeyConfirmOpen = false">取消</button><button type="button" class="api-key-action" :disabled="apiKeyLoading" @click="createApiKey">确认创建</button></div>
      </div>
    </BaseDialog>

    <BaseDialog :open="apiKeyRevealOpen" title="保存 API Key" :dismissible="false">
      <div class="api-key-dialog">
        <p>请立即保存。关闭此窗口后无法再次查看该 key。</p>
        <code class="api-key-value">{{ revealedApiKey }}</code>
        <div class="api-key-actions"><button type="button" class="api-key-secondary" @click="copyApiKey">复制</button><button type="button" class="api-key-action" @click="closeApiKeyReveal">已保存</button></div>
      </div>
    </BaseDialog>

    <GlobalAlert />

    <div class="route-view">
      <RouterView v-slot="{ Component, route: viewRoute }">
        <Transition mode="out-in" name="route-switch">
          <component :is="Component" :key="viewRoute.path" />
        </Transition>
      </RouterView>
    </div>
  </main>
</template>

<style>
/* Intentionally local, dependency-free visual system for the first navbar slice. */
.autoplay-verification { display:grid; grid-template-columns:44px minmax(0,1fr) auto; align-items:center; gap:14px; width:100%; min-width:0; padding:4px 2px; }.autoplay-verification-mark { display:flex; align-items:end; justify-content:center; gap:3px; width:44px; height:44px; padding:10px; color:var(--accent); background:color-mix(in srgb, var(--accent) 12%, var(--surface)); border:1px solid color-mix(in srgb, var(--accent) 34%, var(--border)); border-radius:5px; }.autoplay-verification-mark i { display:block; width:4px; border-radius:2px; background:currentColor; animation:autoplay-level .82s ease-in-out infinite alternate; }.autoplay-verification-mark i:nth-child(1) { height:10px; animation-delay:-.34s; }.autoplay-verification-mark i:nth-child(2) { height:22px; animation-delay:-.12s; }.autoplay-verification-mark i:nth-child(3) { height:15px; animation-delay:-.52s; }.autoplay-verification strong { display:block; color:var(--panel-text); font-size:15px; line-height:1.25; }.autoplay-verification button { display:inline-flex; align-items:center; justify-content:center; gap:10px; min-width:104px; min-height:38px; padding:0 13px; color:var(--accent-contrast); background:var(--accent); border:1px solid var(--accent); border-radius:4px; box-shadow:0 7px 15px color-mix(in srgb, var(--accent) 24%, transparent); font:inherit; font-size:13px; font-weight:750; transition:transform .18s ease, filter .18s ease; }.autoplay-verification button:hover { filter:brightness(1.08); transform:translateY(-1px); }.autoplay-verification button span { font-size:17px; line-height:1; }.autoplay-verification button:focus-visible { outline:2px solid color-mix(in srgb, var(--accent) 55%, white); outline-offset:2px; } @keyframes autoplay-level { from { transform:scaleY(.42); } to { transform:scaleY(1); } } @media (prefers-reduced-motion:reduce) { .autoplay-verification-mark i { animation:none; } .autoplay-verification button { transition:none; } } @media (max-width:520px) { .autoplay-verification { grid-template-columns:40px minmax(0,1fr); gap:11px; }.autoplay-verification-mark { width:40px; height:40px; }.autoplay-verification button { grid-column:1 / -1; width:100%; margin-top:3px; } }
:root { color-scheme: dark; --page-bg-start: #18382e; --page-bg-end: #0b1d19; --page-text: #f0efe6; --page-muted: #b2beb3; --panel-bg: #eef0e8; --panel-text: #172019; --muted-text: #667068; --surface: #e1e2d9; --surface-hover: #d6d9cf; --surface-selected: #cdd5c8; --border: #c9cec4; --accent: #668f3d; --accent-contrast: #f7faef; --accent-soft: #dce9c0; --success: #62a33f; --success-text: #285334; --success-soft: #dce9c0; --warning: #c28b26; --warning-text: #704b12; --warning-soft: #f3e2b7; --danger: #c84f41; --overlay: rgba(5,15,11,.58); --shadow: rgba(0,0,0,.28); --navbar-content-top: 80px; }
* { box-sizing: border-box; }
body { margin: 0; min-width: 320px; font-family: sans-serif; color: var(--page-text); background: linear-gradient(135deg, var(--page-bg-start), var(--page-bg-end)); transition: color .28s ease, background .28s ease; }
/* Keep every route and embedded control on the same system sans-serif face. */
body *, body *::before, body *::after { font-family: inherit !important; }
html { overflow-y: auto; scrollbar-gutter: auto; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--accent) 62%, var(--muted-text)) transparent; }
html.workspace-lock { overflow: hidden; }
* { scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--accent) 62%, var(--muted-text)) transparent; }
html::-webkit-scrollbar, html *::-webkit-scrollbar { width: 4px !important; height: 4px !important; }
html::-webkit-scrollbar-track, html *::-webkit-scrollbar-track { background: transparent !important; }
html::-webkit-scrollbar-thumb, html *::-webkit-scrollbar-thumb { min-height: 28px; background: color-mix(in srgb, var(--accent) 62%, var(--muted-text)) !important; border: 0 !important; border-radius: 4px !important; }
html::-webkit-scrollbar-thumb:hover, html *::-webkit-scrollbar-thumb:hover { background: var(--accent) !important; }
html::-webkit-scrollbar-corner, html *::-webkit-scrollbar-corner { background: transparent !important; }
button, a { font: inherit; } button { cursor: pointer; } a { color: inherit; text-decoration: none; }
.page { min-height: 100vh; padding: var(--navbar-content-top) clamp(12px, 3vw, 42px) 48px; position: relative; overflow-x: clip; overflow-y: visible; }
.page.workspace-route { height: 100vh; padding: 0 clamp(12px, 3vw, 42px); }
.page.server-route { height: auto; min-height: 100dvh; padding-bottom: 18px; overflow-x: clip; overflow-y: visible; }
.page.explore-route { height: 100vh; min-height: 0; padding: 0 clamp(12px, 3vw, 42px); overflow: hidden; }
.page.agent-route { height: 100vh; min-height: 0; padding: 76px clamp(12px, 3vw, 42px) 14px; overflow: hidden; }
.route-view { display: contents; }
.route-switch-enter-active { transition: opacity .24s ease; }
.route-switch-leave-active { transition: opacity .16s ease; }
.route-switch-enter-from, .route-switch-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .route-switch-enter-active, .route-switch-leave-active { transition-duration: .01ms; }
}
.page.admin-route { height: 100vh; min-height: 0; padding: 0; overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }
.page.admin-route > .route-view { display: block; width: calc(100vw - clamp(12px, 3vw, 42px) - clamp(12px, 3vw, 42px)); min-height: 100%; margin-left: clamp(12px, 3vw, 42px); }
.page::after { content: ""; position: fixed; right: -8vw; bottom: -28vw; width: 62vw; height: 62vw; border: 1px solid color-mix(in srgb, var(--accent) 18%, transparent); border-radius: 50%; box-shadow: 0 0 0 8vw color-mix(in srgb, var(--accent) 5%, transparent), 0 0 0 19vw color-mix(in srgb, var(--accent) 3%, transparent); pointer-events: none; }
.navbar { position: fixed; z-index: 10; top: 18px; left: clamp(12px, 3vw, 42px); right: auto; display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; width: calc(100vw - clamp(12px, 3vw, 42px) - clamp(12px, 3vw, 42px)); pointer-events: none; }
.nav-island { position: relative; isolation: isolate; display: flex; align-items: center; height: 48px; min-height: 48px; padding: 5px; color: var(--panel-text); background: transparent; border: 1px solid color-mix(in srgb, var(--border) 42%, transparent); border-radius: 5px; box-shadow: 0 10px 28px color-mix(in srgb, var(--shadow) 45%, transparent); -webkit-backdrop-filter: blur(18px) saturate(1.12); backdrop-filter: blur(18px) saturate(1.12); pointer-events: auto; transition: color .28s ease, border-color .28s ease; }
.nav-island::before { content: ""; position: absolute; z-index: -1; inset: 0; background: var(--panel-bg); border-radius: 4px; opacity: .28; }
.nav-left { position: relative; flex: 0 0 auto; gap: 2px; overflow: hidden; transition: transform .32s cubic-bezier(.22, 1, .36, 1), opacity .24s ease; } .nav-left.is-hidden { transform: translateY(calc(-100% - 22px)); opacity: 0; pointer-events: none; }
.nav-right { gap: 3px; }
.brand { display: flex; align-items: center; gap: 9px; padding: 3px 10px 3px 5px; font-weight: 800; letter-spacing: -.03em; white-space: nowrap; }
.brand-mark { display: block; width: 34px; height: 34px; object-fit: cover; border-radius: 5px; }
.nav-items { display: flex; align-items: center; gap: 2px; }
.nav-left-stage { position: relative; display: grid; grid-template-columns: max-content; align-items: center; transition: width .24s cubic-bezier(.22, 1, .36, 1); }
.nav-left-panel { display: flex; align-items: center; justify-self: start; width: max-content; gap: 2px; grid-area: 1 / 1; opacity: 0; pointer-events: none; transition: opacity .16s ease; }
.nav-left-panel.is-active { z-index: 1; opacity: 1; pointer-events: auto; }
.admin-brand { display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 38px; padding: 0; border-radius: 5px; transition: background-color .2s ease; }
.admin-brand:hover { background: var(--surface-hover); }
.admin-brand .home-icon { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; color: var(--panel-text); transition: transform .2s ease, color .2s ease; }
.admin-brand:hover .home-icon { transform: scale(1.08); color: var(--accent); }
.nav-link, .nav-trigger, .status-button, .search-button, .points-button { height: 36px; min-height: 36px; padding: 0 11px; border: 0; border-radius: 5px; color: var(--panel-text); background: transparent; font-size: 13px; font-weight: 650; white-space: nowrap; transition: color .24s ease, background-color .24s ease, transform .24s ease; }
.nav-link { position: relative; display: flex; align-items: center; gap: 7px; }
.nav-link { border: 1px solid transparent; }
.nav-link:hover { background: var(--surface-hover); border-color: var(--border); transform: translateY(-1px); }
.nav-link::after { content: ""; position: absolute; left: 13px; right: 13px; bottom: 3px; height: 2px; background: var(--accent); border-radius: 5px; opacity: 0; transform: scaleX(.35); transition: opacity .24s ease, transform .24s cubic-bezier(.22, 1, .36, 1); }
.nav-link.active { color: var(--panel-text); background: var(--surface-selected); }
.nav-link.active:hover { background: var(--surface-hover); }
.nav-link.active::after { opacity: 1; transform: scaleX(1); }
.admin-nav-link.active { color: var(--accent); background: var(--accent-soft); border-color: var(--accent-soft); }
.admin-nav-link.active:hover { background: var(--accent-soft); color: var(--accent); }
.status-button { display: flex; align-items: center; justify-content: center; gap: 8px; width: 94px; color: var(--success-text); background: var(--success-soft); border: 1px solid color-mix(in srgb, var(--success) 24%, var(--border)); }
.status-button.unavailable { color: var(--muted-text); background: var(--surface); }
.online-dot { display: inline-block; width: 7px; height: 7px; background: var(--success); border-radius: 5px; box-shadow: 0 0 0 4px color-mix(in srgb, var(--success) 18%, transparent); }
.online-dot.muted { background: var(--muted-text); box-shadow: 0 0 0 4px color-mix(in srgb, var(--muted-text) 16%, transparent); }
.music-player { --music-progress:0%; position:relative; display:grid; flex:0 0 202px; grid-template-columns:minmax(0, 1fr) 30px; gap:7px; align-items:center; box-sizing:border-box; width:202px; min-width:202px; max-width:202px; height:38px; padding:3px; overflow:hidden; color:var(--panel-text); background:color-mix(in srgb, var(--panel-bg) 78%, var(--surface)); border:1px solid color-mix(in srgb, var(--border) 88%, transparent); border-radius:5px; transition:border-color .18s ease, background-color .18s ease; }.music-player::before { content:""; position:absolute; inset:0; padding:1px; border-radius:inherit; background:conic-gradient(from -90deg, var(--accent) var(--music-progress), color-mix(in srgb, var(--border) 54%, transparent) 0); -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0); -webkit-mask-composite:xor; mask-composite:exclude; opacity:.72; pointer-events:none; }.music-player--paused::before, .music-player--empty::before, .music-player--error::before, .music-player--loading::before { opacity:.28; }.music-player--empty, .music-player--error, .music-player--loading { background:color-mix(in srgb, var(--surface) 78%, var(--panel-bg)); }.music-player-info { position:relative; z-index:1; display:grid; grid-template-columns:30px minmax(0, 1fr); gap:8px; align-items:center; min-width:0; height:30px; padding:0; color:inherit; background:transparent; border:0; text-align:left; }.music-player-info:hover { background:color-mix(in srgb, var(--surface-hover) 62%, transparent); }.music-artwork { position:relative; display:grid; place-items:center; width:30px; height:30px; overflow:hidden; background:var(--surface-selected); border-radius:4px; }.music-cover { display:block; width:100%; height:100%; object-fit:cover; }.music-player--empty .music-cover, .music-player--error .music-cover, .music-player--loading .music-cover { display:none; }.music-state-icon { width:16px; height:16px; fill:none; stroke:var(--muted-text); stroke-linecap:round; stroke-linejoin:round; stroke-width:1.75; }.music-error-icon { stroke:var(--danger); }.music-loading-icon { animation:music-spin .8s linear infinite; }.music-copy { display:grid; gap:3px; min-width:0; max-width:100%; line-height:1; }.music-title-viewport { display:block; width:100%; min-width:0; max-width:100%; overflow:hidden; }.music-copy b, .music-copy small { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }.music-copy b { display:flex; gap:28px; width:max-content; min-width:100%; font-size:11px; font-weight:750; }.music-copy b.marquee { animation:music-marquee 7s linear infinite; }.music-copy b span { flex:none; }.music-copy small { max-width:100%; color:var(--muted-text); font-size:9px; }.music-player--error .music-copy b { color:var(--danger); }.music-control { position:relative; z-index:1; display:grid; place-items:center; width:30px; height:30px; padding:0; color:var(--accent-contrast); background:var(--accent); border:1px solid color-mix(in srgb, var(--accent) 72%, var(--border)); border-radius:4px; box-shadow:inset 0 1px color-mix(in srgb, #fff 28%, transparent); transition:background-color .18s ease, border-color .18s ease, transform .18s ease; }.music-control:hover:not(:disabled) { background:color-mix(in srgb, var(--accent) 78%, #000); border-color:color-mix(in srgb, var(--accent) 70%, #000); transform:translateY(-1px); }.music-control:focus-visible { outline:2px solid color-mix(in srgb, var(--accent) 52%, transparent); outline-offset:2px; }.music-control:disabled { color:var(--muted-text); background:var(--surface-selected); border-color:var(--border); box-shadow:none; cursor:not-allowed; }.music-control-icon { position:relative; display:block; width:10px; height:12px; }.music-control-icon:not(.pause)::before { content:""; position:absolute; top:1px; left:2px; border-top:5px solid transparent; border-bottom:5px solid transparent; border-left:7px solid currentColor; }.music-control-icon.pause { display:flex; align-items:center; justify-content:center; gap:3px; }.music-control-icon.pause i { display:block; width:2px; height:10px; background:currentColor; border-radius:1px; }.music-playback-row { position:absolute; z-index:0; right:43px; bottom:5px; display:block; width:36px; height:25px; opacity:.19; pointer-events:none; }.music-player--playing .music-playback-row { opacity:.38; }.music-progress-line { display:none; }.music-bars { display:flex; align-items:end; justify-content:center; gap:3px; height:25px; }.music-bars i { width:3px; height:12px; background:var(--accent); border-radius:2px; opacity:.9; transform-origin:bottom; transition:transform .08s linear, opacity .08s linear; } @keyframes music-spin { to { transform:rotate(360deg); } } @keyframes music-marquee { 0%,10% { transform:translateX(0); } 90%,100% { transform:translateX(calc(var(--marquee-distance) * -1)); } }
.points-control { display: inline-flex; align-items: stretch; height: 36px; overflow: hidden; color: var(--warning-text); background: var(--warning-soft); border: 1px solid color-mix(in srgb, var(--warning) 26%, var(--border)); border-radius: 5px; }
.points-button { color: inherit; background: transparent; border: 0; border-radius: 0; } .points-button b { margin-left: 4px; font-weight: inherit; } .coin { color: var(--warning); margin-right: 4px; }
.points-add-button { display: grid; place-items: center; width: 29px; padding: 0; color: inherit; background: transparent; border: 0; border-left: 1px solid color-mix(in srgb, var(--warning) 26%, var(--border)); font-size: 17px; font-weight: 500; line-height: 1; transition: color .2s ease, background-color .2s ease; }
.points-add-button:hover { background: color-mix(in srgb, var(--warning) 14%, transparent); }
.points-add-button:focus-visible { outline: 2px solid color-mix(in srgb, var(--warning) 50%, transparent); outline-offset: 2px; }
.login-button { height: 36px; min-height: 36px; padding: 0 12px; border-radius: 5px; color: var(--panel-text); background: color-mix(in srgb, var(--panel-bg) 28%, transparent); border: 1px solid color-mix(in srgb, var(--border) 72%, transparent); font-size: 13px; font-weight: 700; white-space: nowrap; }
.account-slot { position: relative; display: inline-flex; align-items: center; justify-content: flex-end; width: 54px; height: 38px; overflow: hidden; transition: width .34s cubic-bezier(.22,1,.36,1); }
.account-slot.authenticated { width: 142px; overflow: visible; }
.account-view { display: inline-flex; align-items: center; justify-content: flex-end; height: 38px; }
.account-login-view { width: 54px; }
.account-user-view { width: 142px; }
.account-menu-wrap { position: relative; display: inline-flex; }
.account-menu { position: absolute; z-index: 20; top: calc(100% + 8px); right: 0; display: grid; width: 142px; padding: 4px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 14px 30px var(--shadow); }
.account-menu button { display: flex; align-items: center; justify-content: space-between; height: 34px; padding: 0 9px; color: var(--panel-text); background: transparent; border: 0; border-radius: 4px; font-size: 11px; font-weight: 700; text-align: left; }
.account-menu button:hover { background: var(--surface-hover); }.account-menu button b { color: var(--muted-text); font-size: 12px; font-weight: 400; }.account-menu .logout-menu-item { color: var(--danger); }.account-menu-enter-active,.account-menu-leave-active { transition: opacity .16s ease,transform .18s ease; }.account-menu-enter-from,.account-menu-leave-to { opacity: 0; transform: translateY(-4px); }
.account-enter-active, .account-leave-active { transition: opacity .2s ease, transform .26s cubic-bezier(.22,1,.36,1), filter .2s ease; }
.account-enter-from { opacity: 0; filter: blur(3px); transform: translateX(10px) scale(.97); }
.account-leave-to { opacity: 0; filter: blur(3px); transform: translateX(-8px) scale(.97); }
.user-button { position: relative; display: grid; grid-template-columns: 29px minmax(0, 1fr) 12px; gap: 7px; align-items: center; width: 142px; height: 38px; padding: 4px 6px; color: var(--panel-text); background: color-mix(in srgb, var(--panel-bg) 22%, transparent); border: 1px solid var(--border); border-radius: 5px; text-align: left; white-space: nowrap; transition: background-color .2s ease, border-color .2s ease; }
.user-button::before { display: none; }
.user-button:hover { background: color-mix(in srgb, var(--surface-hover) 52%, transparent); }
.music-player:hover, .status-button:hover, .points-button:hover, .theme-button:hover, .user-button:hover, .login-button:hover { border-color: color-mix(in srgb, var(--accent) 48%, var(--border)); }
.music-player:focus-visible, .status-button:focus-visible, .points-button:focus-visible, .theme-button:focus-visible, .user-button:focus-visible, .login-button:focus-visible { outline: 2px solid color-mix(in srgb, var(--accent) 45%, transparent); outline-offset: 2px; }
.user-copy { min-width: 0; }
.user-copy strong, .user-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.user-copy strong { font-size: 12px; line-height: 1.15; }
.user-copy small { margin-top: 2px; color: var(--muted-text); font-size: 8px; font-weight: 500; text-transform: uppercase; }
.user-exit { color: var(--muted-text); font-size: 12px; opacity: 0; transform: translate(-2px, 2px); transition: opacity .2s ease, transform .2s ease; }
.user-button:hover .user-exit { opacity: 1; transform: translate(0, 0); }
.theme-picker { position: relative; }
.theme-button { display: flex; align-items: center; gap: 6px; height: 36px; padding: 0 10px; color: var(--panel-text); background: color-mix(in srgb, var(--panel-bg) 22%, transparent); border: 1px solid var(--border); border-radius: 5px; font-size: 13px; white-space: nowrap; transition: background-color .24s ease, border-color .24s ease; }
.theme-button:hover { background: var(--surface-hover); }
.theme-icon { display: grid; place-items: center; width: 17px; font-size: 16px; }
.theme-dialog-intro { margin: 0 0 14px; color: var(--muted-text); font-size: 12px; }
.theme-options { display: grid; gap: 6px; }
.theme-option { display: grid; grid-template-columns: 32px 1fr auto; gap: 10px; align-items: center; width: 100%; padding: 10px; color: var(--panel-text); background: transparent; border: 1px solid transparent; border-radius: 5px; text-align: left; transition: background-color .2s ease, border-color .2s ease; }
.theme-option:hover, .theme-option.selected { background: var(--surface-selected); border-color: var(--border); }
.option-icon { display: grid; place-items: center; width: 32px; height: 32px; color: var(--accent-contrast); background: var(--accent); border-radius: 5px; font-size: 16px; }
.theme-option strong, .theme-option small { display: block; } .theme-option strong { font-size: 13px; } .theme-option small { margin-top: 3px; color: var(--muted-text); font-size: 10px; }
.option-check { color: var(--accent); font-size: 16px; }
.palette-title { margin-top: 22px; }
.palette-options { display: grid; grid-template-columns: repeat(2, 1fr); gap: 6px; }
.palette-option { display: flex; align-items: center; gap: 8px; min-height: 36px; padding: 0 10px; color: var(--panel-text); background: transparent; border: 1px solid transparent; border-radius: 5px; font-size: 12px; text-align: left; }
.palette-option:hover, .palette-option.selected { background: var(--surface-selected); border-color: var(--border); }
.palette-option i { width: 13px; height: 13px; border: 2px solid var(--panel-bg); border-radius: 5px; box-shadow: 0 0 0 1px var(--border); }
.palette-option b { margin-left: auto; color: var(--accent); }
.login-layout { display: grid; grid-template-columns: .95fr 1.05fr; gap: 26px; }
.login-main { padding: 4px 2px; }
.login-heading { margin-bottom: 20px; }
.login-heading strong { display: block; color: var(--panel-text); font-size: 20px; letter-spacing: -.04em; }
.login-heading p { margin: 5px 0 0; color: var(--muted-text); font-size: 11px; }
.login-form { display: grid; gap: 13px; }
.login-form label { display: grid; gap: 7px; color: var(--panel-text); font-size: 11px; font-weight: 700; }
.login-form label > span { padding-left: 1px; }
.login-form input { width: 100%; height: 42px; padding: 0 12px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 5px; outline: none; font-size: 13px; transition: border-color .2s ease, box-shadow .2s ease, background-color .2s ease; }
.login-form input::placeholder { color: var(--muted-text); opacity: .72; }
.login-form input:focus { background: var(--panel-bg); border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 15%, transparent); }
.login-error { margin: -2px 0 0; padding: 8px 10px; color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent); border-radius: 5px; font-size: 11px; }
.login-submit { display: flex; align-items: center; justify-content: space-between; height: 42px; padding: 0 13px; color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 5px; font-size: 13px; font-weight: 700; transition: filter .2s ease, transform .2s ease; }
.login-submit:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
.login-submit b { font-size: 17px; font-weight: 400; }
.login-submit:disabled { cursor: wait; opacity: .65; }
.point-recharge { display: grid; gap: 15px; }
.point-recharge > header { display: grid; gap: 5px; padding-bottom: 13px; border-bottom: 1px solid var(--border); }
.point-recharge > header span { color: var(--accent); font: 800 9px ui-monospace, SFMono-Regular, Consolas, monospace; }
.point-recharge > header strong { font-size: 16px; }
.point-recharge > p { margin: 0; color: var(--muted-text); font-size: 12px; line-height: 1.7; }
.point-recharge > label { display: grid; gap: 7px; color: var(--panel-text); font-size: 11px; font-weight: 700; }
.point-recharge input { width: 100%; height: 40px; padding: 0 11px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; font-size: 13px; outline: none; }
.point-recharge input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent); }
.point-recharge-command { display: flex; align-items: center; gap: 8px; padding: 8px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.point-recharge-command code { min-width: 0; flex: 1; overflow: hidden; color: var(--accent); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.point-recharge-command button { flex: 0 0 auto; height: 30px; padding: 0 10px; color: var(--accent-contrast); background: var(--accent); border: 0; border-radius: 3px; font-size: 10px; font-weight: 800; }
.point-recharge > small, .point-recharge-status { color: var(--muted-text); font-size: 10px; line-height: 1.6; }
.point-recharge-status { padding: 14px 11px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.account-point-logs { display: grid; gap: 12px; min-height: 430px; grid-template-rows: auto minmax(0, 1fr) auto; }
.point-log-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 11px; border-bottom: 1px solid var(--border); }
.point-log-toolbar > div { display: grid; gap: 3px; }
.point-log-toolbar strong { font-size: 13px; }
.point-log-toolbar small { color: var(--muted-text); font-size: 10px; }
.point-log-toolbar .base-select { width: 150px; }
.point-log-list { display: grid; align-content: start; gap: 6px; transition: opacity .15s ease; }
.point-log-list.loading { opacity: .55; }
.point-log-list > p { margin: 0; padding: 48px 12px; color: var(--muted-text); font-size: 12px; text-align: center; }
.point-log-list article { display: grid; grid-template-columns: 76px minmax(0, 1fr) auto; gap: 4px 12px; align-items: center; min-height: 55px; padding: 8px 11px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.point-log-list article > strong { grid-row: 1 / 3; font: 750 14px ui-monospace, SFMono-Regular, Consolas, monospace; }
.point-log-list .add > strong { color: var(--success); }
.point-log-list .remove > strong { color: var(--danger); }
.point-log-list article > span { min-width: 0; overflow: hidden; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.point-log-list article > small { grid-column: 2; color: var(--muted-text); font-size: 10px; }
.point-log-list article > b { grid-row: 1 / 3; grid-column: 3; padding: 4px 7px; color: var(--muted-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 3px; font-size: 9px; font-weight: 700; }
.point-log-pagination { display: grid; grid-template-columns: 32px 1fr 32px; align-items: center; gap: 8px; padding-top: 10px; border-top: 1px solid var(--border); }
.point-log-pagination span { color: var(--muted-text); font-size: 10px; text-align: center; }
.point-log-pagination button { width: 32px; height: 30px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 3px; }
.point-log-pagination button:disabled { cursor: default; opacity: .35; }
.api-key-dialog { display: grid; gap: 14px; }.api-key-dialog p { margin: 0; color: var(--muted-text); font-size: 13px; line-height: 1.6; }.api-key-error { color: var(--danger) !important; }.api-key-value { display: block; overflow-wrap: anywhere; padding: 10px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; font-family: ui-monospace, monospace !important; font-size: 12px; line-height: 1.5; user-select: all; }.api-key-actions { display: flex; justify-content: flex-end; gap: 8px; }.api-key-action, .api-key-secondary { min-height: 34px; padding: 0 12px; border: 1px solid var(--accent); border-radius: 4px; font-size: 12px; font-weight: 700; }.api-key-action { color: var(--accent-contrast); background: var(--accent); }.api-key-action:disabled { cursor: wait; opacity: .65; }.api-key-secondary { color: var(--panel-text); background: transparent; border-color: var(--border); }
.account-help { display: flex; flex-direction: column; justify-content: space-between; min-height: 255px; padding: 16px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 5px; }
.help-brand { display: flex; align-items: center; gap: 9px; color: var(--panel-text); font-size: 13px; font-weight: 800; }
.help-brand img { width: 34px; height: 34px; object-fit: cover; border-radius: 5px; }
.help-brand small { display: block; margin-top: 3px; color: var(--muted-text); font-size: 8px; letter-spacing: .09em; }
.help-copy { margin: 24px 0 16px; }
.help-copy > span { color: var(--accent); font-size: 8px; font-weight: 700; letter-spacing: .12em; }
.help-copy h3 { margin: 6px 0 7px; font-size: 17px; letter-spacing: -.035em; }
.help-copy p { margin: 0; color: var(--muted-text); font-size: 10px; line-height: 1.6; }
.help-copy p b { color: var(--panel-text); }
.command-row { display: grid; grid-template-columns: 36px 1fr; gap: 7px; align-items: center; margin-top: 6px; }
.command-row > span { color: var(--muted-text); font-size: 9px; }
.command-row code { display: block; overflow-x: auto; padding: 7px 8px; color: var(--accent); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; font-size: 10px; white-space: nowrap; }
.account-help > small { display: block; margin-top: 10px; color: var(--muted-text); font-size: 9px; line-height: 1.5; }
@media (max-width: 620px) { .login-layout { grid-template-columns: 1fr; gap: 18px; } .account-help { order: 2; min-height: auto; } .login-main { order: 1; } .help-copy { margin: 18px 0 14px; } }
@media (max-width: 560px) { .account-point-logs { min-height: 380px; }.point-log-list article { grid-template-columns: 68px minmax(0, 1fr); }.point-log-list article > b { grid-row: auto; grid-column: 2; justify-self: start; }.point-log-list article > small { grid-column: 2; }.point-log-toolbar { align-items: stretch; flex-direction: column; }.point-log-toolbar .base-select { width: 100%; } }
.hero { position: relative; z-index: 1; display: grid; grid-template-columns: minmax(0,720px) 260px; justify-content: space-between; align-items: end; gap: 80px; min-height: calc(100vh - 88px); padding: 18vh 3vw 8vh; }
.kicker { color: var(--accent); font-size: 11px; font-weight: 700; letter-spacing: .13em; } .hero h1 { margin: 18px 0 22px; font-size: clamp(48px,7vw,104px); line-height: .92; letter-spacing: -.075em; } .hero h1 span { color: var(--page-muted); } .hero-copy { max-width: 550px; color: var(--page-muted); font-size: 15px; line-height: 1.75; }
.snapshot { padding: 20px 0; border-top: 1px solid color-mix(in srgb, var(--page-text) 20%, transparent); border-bottom: 1px solid color-mix(in srgb, var(--page-text) 20%, transparent); } .snapshot-label { color: var(--page-muted); font-size: 10px; letter-spacing: .1em; } .snapshot strong { display: block; margin: 10px 0 2px; font-size: 38px; letter-spacing: -.05em; } .snapshot p { margin: 0; color: var(--page-muted); font-size: 11px; line-height: 1.5; }
.mobile-menu-button { display: none; }
.mobile-status, .mobile-nav-menu { display: none; }
@media (max-width: 1280px) {
  .navbar { gap:8px; }
  .music-player { grid-template-columns:30px 30px; flex:0 0 74px; gap:8px; width:74px; min-width:74px; max-width:74px; padding:3px; }
  .music-player-info { grid-template-columns:30px; gap:0; width:30px; padding:0; }
  .music-copy, .music-playback-row { display:none; }
  .music-artwork { width:30px; height:30px; }
  .music-control { width:30px; height:30px; }
  .status-button { width:48px; padding:0 8px; }
  .desktop-status, .online-dot { display:none; }
  .mobile-status { display:block; }
  .points-button { display:flex; align-items:center; justify-content:center; min-width:50px; padding:0 7px; font-size:11px; }
  .points-button b { display:none; }
  .points-button .coin { margin-right:3px; }
  .theme-button { width:36px; justify-content:center; padding:0; }
  .theme-label { display:none; }
  .account-slot.authenticated, .account-user-view, .user-button { width:38px; }
  .user-button { display:grid; grid-template-columns:27px; place-content:center; padding:4px; }
  .user-copy, .user-exit { display:none; }
}
@media (max-width: 960px) {
  .nav-left { flex:0 0 auto; min-width:0; }
  .nav-left-stage { width:40px !important; }
  .nav-left-panel { width:40px; }
  .nav-items, .brand span { display:none; }
  .brand { width:40px; padding:3px; }
}
@media (max-width: 850px) {
  .navbar { align-items: flex-start; gap: 8px; }
  .nav-items { display: none; }
  .nav-left { flex: 0 1 auto; }
  .nav-left.is-hidden { transform: none; opacity: 1; pointer-events: auto; }
  .nav-right { flex: none; gap: 2px; }
  .mobile-menu-button { display: block; width: 36px; height: 36px; border: 0; border-radius: 5px; color: var(--accent-contrast); background: var(--accent); font-size: 18px; line-height: 1; }
  .mobile-nav-menu { position: fixed; top: 76px; left: clamp(12px, 3vw, 42px); right: clamp(12px, 3vw, 42px); display: grid; grid-template-columns: repeat(4, 1fr); padding: 5px; overflow: hidden; color: var(--panel-text); background: color-mix(in srgb, var(--panel-bg) 94%, transparent); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 18px 42px var(--shadow); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); pointer-events: auto; }
  .mobile-nav-link { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 8px; min-height: 46px; padding: 0 11px; border-radius: 4px; }
  .mobile-nav-link + .mobile-nav-link { border-left: 1px solid var(--border); }
  .mobile-nav-link:hover, .mobile-nav-link.active { background: var(--surface-selected); }
  .mobile-nav-link span { color: var(--accent); font: 700 8px/1 ui-monospace, monospace; }
  .mobile-nav-link strong { font-size: 12px; }
  .mobile-nav-link b { color: var(--muted-text); font-size: 11px; }
  .mobile-nav-menu.admin-mode { grid-template-columns: repeat(2, 1fr); }
  .mobile-nav-menu.admin-mode .mobile-nav-link:nth-child(odd) { border-left: 0; }
  .mobile-nav-menu.admin-mode .mobile-nav-link:nth-child(n+3) { border-top: 1px solid var(--border); }
  .mobile-nav-menu.admin-mode .home-link { grid-column: 1 / -1; border-left: 0; border-top: 1px solid var(--border); background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .mobile-nav-menu.admin-mode .home-link span { color: var(--accent-contrast); background: var(--accent); }
  .mobile-nav-enter-active, .mobile-nav-leave-active { transition: opacity .18s ease, transform .22s cubic-bezier(.22,1,.36,1); transform-origin: top; }
  .mobile-nav-enter-from, .mobile-nav-leave-to { opacity: 0; transform: translateY(-7px) scale(.985); }
  .hero { grid-template-columns: 1fr; align-items: end; gap: 48px; padding-top: 24vh; }
  .snapshot { max-width: 260px; }
}
@media (max-width: 760px) { .page.workspace-route { height: auto; min-height: 100vh; } }
@media (max-width: 620px) {
  .points-button { display: flex; align-items: center; justify-content: center; min-width: 50px; padding: 0 7px; font-size: 11px; }
  .points-button b { display: none; }
  .points-button .coin { margin-right: 3px; }
  .theme-label, .desktop-status, .online-dot { display: none; }
  .mobile-status { display: block; }
  .music-player { grid-template-columns:30px; flex:0 0 36px; width:36px; min-width:36px; max-width:36px; gap:0; padding:3px; }
  .music-player-info { grid-template-columns:30px; width:30px; padding:0; }
  .music-artwork { width:30px; height:30px; }
  .music-control, .music-playback-row { display:none; }
  .theme-button { width: 36px; justify-content: center; padding: 0; }
   .status-button { width: 48px; justify-content: center; padding: 0 8px; }
  .account-slot.authenticated, .account-user-view, .user-button { width: 38px; }
  .user-button { display: grid; grid-template-columns: 27px; place-content: center; padding: 4px; }
  .user-copy, .user-exit { display: none; }
  .mobile-nav-menu { grid-template-columns: 1fr 1fr; }
  .mobile-nav-link:nth-child(3) { border-left: 0; }
  .mobile-nav-link:nth-child(n+3) { border-top: 1px solid var(--border); }
}
@media (max-width: 560px) {
  :root { --navbar-content-top: 68px; }
  .page { padding: var(--navbar-content-top) 12px 24px; }
  .navbar { top: 12px; left: 12px; right: auto; gap: 6px; width: calc(100vw - 24px); }
  .nav-island { height: 44px; min-height: 44px; padding: 3px; }
  .brand { padding: 3px; }
  .brand span { display: none; }
  .brand-mark { width: 34px; height: 34px; }
  .mobile-nav-menu { top: 64px; left: 12px; right: 12px; }
  .hero { min-height: calc(100vh - 72px); padding: 25vh 6px 5vh; }
  .hero h1 { font-size: clamp(46px,16vw,72px); }
}
@media (prefers-reduced-motion: reduce) { .nav-left-stage, .nav-left-panel, .account-slot { transition-duration: .01ms; } .account-enter-active, .account-leave-active { transition: opacity .01ms; } .account-enter-from, .account-leave-to { filter: none; transform: none; } }
  /* Number fields are entered directly; browser spinner controls add visual noise. */
  input[type="number"] { appearance: textfield; -moz-appearance: textfield; }
  input[type="number"]::-webkit-inner-spin-button, input[type="number"]::-webkit-outer-spin-button { margin: 0; -webkit-appearance: none; appearance: none; }

  /* Keep card actions as one compact control instead of a row of unrelated buttons. */
  .user-card > footer { display: grid !important; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column; gap: 0 !important; overflow: hidden; background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; }
  .user-card > footer > button { height: 32px !important; min-width: 0; padding: 0 7px !important; color: var(--muted-text) !important; background: transparent !important; border: 0 !important; border-radius: 0 !important; font-size: 11px !important; font-weight: 700; transition: color .18s ease, background-color .18s ease; }
  .user-card > footer > button + button { border-left: 1px solid var(--border) !important; }
  .user-card > footer > button:hover:not(:disabled) { color: var(--panel-text) !important; background: var(--surface-hover) !important; }
  .user-card > footer > button.danger { color: var(--danger) !important; }
  .user-card > footer > button.danger:hover:not(:disabled) { color: var(--accent-contrast) !important; background: var(--danger) !important; }
</style>
