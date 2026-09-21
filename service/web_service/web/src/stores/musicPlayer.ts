import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import { get, getBlob } from '../utils/request'
import { useAuthStore } from './auth'

export interface MusicTrack { hash?: string; filehash?: string; name?: string; songname?: string; filename?: string; singername?: string; cover?: string; timelen?: number; singerinfo?: Array<{ name?: string }>; mvhash?: string; mvHash?: string; MVHash?: string }
export interface LyricLine { time: number; text: string; translation: string }
export interface MusicMv { mvhash: string; downurl: string; backupdownurl: string[]; filesize: number | null }

interface SavedPlayback { hash: string; page: number; position: number }

const playbackStorageKey = 'bangxi-music-playback'
const playbackOwnerStorageKey = 'bangxi-music-playback-owner'
const playbackClaimEvent = 'bangxi-music-playback-claim'

function readSavedPlayback(): SavedPlayback | null {
  try {
    const saved = JSON.parse(localStorage.getItem(playbackStorageKey) || '') as Partial<SavedPlayback>
    const { hash, page, position } = saved
    if (typeof hash !== 'string' || !hash || typeof page !== 'number' || !Number.isInteger(page) || page < 1 || typeof position !== 'number' || !Number.isFinite(position) || position < 0) return null
    return { hash, page, position }
  } catch { return null }
}

