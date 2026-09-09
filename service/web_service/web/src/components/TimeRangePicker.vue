<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import BaseSelect from './BaseSelect.vue'
import DatePicker from './DatePicker.vue'

export interface TimeRangeValue {
  from: string
  to: string
}

const props = defineProps<{modelValue: TimeRangeValue}>()
const emit = defineEmits<{(event: 'update:modelValue', value: TimeRangeValue): void}>()

const root = ref<HTMLElement | null>(null)
const open = ref(false)
const error = ref('')
const startDate = ref('')
const startHour = ref('00')
const startMinute = ref('00')
const startSecond = ref('00')
const endDate = ref('')
const endHour = ref('23')
const endMinute = ref('59')
const endSecond = ref('59')
const hours = Array.from({length: 24}, (_, index) => String(index).padStart(2, '0'))
const units = Array.from({length: 60}, (_, index) => String(index).padStart(2, '0'))

function localParts(value: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return {
    date: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    hour: String(date.getHours()).padStart(2, '0'),
    minute: String(date.getMinutes()).padStart(2, '0'),
    second: String(date.getSeconds()).padStart(2, '0'),
  }
}

function syncDraft() {
  const start = localParts(props.modelValue.from)
  const end = localParts(props.modelValue.to)
  startDate.value = start?.date || ''
  startHour.value = start?.hour || '00'
  startMinute.value = start?.minute || '00'
  startSecond.value = start?.second || '00'
  endDate.value = end?.date || ''
  endHour.value = end?.hour || '23'
  endMinute.value = end?.minute || '59'
  endSecond.value = end?.second || '59'
  error.value = ''
}

