import { ref } from 'vue'
import { defineStore } from 'pinia'

export type AlertType = 'success' | 'error' | 'warning' | 'info'
export interface AlertItem { id: number; type: AlertType; title: string; message?: string }

export const useAlertStore = defineStore('alert', () => {
  const alerts = ref<AlertItem[]>([])
  let nextId = 1
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  function remove(id: number) {
    const timer = timers.get(id)
    if (timer) clearTimeout(timer)
    timers.delete(id)
    alerts.value = alerts.value.filter(alert => alert.id !== id)
  }

  function show(type: AlertType, title: string, message?: string, duration = 4000) {
    const id = nextId++
    alerts.value.push({ id, type, title, message })
    timers.set(id, setTimeout(() => remove(id), duration))
    return id
  }

  return {
    alerts, remove, show,
    success: (title: string, message?: string) => show('success', title, message),
    error: (title: string, message?: string) => show('error', title, message, 5200),
    warning: (title: string, message?: string) => show('warning', title, message),
    info: (title: string, message?: string) => show('info', title, message),
  }
})
