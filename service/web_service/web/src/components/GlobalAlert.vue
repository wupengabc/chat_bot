<script setup lang="ts">
import { useAlertStore } from '../stores/alert'

const alertStore = useAlertStore()
const icons = { success: '✓', error: '!', warning: '△', info: 'i' }
</script>

<template>
  <Teleport to="body">
    <div class="alert-region" aria-live="polite" aria-relevant="additions removals">
      <TransitionGroup name="alert">
        <article v-for="alert in alertStore.alerts" :key="alert.id" class="alert-item" :class="`alert-${alert.type}`">
          <span class="alert-icon">{{ icons[alert.type] }}</span>
          <div><strong>{{ alert.title }}</strong><p v-if="alert.message">{{ alert.message }}</p></div>
          <button aria-label="关闭提示" @click="alertStore.remove(alert.id)">×</button>
          <i class="alert-timer" />
        </article>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.alert-region { position: fixed; right: 18px; bottom: 18px; z-index: 200; display: flex; flex-direction: column; align-items: flex-end; gap: 8px; width: min(360px, calc(100vw - 24px)); pointer-events: none; }
.alert-item { position: relative; display: grid; grid-template-columns: 30px 1fr 24px; gap: 10px; align-items: start; width: 100%; overflow: hidden; padding: 12px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 18px 42px var(--shadow); pointer-events: auto; }
.alert-icon { display: grid; place-items: center; width: 30px; height: 30px; color: var(--accent-contrast); background: var(--accent); border-radius: 5px; font-size: 13px; font-weight: 800; }
.alert-success .alert-icon { background: var(--success); } .alert-error .alert-icon { background: var(--danger); } .alert-warning .alert-icon { color: var(--warning-text); background: var(--warning-soft); } .alert-info .alert-icon { background: var(--accent); }
.alert-item strong { display: block; margin-top: 1px; font-size: 12px; }.alert-item p { margin: 4px 0 0; color: var(--muted-text); font-size: 10px; line-height: 1.45; }
.alert-item button { width: 24px; height: 24px; color: var(--muted-text); background: transparent; border: 0; border-radius: 5px; font-size: 17px; line-height: 1; }.alert-item button:hover { color: var(--panel-text); background: var(--surface-hover); }
.alert-timer { position: absolute; left: 0; bottom: 0; width: 100%; height: 2px; background: var(--accent); transform-origin: left; animation: alert-time 4s linear forwards; }.alert-error .alert-timer { background: var(--danger); animation-duration: 5.2s; }.alert-success .alert-timer { background: var(--success); }.alert-warning .alert-timer { background: var(--warning); }
.alert-enter-active, .alert-leave-active, .alert-move { transition: transform .32s cubic-bezier(.22,1,.36,1), opacity .24s ease; }.alert-enter-from, .alert-leave-to { opacity: 0; transform: translateX(28px) scale(.97); }.alert-leave-active { position: absolute; }
@keyframes alert-time { from { transform: scaleX(1); } to { transform: scaleX(0); } }
@media (max-width: 560px) { .alert-region { right: 12px; bottom: 12px; } }
</style>