function parseLocal(dateValue: string, hour: string, minute: string, second: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return null
  const parts = dateValue.split('-').map(Number)
  const year = parts[0]
  const month = parts[1]
  const day = parts[2]
  if (year === undefined || month === undefined || day === undefined) return null
  const date = new Date(year, month - 1, day, Number(hour), Number(minute), Number(second), 0)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

function toggle() {
  if (!open.value) syncDraft()
  open.value = !open.value
}

function apply() {
  if (!startDate.value && !endDate.value) {
    emit('update:modelValue', {from: '', to: ''})
    open.value = false
    return
  }
  if (!startDate.value || !endDate.value) {
    error.value = '请选择完整的开始和结束日期'
    return
  }
  const start = parseLocal(startDate.value, startHour.value, startMinute.value, startSecond.value)
  const end = parseLocal(endDate.value, endHour.value, endMinute.value, endSecond.value)
  if (!start || !end) {
    error.value = '日期格式无效，请使用 YYYY-MM-DD'
    return
  }
  if (start > end) {
    error.value = '开始时间不能晚于结束时间'
    return
  }
  emit('update:modelValue', {from: start.toISOString(), to: end.toISOString()})
  open.value = false
}

function clear() {
  startDate.value = ''
  endDate.value = ''
  error.value = ''
  emit('update:modelValue', {from: '', to: ''})
  open.value = false
}

const summary = computed(() => {
  const start = localParts(props.modelValue.from)
  const end = localParts(props.modelValue.to)
  if (!start || !end) return '选择时间范围'
  return `${start.date} ${start.hour}:${start.minute}:${start.second}  至  ${end.date} ${end.hour}:${end.minute}:${end.second}`
})

function closeOnOutside(event: MouseEvent) {
  if (open.value && root.value && !root.value.contains(event.target as Node)) open.value = false
}

watch(() => props.modelValue, () => { if (!open.value) syncDraft() }, {deep: true})
onMounted(() => document.addEventListener('mousedown', closeOnOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', closeOnOutside))
</script>

<template>
  <div ref="root" class="time-range-picker">
    <button class="range-trigger" type="button" :class="{ selected: modelValue.from && modelValue.to }" :aria-expanded="open" @click="toggle">
      <span class="clock-face" aria-hidden="true"><i></i><b></b></span>
      <span class="range-summary">{{ summary }}</span>
      <span class="range-chevron" aria-hidden="true"></span>
    </button>
    <Transition name="range-panel">
      <section v-if="open" class="range-popover">
        <header><div><span>TIME RANGE</span><strong>精确时间范围</strong></div><button type="button" aria-label="关闭" @click="open = false">×</button></header>
        <div class="range-columns">
          <fieldset>
            <legend><span>01</span>开始时间</legend>
            <label><span>日期</span><DatePicker v-model="startDate" aria-label="开始日期" /></label>
            <div class="time-fields">
              <label><span>时</span><BaseSelect v-model="startHour" :options="hours" aria-label="开始小时" /></label>
              <b>:</b>
              <label><span>分</span><BaseSelect v-model="startMinute" :options="units" aria-label="开始分钟" /></label>
              <b>:</b>
              <label><span>秒</span><BaseSelect v-model="startSecond" :options="units" aria-label="开始秒数" /></label>
            </div>
          </fieldset>
          <span class="range-arrow" aria-hidden="true">→</span>
          <fieldset>
            <legend><span>02</span>结束时间</legend>
            <label><span>日期</span><DatePicker v-model="endDate" aria-label="结束日期" /></label>
            <div class="time-fields">
              <label><span>时</span><BaseSelect v-model="endHour" :options="hours" aria-label="结束小时" /></label>
              <b>:</b>
              <label><span>分</span><BaseSelect v-model="endMinute" :options="units" aria-label="结束分钟" /></label>
              <b>:</b>
              <label><span>秒</span><BaseSelect v-model="endSecond" :options="units" aria-label="结束秒数" /></label>
            </div>
          </fieldset>
        </div>
        <p v-if="error" class="range-error">{{ error }}</p>
        <footer><button class="clear-range" type="button" @click="clear">清除时间</button><button class="apply-range" type="button" @click="apply">应用范围</button></footer>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.time-range-picker { position: relative; min-width: 0; }
.range-trigger { display: grid; grid-template-columns: 22px minmax(0, 1fr) 14px; align-items: center; gap: 7px; width: 100%; height: 36px; padding: 0 9px; color: var(--muted-text); background: var(--surface); border: 1px solid var(--border); border-radius: 4px; text-align: left; }
.range-trigger:hover, .range-trigger[aria-expanded="true"] { border-color: var(--accent); }
.range-trigger.selected { color: var(--panel-text); }
.clock-face { position: relative; display: block; width: 16px; height: 16px; border: 1.5px solid currentColor; border-radius: 50%; }
.clock-face i, .clock-face b { position: absolute; left: 7px; top: 3px; width: 1px; height: 5px; background: currentColor; transform-origin: bottom; }
.clock-face b { transform: rotate(120deg); }
.range-summary { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; }
.range-chevron { position: relative; display: block; width: 14px; height: 14px; color: var(--muted-text); }
.range-chevron::before { content: ""; position: absolute; top: 50%; left: 50%; width: 6px; height: 6px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: translate(-50%, -68%) rotate(45deg); transition: transform .2s ease; }
.range-trigger[aria-expanded="true"] .range-chevron::before { transform: translate(-50%, -30%) rotate(225deg); }
.range-popover { position: absolute; z-index: 20; top: calc(100% + 7px); right: 0; width: min(590px, calc(100vw - 50px)); padding: 15px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 20px 48px var(--shadow); }
.range-popover > header { display: flex; align-items: center; justify-content: space-between; padding-bottom: 12px; border-bottom: 1px solid var(--border); }
.range-popover > header div { display: grid; gap: 4px; }
.range-popover > header span { color: var(--accent); font-size: 8px; font-weight: 750; letter-spacing: .12em; }
.range-popover > header strong { font-size: 13px; }
.range-popover > header button { width: 27px; height: 27px; color: var(--muted-text); background: transparent; border: 0; font-size: 20px; }
.range-columns { display: grid; grid-template-columns: minmax(0, 1fr) 22px minmax(0, 1fr); align-items: center; gap: 9px; padding: 14px 0; }
.range-columns fieldset { min-width: 0; margin: 0; padding: 11px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
.range-columns legend { padding: 0 5px; font-size: 10px; font-weight: 700; }
.range-columns legend span { margin-right: 6px; color: var(--accent); font-size: 8px; font-weight: 750; }
.range-columns label { display: grid; gap: 5px; min-width: 0; color: var(--muted-text); font-size: 9px; font-weight: 650; }
.time-fields { display: grid; grid-template-columns: 1fr auto 1fr auto 1fr; align-items: end; gap: 4px; margin-top: 10px; }
.time-fields > b { padding-bottom: 9px; color: var(--muted-text); font-size: 10px; }
.range-arrow { color: var(--accent); text-align: center; }
.range-error { margin: 0 0 10px; padding: 7px 9px; color: var(--danger); background: color-mix(in srgb, var(--danger) 9%, transparent); border: 1px solid color-mix(in srgb, var(--danger) 25%, transparent); border-radius: 4px; font-size: 10px; }
.range-popover > footer { display: flex; justify-content: flex-end; gap: 7px; padding-top: 11px; border-top: 1px solid var(--border); }
.range-popover > footer button { height: 33px; padding: 0 11px; border-radius: 4px; font-size: 10px; font-weight: 700; }
.clear-range { color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); }
.apply-range { color: var(--accent-contrast); background: var(--accent); border: 1px solid var(--accent); }
.range-panel-enter-active, .range-panel-leave-active { transition: opacity .16s ease, transform .2s cubic-bezier(.22, 1, .36, 1); transform-origin: top right; }
.range-panel-enter-from, .range-panel-leave-to { opacity: 0; transform: translateY(-5px) scale(.985); }
@media (max-width: 620px) { .range-popover { position: fixed; top: 74px; left: 12px; right: 12px; width: auto; max-height: calc(100vh - 90px); overflow: auto; } .range-columns { grid-template-columns: 1fr; } .range-arrow { transform: rotate(90deg); } }
@media (prefers-reduced-motion: reduce) { .range-panel-enter-active, .range-panel-leave-active { transition-duration: .01ms; } }
</style>
