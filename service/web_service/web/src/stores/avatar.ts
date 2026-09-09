import { ref } from 'vue'
import { defineStore } from 'pinia'
import { avatarRequest } from '../utils/login'

export const useAvatarStore = defineStore('avatar', () => {
  const urls = ref<Record<string, string>>({})
  const loading = ref(false)

  async function load(usernames: string[]) {
    const unique = [...new Set(usernames.filter(Boolean))].slice(0, 50)
    if (!unique.length) return
    loading.value = true
    try {
      const result = await avatarRequest(unique)
      if (result.success) result.avatars.forEach(item => { urls.value[item.username] = item.avatar_url })
    } finally {
      loading.value = false
    }
  }

  function get(username?: string | null) { return username ? urls.value[username] : undefined }
  function clear() { urls.value = {} }
  return { urls, loading, load, get, clear }
})
