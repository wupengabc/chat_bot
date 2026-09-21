<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

const props = withDefaults(defineProps<{ open: boolean; title: string; size?: 'default' | 'wide' | 'large'; dismissible?: boolean; panelClass?: string }>(), {
  dismissible: true,
})
const emit = defineEmits<{ close: [] }>()

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.dismissible) emit('close')
}

onMounted(() => document.addEventListener('keydown', handleKeydown))
onUnmounted(() => document.removeEventListener('keydown', handleKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="props.dismissible && emit('close')">
        <section class="dialog-panel" :class="[{ 'dialog-wide': props.size === 'wide', 'dialog-large': props.size === 'large' }, props.panelClass]" role="dialog" aria-modal="true" :aria-label="title">
          <header class="dialog-header">
            <h2>{{ title }}</h2>
            <button v-if="props.dismissible" class="dialog-close" aria-label="关闭" @click="emit('close')">×</button>
          </header>
          <div class="dialog-content"><slot /></div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dialog-backdrop { position: fixed; inset: 0; z-index: 100; display: grid; place-items: center; padding: 20px; overflow: hidden; background: var(--overlay); backdrop-filter: blur(5px); }
.dialog-panel { display: flex; flex-direction: column; width: min(420px, 100%); max-height: calc(100dvh - 40px); min-height: 0; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 28px 80px var(--shadow); }
.dialog-wide { width: min(720px, 100%); }
.dialog-large { width: min(1240px, 100%); height: min(780px, calc(100dvh - 40px)); }
.dialog-large .dialog-content { display: flex; flex: 1 1 auto; overflow: hidden; }
.dialog-context { height: min(620px, calc(100dvh - 40px)); }
.dialog-context .dialog-content { display: flex; flex: 1 1 auto; overflow: hidden; }
.dialog-context .dialog-content > * { flex: 1 1 auto; min-height: 0; }
.dialog-header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; min-height: 46px; padding: 9px 14px; border-bottom: 1px solid var(--border); }
.dialog-header h2 { margin: 0; font-size: 16px; letter-spacing: -.03em; }
.dialog-close { width: 26px; height: 26px; color: var(--muted-text); background: transparent; border: 0; border-radius: 5px; font-size: 18px; line-height: 1; }
.dialog-close:hover { color: var(--panel-text); background: var(--surface-hover); }
.dialog-content { min-height: 0; overflow-y: auto; padding: 16px 18px 18px; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: color-mix(in srgb, var(--accent) 62%, var(--muted-text)) transparent; }
.dialog-content::-webkit-scrollbar { width: 4px; }
.dialog-content::-webkit-scrollbar-track { background: transparent; }
.dialog-content::-webkit-scrollbar-thumb { background: color-mix(in srgb, var(--accent) 62%, var(--muted-text)); border: 0; border-radius: 4px; }
.dialog-enter-active, .dialog-leave-active { transition: opacity .2s ease; }
.dialog-enter-active .dialog-panel, .dialog-leave-active .dialog-panel { transition: transform .24s cubic-bezier(.22,1,.36,1), opacity .2s ease; }
.dialog-enter-from, .dialog-leave-to { opacity: 0; }
.dialog-enter-from .dialog-panel, .dialog-leave-to .dialog-panel { opacity: 0; transform: translateY(10px) scale(.98); }
@media (max-width: 760px) {
  .dialog-large, .dialog-context { height: calc(100dvh - 40px); }
  .dialog-large .dialog-content { display: block; overflow-y: auto; }
}
@media (max-width: 560px) { .dialog-backdrop { place-items: center; padding: 12px; } .dialog-panel { max-height: calc(100dvh - 24px); } .dialog-large, .dialog-context { height: calc(100dvh - 24px); } .dialog-header { min-height: 42px; padding: 7px 12px; } .dialog-header h2 { font-size: 14px; } .dialog-content { padding: 14px; } }
</style>
