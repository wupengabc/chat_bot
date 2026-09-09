<script setup lang="ts">
import { nextTick, onUnmounted, ref } from 'vue'

const props = withDefaults(defineProps<{
  text: string
  placement?: 'bottom' | 'top'
  triggerClass?: string
  triggerStyle?: Record<string, string>
}>(), { placement: 'bottom', triggerClass: '', triggerStyle: () => ({}) })
const open = ref(false)
const trigger = ref<HTMLElement | null>(null)
const tooltip = ref<HTMLElement | null>(null)
const position = ref({ top: '0px', left: '0px' })
let timer: ReturnType<typeof setTimeout> | undefined
let positionFrame = 0

function triggerElement() {
  const element = trigger.value
  if (!element) return null
  return element.firstElementChild instanceof HTMLElement ? element.firstElementChild : element
}

function positionTooltip() {
  const triggerRect = triggerElement()?.getBoundingClientRect()
  const tooltipRect = tooltip.value?.getBoundingClientRect()
  if (!triggerRect || !tooltipRect) return
  const top = props.placement === 'top'
    ? triggerRect.top - tooltipRect.height - 8
    : triggerRect.bottom + 8
  const left = Math.min(window.innerWidth - tooltipRect.width - 8, Math.max(8, triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2))
  position.value = { top: `${Math.max(8, top)}px`, left: `${left}px` }
}

async function show() {
  if (timer) clearTimeout(timer)
  timer = setTimeout(async () => {
    timer = undefined
    open.value = true
    await nextTick()
    positionTooltip()
  }, 260)
}

function hide() {
  if (timer) clearTimeout(timer)
  timer = undefined
  if (positionFrame) cancelAnimationFrame(positionFrame)
  positionFrame = 0
  open.value = false
}

function updatePosition() {
  if (!open.value || positionFrame) return
  positionFrame = requestAnimationFrame(() => {
    positionFrame = 0
    positionTooltip()
  })
}

window.addEventListener('scroll', updatePosition, true)
window.addEventListener('resize', updatePosition)
onUnmounted(() => {
  hide()
  window.removeEventListener('scroll', updatePosition, true)
  window.removeEventListener('resize', updatePosition)
})
</script>

<template>
  <span ref="trigger" class="tooltip-trigger" :class="triggerClass" :style="triggerStyle" @mouseenter="show" @mouseleave="hide" @focusin="show" @focusout="hide" @click="hide">
    <slot />
  </span>
  <Teleport to="body">
    <Transition name="tooltip">
      <span v-if="open" ref="tooltip" class="tooltip-content" role="tooltip" :style="position">{{ text }}</span>
    </Transition>
  </Teleport>
</template>

<style scoped>
.tooltip-trigger { display: inline-flex; min-width: 0; }
.tooltip-content { position: fixed; z-index: 300; max-width: 260px; padding: 7px 9px; color: var(--page-text); background: color-mix(in srgb, var(--page-bg-end) 90%, var(--accent)); border: 1px solid color-mix(in srgb, var(--accent) 44%, transparent); border-radius: 5px; box-shadow: 0 10px 24px var(--shadow); font-size: 10px; line-height: 1.4; pointer-events: none; }
.tooltip-enter-active, .tooltip-leave-active { transition: opacity .16s ease, transform .2s cubic-bezier(.22,1,.36,1); }
.tooltip-enter-from, .tooltip-leave-to { opacity: 0; transform: translateY(-3px) scale(.97); }
</style>
