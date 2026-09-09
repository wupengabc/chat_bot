import { ref } from 'vue'
import { defineStore } from 'pinia'
import { selfRequest, type SelfUser } from '../utils/login'

export const useSelfInfoStore = defineStore('self-info', () => {
  const user = ref<SelfUser | null>(null)
  const loading = ref(false)
  let requestPromise: Promise<SelfUser> | undefined

  async function load(force = false) {
    if (user.value && !force) return user.value
    if (!requestPromise) {
      loading.value = true
      requestPromise = selfRequest()
        .then(result => { user.value = result.user; return result.user })
        .finally(() => { loading.value = false; requestPromise = undefined })
    }
    return requestPromise
  }

  function clear() { user.value = null }
  return { user, loading, load, clear }
})