export const useMusicPlayerStore = defineStore('music-player', () => {
  const authStore = useAuthStore()
  const tracks = ref<MusicTrack[]>([])
  const playlistName = ref('Bangxi Radio')
  const playlistCover = ref('/bx_logo.png')
  const page = ref(1)
  const total = ref(0)
  const totalPages = ref(1)
  const currentIndex = ref(-1)
  const currentTrack = ref<MusicTrack | null>(null)
  const loading = ref(false)
  const trackLoading = ref(false)
  const loaded = ref(false)
  const loadError = ref('')
  const autoPlay = ref(false)
  const autoPictureInPicture = ref(false)
  const autoPictureInPictureConfirmed = ref(false)
  const volume = ref(1)
  const automationVerificationRequired = ref(false)
  const playing = ref(false)
  const currentTime = ref(0)
  const duration = ref(0)
  const lyrics = ref<LyricLine[]>([])
  const mv = ref<MusicMv | null>(null)
  const visualizerLevels = ref([0, 0, 0, 0, 0])
  const pageSize = 30
  let audio: HTMLAudioElement | null = null
  let audioObjectUrl: string | null = null
  let audioContext: AudioContext | null = null
  let analyser: AnalyserNode | null = null
  let source: MediaElementAudioSourceNode | null = null
  let animationFrame = 0
  let playRequest = 0
  let mvRequest = 0
  let autoPlayStarted = false
  let autoPlayStarting = false
  let automationConfigured = false
  let autoPlayBlocked = false
  let pictureInPictureRequestHandler: ((reason?: string) => void) | null = null
  let pendingRestore: { hash: string; position: number } | null = null
  let lastPersistedSecond = -1
  let playbackCoordinationStarted = false
  const playbackOwnerId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  const savedPlayback = readSavedPlayback()

  const current = computed(() => currentTrack.value)
  const title = computed(() => current.value?.name || current.value?.songname || current.value?.filename || playlistName.value)
  const artist = computed(() => current.value?.singerinfo?.map(item => item.name).filter(Boolean).join(' / ') || current.value?.singername || (tracks.value.length ? playlistName.value : '未配置歌单'))
  const playerCover = computed(() => current.value?.cover?.replace('{size}', '200') || playlistCover.value)
  const currentLyric = computed(() => {
    return currentLyricIndex.value >= 0 ? lyrics.value[currentLyricIndex.value]?.text || title.value : title.value
  })
  const currentLyricIndex = computed(() => lyrics.value.reduce((active, line, index) => line.time <= currentTime.value ? index : active, -1))
  const progress = computed(() => duration.value ? currentTime.value / duration.value : 0)

  function canUseMusic() { return authStore.isLoggedIn }
  function releaseAudioObjectUrl() {
    if (!audioObjectUrl) return
    URL.revokeObjectURL(audioObjectUrl)
    audioObjectUrl = null
  }
  function trackHash(track = current.value) { return track?.hash || track?.filehash || '' }
  function trackMvHash(track: MusicTrack | null) { return String(track?.mvhash || track?.mvHash || track?.MVHash || '').trim() }
  function resetLevels() { visualizerLevels.value = visualizerLevels.value.map(() => 0) }
  function setVolume(value: number) {
    volume.value = Math.max(0, Math.min(value, 1))
    if (audio) audio.volume = volume.value
  }
  function savePlayback(force = false) {
    const hash = trackHash()
    const position = Math.max(0, currentTime.value)
    const second = Math.floor(position)
    if (!hash || (!force && second === lastPersistedSecond)) return
    try {
      localStorage.setItem(playbackStorageKey, JSON.stringify({ hash, page: page.value, position }))
      lastPersistedSecond = second
    } catch { /* Storage may be unavailable in private browsing mode. */ }
  }
  function parseLanguageTranslations(text: string): string[] {
    const encoded = text.match(/^\[language:(.+)\]$/m)?.[1]
    if (!encoded) return []
    try {
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
      const language = JSON.parse(new TextDecoder().decode(bytes)) as { content?: Array<{ type?: number; lyricContent?: unknown[] }> }
      const lyricContent = language.content?.find(block => block.type === 1)?.lyricContent
      if (!Array.isArray(lyricContent)) return []
      return lyricContent.map(line => Array.isArray(line) ? line.map(value => String(value ?? '')).join('') : String(line ?? ''))
    } catch { return [] }
  }
  function parseLyrics(source: unknown): LyricLine[] {
    const text = String(source ?? '').replace(/^\uFEFF/, '').replace(/\r/g, '')
    const translations = parseLanguageTranslations(text)
    const lines: LyricLine[] = []
    for (const row of text.split('\n')) {
      const lrc = row.match(/^\[(\d{1,2}):(\d{1,2})\.(\d{1,3})\](.*)$/)
      if (lrc) {
        const milliseconds = Number((lrc[3] || '').padEnd(3, '0'))
        lines.push({time: Number(lrc[1]) * 60 + Number(lrc[2]) + milliseconds / 1000, text: (lrc[4] || '').trim(), translation: ''})
        continue
      }
      const krc = row.match(/^\[(\d+),(\d+)\](.*)$/)
      if (krc) lines.push({time: Number(krc[1]) / 1000, text: (krc[3] || '').replace(/<\d+,\d+,\d+>/g, '').trim(), translation: ''})
    }
    return lines.filter(line => line.text).sort((a, b) => a.time - b.time).map((line, index) => ({...line, translation: translations[index] || ''}))
  }
  function documentPictureInPictureAvailable() {
    return typeof window !== 'undefined' && 'documentPictureInPicture' in window
  }
  function syncAutomationVerificationRequired() {
    automationVerificationRequired.value = autoPlayBlocked || (autoPictureInPicture.value && documentPictureInPictureAvailable() && !autoPictureInPictureConfirmed.value)
  }
  function setMediaSessionAction(action: MediaSessionAction | 'enterpictureinpicture', handler: ((details?: unknown) => void) | null) {
    try {
      (navigator.mediaSession.setActionHandler as (action: MediaSessionAction | 'enterpictureinpicture', handler: ((details?: unknown) => void) | null) => void)(action, handler)
    } catch { /* The browser has not implemented this action yet. */ }
  }
  function updateMediaSession() {
    if (!('mediaSession' in navigator) || !current.value) return
    navigator.mediaSession.metadata = new MediaMetadata({title: title.value, artist: artist.value, album: playlistName.value, artwork: [{src: playerCover.value, sizes: '200x200', type: 'image/jpeg'}]})
    setMediaSessionAction('play', () => void toggle())
    setMediaSessionAction('pause', () => audio?.pause())
    setMediaSessionAction('nexttrack', () => void next())
    setMediaSessionAction('previoustrack', () => void previous())
    setMediaSessionAction('enterpictureinpicture', autoPictureInPicture.value && autoPictureInPictureConfirmed.value && pictureInPictureRequestHandler
      ? details => pictureInPictureRequestHandler?.((details as { enterPictureInPictureReason?: string } | undefined)?.enterPictureInPictureReason)
      : null)
  }
  function setPictureInPictureRequestHandler(handler: ((reason?: string) => void) | null) {
    pictureInPictureRequestHandler = handler
    if (current.value) updateMediaSession()
  }
  function updatePosition() {
    if (!('mediaSession' in navigator) || !duration.value) return
    try { navigator.mediaSession.setPositionState({duration: duration.value, position: Math.min(currentTime.value, duration.value)}) } catch { /* browser may reject an incomplete duration */ }
  }
  function startVisualizer() {
    if (!analyser) return
    const values = new Uint8Array(analyser.frequencyBinCount)
    const frame = () => {
      if (!analyser || !playing.value) { resetLevels(); return }
      analyser.getByteFrequencyData(values)
      const bucket = Math.floor(values.length / visualizerLevels.value.length)
      visualizerLevels.value = visualizerLevels.value.map((previous, index) => {
        const segment = values.slice(index * bucket, (index + 1) * bucket)
        const level = segment.reduce((sum, value) => sum + value, 0) / Math.max(1, segment.length) / 255
        return previous * .58 + level * .42
      })
      animationFrame = requestAnimationFrame(frame)
    }
    cancelAnimationFrame(animationFrame)
    animationFrame = requestAnimationFrame(frame)
  }
  function pauseForPlaybackOwner(ownerId: unknown) {
    if (typeof ownerId === 'string' && ownerId && ownerId !== playbackOwnerId && audio && !audio.paused) audio.pause()
  }
  function handlePlaybackClaim(event: Event) {
    pauseForPlaybackOwner((event as CustomEvent<unknown>).detail)
  }
  function handlePlaybackOwnerChange(event: StorageEvent) {
    if (event.key !== playbackOwnerStorageKey) return
    syncPlaybackOwner()
  }
  function syncPlaybackOwner() {
    try { pauseForPlaybackOwner(localStorage.getItem(playbackOwnerStorageKey)) } catch { /* Storage may be unavailable in private browsing mode. */ }
  }
  function startPlaybackCoordination() {
    if (playbackCoordinationStarted) return
    window.addEventListener(playbackClaimEvent, handlePlaybackClaim)
    window.addEventListener('storage', handlePlaybackOwnerChange)
    playbackCoordinationStarted = true
  }
  function stopPlaybackCoordination() {
    if (!playbackCoordinationStarted) return
    window.removeEventListener(playbackClaimEvent, handlePlaybackClaim)
    window.removeEventListener('storage', handlePlaybackOwnerChange)
    playbackCoordinationStarted = false
  }
  function claimPlayback() {
    startPlaybackCoordination()
    try { localStorage.setItem(playbackOwnerStorageKey, playbackOwnerId) } catch { /* Same-page coordination still prevents duplicate players. */ }
    window.dispatchEvent(new CustomEvent(playbackClaimEvent, { detail: playbackOwnerId }))
  }
  function ensureAudio() {
    if (audio) return audio
    startPlaybackCoordination()
    audio = new Audio()
    audio.preload = 'metadata'
    audio.addEventListener('play', () => { claimPlayback(); playing.value = true; startVisualizer() })
    audio.addEventListener('pause', () => { playing.value = false; cancelAnimationFrame(animationFrame); resetLevels(); savePlayback(true) })
    audio.addEventListener('timeupdate', () => { syncPlaybackOwner(); currentTime.value = audio?.currentTime || 0; updatePosition(); savePlayback() })
    audio.addEventListener('loadedmetadata', () => { duration.value = audio?.duration || 0; updatePosition() })
    audio.addEventListener('ended', () => void next())
    return audio
  }
  async function setupAnalyser(player: HTMLAudioElement) {
    if (source) return
    audioContext = new AudioContext()
    source = audioContext.createMediaElementSource(player)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 128
    source.connect(analyser)
    analyser.connect(audioContext.destination)
  }
  async function fetchPage(nextPage = page.value) {
    if (!canUseMusic() || loading.value) return
    if (!loaded.value && nextPage === 1 && savedPlayback) nextPage = savedPlayback.page
    loading.value = true
    loadError.value = ''
    try {
      const result = await get<{ playlist: { name: string; cover: string; auto_play?: boolean; auto_picture_in_picture?: boolean }; tracks: MusicTrack[]; pagination: { page: number; total: number; total_pages: number } }>(`/api/music/navbar-playlist?page=${nextPage}&limit=${pageSize}`)
      tracks.value = result.tracks.filter(track => trackHash(track))
      page.value = result.pagination.page
      total.value = result.pagination.total
      totalPages.value = result.pagination.total_pages
      playlistName.value = result.playlist.name
      playlistCover.value = result.playlist.cover || '/bx_logo.png'
      if (!automationConfigured) {
        autoPlay.value = Boolean(result.playlist.auto_play)
        autoPictureInPicture.value = Boolean(result.playlist.auto_picture_in_picture)
        autoPlayBlocked = false
        autoPictureInPictureConfirmed.value = false
        automationConfigured = true
      }
      if (!autoPlay.value) autoPlayBlocked = false
      const savedIndex = !currentTrack.value && savedPlayback ? tracks.value.findIndex(track => trackHash(track) === savedPlayback.hash) : -1
      const savedTrack = savedIndex >= 0 ? tracks.value[savedIndex] : undefined
      if (savedTrack && savedPlayback) {
        currentTrack.value = savedTrack
        currentIndex.value = savedIndex
        currentTime.value = savedPlayback!.position
        pendingRestore = { hash: savedPlayback!.hash, position: savedPlayback!.position }
      } else if (!currentTrack.value && tracks.value[0]) {
        currentTrack.value = tracks.value[0]
        currentIndex.value = 0
      }
      if (!autoPlayStarted && currentTrack.value && autoPlay.value) {
        autoPlayStarted = true
        void startAutoPlay()
      } else {
        syncAutomationVerificationRequired()
      }
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : '无法读取导航歌单'
    } finally {
      loaded.value = true
      loading.value = false
    }
  }
  async function loadLyrics(hash: string) {
    if (!canUseMusic()) { lyrics.value = []; return }
    try {
      const result = await get<{ lyrics: string | null }>(`/api/music/navbar-playlist/songs/${encodeURIComponent(hash)}/lyrics`)
      lyrics.value = parseLyrics(result.lyrics)
    } catch { lyrics.value = [] }
  }
  async function loadMv(hash: string, track: MusicTrack, playRequestId: number) {
    const request = ++mvRequest
    mv.value = null
    if (!canUseMusic() || !trackMvHash(track)) return
    try {
      const result = await get<{ mv?: MusicMv | null }>(`/api/music/navbar-playlist/songs/${encodeURIComponent(hash)}/mv`)
      if (request !== mvRequest || playRequestId !== playRequest || !result.mv?.downurl) return
      mv.value = {
        mvhash: result.mv.mvhash || trackMvHash(track),
        downurl: result.mv.downurl,
        backupdownurl: Array.isArray(result.mv.backupdownurl) ? result.mv.backupdownurl.filter((url): url is string => typeof url === 'string' && Boolean(url)) : [],
        filesize: typeof result.mv.filesize === 'number' && Number.isFinite(result.mv.filesize) ? result.mv.filesize : null,
      }
    } catch { /* 无可用 MV 时保持专辑封面背景。 */ }
  }
  async function playAt(index: number, initialVolume?: number) {
    if (!canUseMusic()) return
    if (!tracks.value.length) await fetchPage(1)
    const track = tracks.value[index]
    if (!track) return
    const hash = trackHash(track)
    if (!hash) return
    const request = ++playRequest
    trackLoading.value = true
    void loadMv(hash, track, request)
    try {
      const result = await get<{ url: string }>(`/api/music/navbar-playlist/songs/${encodeURIComponent(hash)}/play-url`)
      const player = ensureAudio()
      await setupAnalyser(player)
      if (request !== playRequest) return
      const blob = await getBlob(result.url)
      const objectUrl = URL.createObjectURL(blob)
      if (request !== playRequest) {
        URL.revokeObjectURL(objectUrl)
        return
      }
      if (initialVolume !== undefined) setVolume(initialVolume)
      else player.volume = volume.value
      const restorePosition = pendingRestore?.hash === hash ? pendingRestore.position : null
      pendingRestore = null
      releaseAudioObjectUrl()
      audioObjectUrl = objectUrl
      player.src = objectUrl
      currentIndex.value = index
      currentTrack.value = track
      currentTime.value = 0
      duration.value = 0
      lastPersistedSecond = -1
      if (restorePosition !== null) {
        await new Promise<void>(resolve => {
          const restore = () => {
            player.currentTime = Math.min(restorePosition, Number.isFinite(player.duration) ? player.duration : restorePosition)
            currentTime.value = player.currentTime
            resolve()
          }
          if (player.readyState >= HTMLMediaElement.HAVE_METADATA) restore()
          else player.addEventListener('loadedmetadata', restore, { once: true })
        })
      }
      void loadLyrics(hash)
      updateMediaSession()
      savePlayback(true)
      await player.play()
    } finally {
      if (request === playRequest) trackLoading.value = false
    }
  }
  async function startAutoPlay() {
    if (!autoPlay.value || autoPlayStarting || playing.value || !current.value) return
    autoPlayStarting = true
    try {
      await playAt(currentIndex.value >= 0 ? currentIndex.value : 0, .2)
    } catch (error) {
      if (!autoPlay.value) return
      autoPlayBlocked = error instanceof DOMException && error.name === 'NotAllowedError'
      if (!autoPlayBlocked) loadError.value = error instanceof Error ? error.message : '自动播放失败'
    } finally {
      autoPlayStarting = false
      syncAutomationVerificationRequired()
    }
  }
  async function confirmMusicAutomation() {
    automationVerificationRequired.value = false
    autoPlayBlocked = false
    if (autoPictureInPicture.value && documentPictureInPictureAvailable()) {
      autoPictureInPictureConfirmed.value = true
      if (current.value) updateMediaSession()
    }
    syncAutomationVerificationRequired()
    if (!autoPlay.value) return
    try {
      if (audioContext?.state === 'suspended') void audioContext.resume()
      if (audio?.src) await audio.play()
      else await playAt(currentIndex.value >= 0 ? currentIndex.value : 0)
    } catch (error) {
      autoPlayBlocked = error instanceof DOMException && error.name === 'NotAllowedError'
      loadError.value = error instanceof Error ? error.message : '播放失败'
      syncAutomationVerificationRequired()
    }
  }
  async function toggle() {
    if (playing.value) { audio?.pause(); return }
    if (audio?.src) { if (audioContext?.state === 'suspended') await audioContext.resume(); await audio.play(); return }
    await playAt(currentIndex.value >= 0 ? currentIndex.value : 0)
  }
  async function next() {
    if (currentIndex.value + 1 < tracks.value.length) return playAt(currentIndex.value + 1)
    if (page.value < totalPages.value) { await fetchPage(page.value + 1); return playAt(0) }
    await fetchPage(1); await playAt(0)
  }
  async function previous() {
    if (currentIndex.value > 0) return playAt(currentIndex.value - 1)
    if (page.value > 1) { await fetchPage(page.value - 1); return playAt(tracks.value.length - 1) }
  }
  function seek(value: number) {
    if (!audio || !duration.value) return
    const position = Math.max(0, Math.min(value, duration.value))
    audio.currentTime = position
    currentTime.value = position
    updatePosition()
    savePlayback(true)
  }
  function resetSession() {
    playRequest++
    mvRequest++
    tracks.value = []
    page.value = 1
    total.value = 0
    totalPages.value = 1
    currentIndex.value = -1
    currentTrack.value = null
    loading.value = false
    trackLoading.value = false
    loaded.value = false
    loadError.value = ''
    automationVerificationRequired.value = false
    playing.value = false
    currentTime.value = 0
    duration.value = 0
    lyrics.value = []
    mv.value = null
    pendingRestore = null
    lastPersistedSecond = -1
    autoPlayStarted = false
    autoPlayStarting = false
    autoPlayBlocked = false
    automationConfigured = false
    autoPictureInPictureConfirmed.value = false
    resetLevels()
  }
  function dispose() {
    playRequest++
    mvRequest++
    mv.value = null
    savePlayback(true)
    cancelAnimationFrame(animationFrame)
    audio?.pause()
    if (audio) {
      audio.removeAttribute('src')
      audio.load()
    }
    releaseAudioObjectUrl()
    source?.disconnect()
    analyser?.disconnect()
    void audioContext?.close()
    audio = null
    source = null
    analyser = null
    audioContext = null
    playing.value = false
    resetLevels()
    stopPlaybackCoordination()
    pictureInPictureRequestHandler = null
    if ('mediaSession' in navigator) {
      setMediaSessionAction('enterpictureinpicture', null)
      navigator.mediaSession.metadata = null
    }
  }
  return {tracks, playlistName, page, total, totalPages, currentIndex, current, title, artist, playerCover, loading, trackLoading, loaded, loadError, autoPlay, autoPictureInPicture, autoPictureInPictureConfirmed, automationVerificationRequired, playing, currentTime, duration, lyrics, mv, currentLyric, currentLyricIndex, progress, visualizerLevels, volume, setVolume, fetchPage, startAutoPlay, confirmMusicAutomation, playAt, toggle, next, previous, seek, setPictureInPictureRequestHandler, resetSession, dispose}
})
