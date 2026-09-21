<script lang="ts" setup>
import {watch} from 'vue'
import {storeToRefs} from 'pinia'
import DefaultPage from './default.vue'
import SelfPage from './self.vue'
import {useAuthStore} from '../../stores/auth'
import {type HomeView, useHomeViewStore} from '../../stores/homeView'

const authStore = useAuthStore()
const homeViewStore = useHomeViewStore()
const {activeView} = storeToRefs(homeViewStore)

function setView(view: HomeView) {
  homeViewStore.setView(view)
}

watch(() => authStore.isLoggedIn, isLoggedIn => {
  if (!isLoggedIn) homeViewStore.showServerWithoutPersisting()
  else homeViewStore.restoreSavedView()
})
</script>

<template>
  <div class="home-view-stage">
    <Transition mode="out-in" name="home-view-switch">
      <SelfPage
          v-if="authStore.isLoggedIn && activeView === 'profile'"
          key="profile"
          class="home-view-content"
          @change-view="setView"
      />
      <DefaultPage
          v-else
          key="server"
          class="home-view-content"
          @change-view="setView"
      />
    </Transition>
  </div>
</template>

<style scoped>
.home-view-stage {
  position: relative;
  min-width: 0;
}

.home-view-stage > * {
  min-width: 0;
}

.home-view-switch-enter-active {
  transition: opacity .2s ease, transform .28s cubic-bezier(.22, 1, .36, 1), filter .2s ease;
}

.home-view-switch-leave-active {
  transition: opacity .14s ease, transform .18s cubic-bezier(.4, 0, 1, 1), filter .14s ease;
}

.home-view-switch-enter-from {
  opacity: 0;
  filter: blur(2px);
  transform: translateY(12px) scale(.995);
}

.home-view-switch-leave-to {
  opacity: 0;
  filter: blur(2px);
  transform: translateY(-7px) scale(.998);
}

@media (prefers-reduced-motion: reduce) {
  .home-view-switch-enter-active,
  .home-view-switch-leave-active {
    transition-duration: .01ms;
  }

  .home-view-switch-enter-from,
  .home-view-switch-leave-to {
    filter: none;
    transform: none;
  }
}
</style>
