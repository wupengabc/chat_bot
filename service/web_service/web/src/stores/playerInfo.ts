import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { motdRequest, playersRequest, type OnlinePlayer } from '../utils/login'

export const usePlayerInfoStore = defineStore('player-info', () => {
  const playerCount = computed(() => players.value.length)
  const motd = ref<Awaited<ReturnType<typeof motdRequest>>['motd']>(null)
  const players = ref<OnlinePlayer[]>([])
  const available = ref(false)
  const loading = ref(true)
  const playersLoading = ref(false)
  const playersLoaded = ref(false)
  const motdRefreshing = ref(false)
  let motdLoaded = false
  let timer: ReturnType<typeof setInterval> | undefined
  let lastMotdRefreshAt = 0
  let motdRequestPromise: Promise<void> | undefined
  let playersRequestPromise: Promise<void> | undefined

  function refreshPlayers() {
    if (playersRequestPromise) return playersRequestPromise
    playersLoading.value = true
    playersRequestPromise = playersRequest()
      .then(result => {
        available.value = result.success && result.available
        players.value = available.value ? result.players : []
      })
      .catch(() => {
        available.value = false
        players.value = []
      })
      .finally(() => {
        playersLoaded.value = true
        playersLoading.value = false
        playersRequestPromise = undefined
      })
    return playersRequestPromise
  }

  function ensurePlayers() {
    return playersLoaded.value ? Promise.resolve() : refreshPlayers()
  }

  function refreshMotdData() {
    if (motdRequestPromise) return motdRequestPromise
    loading.value = true
    motdRequestPromise = motdRequest()
      .then(result => {
        motd.value = result.success && result.available ? result.motd : null
      })
      .catch(() => {
        motd.value = null
      })
      .finally(() => {
        motdLoaded = true
        loading.value = false
        motdRequestPromise = undefined
      })
    return motdRequestPromise
  }

  async function refresh() {
    await Promise.all([refreshMotdData(), refreshPlayers()])
  }

  async function refreshMotd() {
    const now = Date.now()
    if (motdRequestPromise || now - lastMotdRefreshAt < 5_000) return false

    lastMotdRefreshAt = now
    motdRefreshing.value = true
    await Promise.all([refreshMotdData(), refreshPlayers()])
    motdRefreshing.value = false
    return true
  }

  function start() {
    if (timer) return
    if (!motdLoaded || !playersLoaded.value) {
      void Promise.all([
        motdLoaded ? Promise.resolve() : refreshMotdData(),
        playersLoaded.value ? Promise.resolve() : refreshPlayers(),
      ])
    }
    timer = setInterval(() => void refresh(), 15_000)
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  return { playerCount, motd, players, available, loading, playersLoading, playersLoaded, motdRefreshing, refresh, ensurePlayers, refreshPlayers, refreshMotd, start, stop }
})
