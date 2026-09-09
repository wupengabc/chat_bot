<script setup lang="ts">
import {nextTick, onBeforeUnmount, onMounted, ref, watch} from 'vue'

type SelectOption = string | {label: string; value: string}
const props = withDefaults(defineProps<{modelValue: string; options: SelectOption[]; ariaLabel?: string; placement?: 'top' | 'bottom'}>(), {
  placement: 'bottom',
})
const emit = defineEmits<{(event: 'update:modelValue', value: string): void}>()
const root = ref<HTMLElement | null>(null)
const list = ref<HTMLElement | null>(null)
const open = ref(false)
const activeIndex = ref(0)
const menuStyle = ref<Record<string, string>>({})
const valueOf = (option: SelectOption) => typeof option === 'string' ? option : option.value
const labelOf = (option: SelectOption) => typeof option === 'string' ? option : option.label
const selectedLabel = () => labelOf(props.options.find(option => valueOf(option) === props.modelValue) || props.modelValue)

function positionMenu() {
  const rect = root.value?.getBoundingClientRect()
  if (!rect) return
  const openAbove = props.placement === 'top' || (rect.bottom + 177 > window.innerHeight && rect.top > 177)
  menuStyle.value = openAbove
    ? {left: `${rect.left}px`, bottom: `${window.innerHeight - rect.top + 3}px`, width: `${rect.width}px`}
    : {left: `${rect.left}px`, top: `${rect.bottom + 3}px`, width: `${rect.width}px`}
}

function openList() {
  activeIndex.value = Math.max(0, props.options.findIndex(option => valueOf(option) === props.modelValue))
  open.value = true
  void nextTick(() => {
    positionMenu()
    list.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({block: 'nearest'})
  })
}

function toggle() {
  if (open.value) open.value = false
  else openList()
}

function choose(option: SelectOption) {
  emit('update:modelValue', valueOf(option))
  open.value = false
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { open.value = false; return }
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  if (!open.value) { openList(); return }
  if (event.key === 'Enter' || event.key === ' ') { choose(props.options[activeIndex.value] || props.modelValue); return }
  const direction = event.key === 'ArrowDown' ? 1 : -1
  activeIndex.value = (activeIndex.value + direction + props.options.length) % props.options.length
  void nextTick(() => list.value?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({block: 'nearest'}))
}

function closeOnOutside(event: MouseEvent) {
  if (root.value && !root.value.contains(event.target as Node) && !list.value?.contains(event.target as Node)) open.value = false
}

watch(() => props.modelValue, value => { if (!open.value) activeIndex.value = Math.max(0, props.options.findIndex(option => valueOf(option) === value)) })
onMounted(() => { document.addEventListener('mousedown', closeOnOutside); window.addEventListener('resize', positionMenu); window.addEventListener('scroll', positionMenu, true) })
onBeforeUnmount(() => { document.removeEventListener('mousedown', closeOnOutside); window.removeEventListener('resize', positionMenu); window.removeEventListener('scroll', positionMenu, true) })
</script>

<template>
  <div ref="root" class="base-select" :class="`placement-${placement}`">
    <button class="select-trigger" type="button" :aria-label="ariaLabel" :aria-expanded="open" @click="toggle" @keydown="handleKeydown">
       <span>{{ selectedLabel() }}</span><i aria-hidden="true"></i>
    </button>
    <Teleport to="body">
      <Transition name="select-menu">
      <div v-if="open" ref="list" class="select-options" :style="menuStyle" role="listbox">
         <button v-for="(option, index) in options" :key="valueOf(option)" type="button" role="option" :aria-selected="valueOf(option) === modelValue" :data-active="index === activeIndex" :class="{selected: valueOf(option) === modelValue, active: index === activeIndex}" @mouseenter="activeIndex = index" @click="choose(option)">{{ labelOf(option) }}</button>
      </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.base-select { position: relative; min-width: 0; }
.select-trigger { display: grid; grid-template-columns: 1fr 12px; align-items: center; width: 100%; height: 34px; padding: 0 7px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 3px; text-align: left; font-size: 11px; }
.select-trigger:hover, .select-trigger[aria-expanded="true"], .select-trigger:focus-visible { border-color: var(--accent); outline: none; }
.select-trigger i { position: relative; display: block; width: 12px; height: 12px; color: var(--muted-text); font-style: normal; }
.select-trigger i::before { content: ""; position: absolute; top: 50%; left: 50%; width: 5px; height: 5px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translate(-50%, -68%) rotate(45deg); transition: transform .18s ease; }
.select-trigger[aria-expanded="true"] i::before { transform: translate(-50%, -30%) rotate(225deg); }
.select-options { position: fixed; z-index: 120; max-height: 174px; box-sizing: border-box; padding: 3px; overflow-y: auto; background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; box-shadow: 0 12px 28px var(--shadow); scrollbar-width: thin; }
.select-options::-webkit-scrollbar { width: 4px; }
.select-options button { display: block; width: 100%; height: 28px; padding: 0 7px; color: var(--muted-text); background: transparent; border: 0; border-radius: 2px; text-align: left; font-size: 10px; }
.select-options button:hover, .select-options button.active { color: var(--panel-text); background: var(--surface-hover); }
.select-options button.selected { color: var(--accent-contrast); background: var(--accent); font-weight: 700; }
.select-menu-enter-active, .select-menu-leave-active { transition: opacity .12s ease, transform .15s ease; transform-origin: top; }
.select-menu-enter-from, .select-menu-leave-to { opacity: 0; transform: translateY(-3px) scale(.98); }
</style>
