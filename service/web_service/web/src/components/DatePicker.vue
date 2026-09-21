<script setup lang="ts">
import {computed, onBeforeUnmount, onMounted, ref} from 'vue'

const props = defineProps<{modelValue: string; ariaLabel?: string}>()
const emit = defineEmits<{(event: 'update:modelValue', value: string): void}>()
const root = ref<HTMLElement | null>(null)
const open = ref(false)
const now = new Date()
const viewYear = ref(now.getFullYear())
const viewMonth = ref(now.getMonth())
const weekdays = ['一', '二', '三', '四', '五', '六', '日']

function parseValue(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

const title = computed(() => `${viewYear.value} 年 ${String(viewMonth.value + 1).padStart(2, '0')} 月`)
const calendarDays = computed(() => {
  const first = new Date(viewYear.value, viewMonth.value, 1)
  const mondayOffset = (first.getDay() + 6) % 7
  const start = new Date(viewYear.value, viewMonth.value, 1 - mondayOffset)
  return Array.from({length: 42}, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
    return {key: dateKey(date), day: date.getDate(), current: date.getMonth() === viewMonth.value, today: dateKey(date) === dateKey(now)}
  })
})

function toggle() {
  if (!open.value) {
    const selected = parseValue(props.modelValue)
    if (selected) { viewYear.value = selected.getFullYear(); viewMonth.value = selected.getMonth() }
  }
  open.value = !open.value
}

function changeMonth(offset: number) {
  const next = new Date(viewYear.value, viewMonth.value + offset, 1)
  viewYear.value = next.getFullYear()
  viewMonth.value = next.getMonth()
}

function choose(value: string) {
  emit('update:modelValue', value)
  const selected = parseValue(value)
  if (selected) { viewYear.value = selected.getFullYear(); viewMonth.value = selected.getMonth() }
  open.value = false
}

function chooseToday() { choose(dateKey(now)) }
function onInput(event: Event) { emit('update:modelValue', (event.target as HTMLInputElement).value) }
function closeOnOutside(event: MouseEvent) { if (root.value && !root.value.contains(event.target as Node)) open.value = false }
onMounted(() => document.addEventListener('mousedown', closeOnOutside))
onBeforeUnmount(() => document.removeEventListener('mousedown', closeOnOutside))
</script>

<template>
  <div ref="root" class="date-picker">
    <div class="date-input-shell" :class="{open}">
      <input :value="modelValue" inputmode="numeric" maxlength="10" placeholder="YYYY-MM-DD" :aria-label="ariaLabel" @input="onInput" />
      <button type="button" aria-label="打开日历" @click="toggle"><span aria-hidden="true"><i></i><b></b></span></button>
    </div>
    <Transition name="calendar-panel">
      <section v-if="open" class="calendar-popover">
        <header><button type="button" aria-label="上个月" @click="changeMonth(-1)">‹</button><strong>{{ title }}</strong><button type="button" aria-label="下个月" @click="changeMonth(1)">›</button></header>
        <div class="weekdays"><span v-for="day in weekdays" :key="day">{{ day }}</span></div>
        <div class="calendar-grid"><button v-for="day in calendarDays" :key="day.key" type="button" :class="{outside: !day.current, selected: day.key === modelValue, today: day.today}" @click="choose(day.key)">{{ day.day }}</button></div>
        <footer><button type="button" @click="emit('update:modelValue', '')">清空</button><button type="button" @click="chooseToday">今天</button></footer>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.date-picker { position: relative; min-width: 0; }
.date-input-shell { display: grid; grid-template-columns: minmax(0, 1fr) 34px; background: var(--panel-bg); border: 1px solid var(--border); border-radius: 3px; }
.date-input-shell:hover, .date-input-shell:focus-within, .date-input-shell.open { border-color: var(--accent); }
.date-input-shell input { width: 100%; height: 32px; padding: 0 8px; color: var(--panel-text); background: transparent; border: 0; outline: none; font-size: 11px; }
.date-input-shell > button { display: grid; place-items: center; color: var(--muted-text); background: transparent; border: 0; border-left: 1px solid var(--border); }
.date-input-shell > button span { position: relative; display: block; width: 14px; height: 13px; border: 1.5px solid currentColor; border-radius: 2px; }
.date-input-shell > button span::before { content: ""; position: absolute; left: -1.5px; right: -1.5px; top: 3px; border-top: 1.5px solid currentColor; }
.date-input-shell > button i, .date-input-shell > button b { position: absolute; top: -3px; width: 1.5px; height: 4px; background: currentColor; }
.date-input-shell > button i { left: 3px; } .date-input-shell > button b { right: 3px; }
.calendar-popover { position: absolute; z-index: 35; top: calc(100% + 4px); left: 0; width: 238px; padding: 10px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 4px; box-shadow: 0 16px 34px var(--shadow); }
.calendar-popover header { display: grid; grid-template-columns: 28px 1fr 28px; align-items: center; margin-bottom: 8px; }
.calendar-popover header strong { text-align: center; font-size: 11px; }
.calendar-popover header button, .calendar-popover footer button { height: 28px; color: var(--panel-text); background: var(--surface); border: 1px solid var(--border); border-radius: 3px; }
.weekdays, .calendar-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; }
.weekdays span { display: grid; place-items: center; height: 22px; color: var(--muted-text); font-size: 8px; font-weight: 700; }
.calendar-grid button { position: relative; display: grid; place-items: center; aspect-ratio: 1; color: var(--panel-text); background: transparent; border: 0; border-radius: 3px; font-size: 9px; }
.calendar-grid button:hover { background: var(--surface-hover); }
.calendar-grid button.outside { color: var(--muted-text); opacity: .42; }
.calendar-grid button.today::after { content: ""; position: absolute; bottom: 3px; width: 3px; height: 3px; background: var(--accent); border-radius: 50%; }
.calendar-grid button.selected { color: var(--accent-contrast); background: var(--accent); font-weight: 750; }
.calendar-grid button.selected::after { background: var(--accent-contrast); }
.calendar-popover footer { display: flex; justify-content: space-between; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--border); }
.calendar-popover footer button { padding: 0 9px; font-size: 9px; }
.calendar-panel-enter-active, .calendar-panel-leave-active { transition: opacity .12s ease, transform .15s ease; transform-origin: top left; }
.calendar-panel-enter-from, .calendar-panel-leave-to { opacity: 0; transform: translateY(-3px) scale(.98); }
</style>
