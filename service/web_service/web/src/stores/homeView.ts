import { ref } from 'vue'
import { defineStore } from 'pinia'

export type HomeView = 'profile' | 'server'

const storageKey = 'bangxi-home-view'

export const useHomeViewStore = defineStore('homeView', () => {
  const storedView = localStorage.getItem(storageKey)
  const activeView = ref<HomeView>(storedView === 'server' ? 'server' : 'profile')

  function setView(view: HomeView) {
    activeView.value = view
    localStorage.setItem(storageKey, view)
  }

  function showServerWithoutPersisting() {
    activeView.value = 'server'
  }

  function restoreSavedView() {
    activeView.value = localStorage.getItem(storageKey) === 'server' ? 'server' : 'profile'
  }

  return { activeView, setView, showServerWithoutPersisting, restoreSavedView }
})
