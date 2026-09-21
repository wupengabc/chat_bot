<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  text: string
  gap?: number
  speed?: number
}>(), {
  gap: 36,
  speed: 44,
})

const viewport = ref<HTMLElement | null>(null)
const track = ref<HTMLElement | null>(null)
const overflowing = ref(false)
const travel = ref(0)

let resizeObserver: ResizeObserver | null = null
let measurementFrame = 0

const trackStyle = computed(() => {
  if (!overflowing.value) return undefined
  const duration = Math.max(4.5, travel.value / props.speed)
  return {
    '--music-scroll-duration': `${duration}s`,
    '--music-scroll-gap': `${props.gap}px`,
    '--music-scroll-travel': `${travel.value}px`,
  }
})

function measureOverflow() {
  const root = viewport.value
  const first = track.value?.firstElementChild
  if (!root || !(first instanceof HTMLElement)) return
  const textWidth = Math.ceil(first.scrollWidth - (overflowing.value ? props.gap : 0))
  const shouldOverflow = textWidth > root.clientWidth + 1 && props.text.trim().length > 0
  travel.value = shouldOverflow ? textWidth - root.clientWidth + props.gap : 0
  overflowing.value = shouldOverflow
}

function scheduleMeasurement() {
  cancelAnimationFrame(measurementFrame)
  measurementFrame = requestAnimationFrame(measureOverflow)
}

watch(() => props.text, async () => {
  overflowing.value = false
  travel.value = 0
  await nextTick()
  scheduleMeasurement()
}, { flush: 'post' })

onMounted(() => {
  const ObserverClass = viewport.value?.ownerDocument.defaultView?.ResizeObserver ?? ResizeObserver
  resizeObserver = new ObserverClass(scheduleMeasurement)
  if (viewport.value) resizeObserver.observe(viewport.value)
  scheduleMeasurement()
  void viewport.value?.ownerDocument.fonts?.ready.then(scheduleMeasurement)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  cancelAnimationFrame(measurementFrame)
})
</script>

<template>
  <div ref="viewport" class="music-scrolltext" :aria-label="text">
    <div :key="text" ref="track" class="music-scrolltext-track" :class="{ 'music-scrolltext-overflowing': overflowing }" :style="trackStyle">
      <span>{{ text }}</span>
    </div>
  </div>
</template>

<style>
.music-scrolltext { display:block; width:100%; max-width:100%; min-width:0; overflow:hidden; white-space:nowrap; }
.music-scrolltext-track { display:inline-flex; align-items:baseline; width:max-content; max-width:none; min-width:0; white-space:nowrap; will-change:transform; }
.music-scrolltext-track>span { flex:0 0 auto; max-width:100%; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.music-scrolltext-track.music-scrolltext-overflowing>span { max-width:none; overflow:visible; text-overflow:clip; }
.music-scrolltext-track.music-scrolltext-overflowing { animation:music-scrolltext var(--music-scroll-duration) linear infinite; }
@keyframes music-scrolltext { to { transform:translateX(calc(-1 * var(--music-scroll-travel))); } }
@media (prefers-reduced-motion:reduce) { .music-scrolltext-track.music-scrolltext-overflowing { animation:none; } }
</style>
