<script setup lang="ts">
import { computed, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  username?: string | null
  url?: string
  loading?: boolean
  size?: 'small' | 'large'
}>(), { username: '', url: '', loading: false, size: 'small' })

const imageLoaded = ref(false)
const imageFailed = ref(false)
const initial = computed(() => (props.username?.trim().charAt(0) || '?').toUpperCase())

watch(() => props.url, () => {
  imageLoaded.value = false
  imageFailed.value = false
})
</script>

<template>
  <span class="user-avatar" :class="[`avatar-${size}`, { loading: loading && !imageLoaded }]">
    <span class="avatar-placeholder"><i /><b>{{ initial }}</b></span>
    <img
      v-if="url && !imageFailed"
      :class="{ visible: imageLoaded }"
      :src="url"
      :alt="`${username || '玩家'} 头像`"
      @load="imageLoaded = true"
      @error="imageFailed = true"
    />
  </span>
</template>

<style scoped>
.user-avatar { position: relative; display: grid; flex: 0 0 auto; place-items: center; overflow: hidden; color: var(--muted-text); background: var(--surface-selected); border: 1px solid color-mix(in srgb, var(--border) 78%, transparent); border-radius: 5px; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--panel-bg) 55%, transparent); }
.avatar-small { width: 27px; height: 27px; font-size: 9px; }
.avatar-large { width: 42px; height: 42px; font-size: 11px; }
.avatar-placeholder { position: relative; z-index: 1; display: grid; place-items: center; width: 100%; height: 100%; }
.avatar-placeholder i { position: absolute; top: 20%; width: 30%; aspect-ratio: 1; background: color-mix(in srgb, var(--muted-text) 42%, transparent); border-radius: 50%; }
.avatar-placeholder i::after { content: ""; position: absolute; top: 125%; left: -50%; width: 200%; height: 105%; background: color-mix(in srgb, var(--muted-text) 42%, transparent); border-radius: 5px 5px 0 0; }
.avatar-placeholder b { position: absolute; right: 3px; bottom: 1px; color: var(--panel-text); font-size: .72em; line-height: 1; opacity: .65; }
.user-avatar img { position: absolute; z-index: 2; inset: 0; width: 100%; height: 100%; object-fit: cover; image-rendering: pixelated; opacity: 0; transition: opacity .2s ease; }
.user-avatar img.visible { opacity: 1; }
.user-avatar.loading::after { content: ""; position: absolute; z-index: 3; inset: 0; background: linear-gradient(100deg, transparent 20%, color-mix(in srgb, var(--panel-bg) 74%, transparent) 48%, transparent 76%); transform: translateX(-100%); animation: avatar-loading 1.1s ease-in-out infinite; }
@keyframes avatar-loading { to { transform: translateX(100%); } }
</style>
