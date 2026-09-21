<script setup lang="ts">
import {computed} from 'vue'
import {renderMarkdown} from '../utils/markdown'

const props = withDefaults(defineProps<{
  content: string
  streaming?: boolean
}>(), {
  streaming: false,
})

const emit = defineEmits<{
  openMessageContext: [messageId: number]
}>()

const rendered = computed(() => renderMarkdown(props.content))

function handleClick(event: MouseEvent) {
  if (!(event.target instanceof Element)) return
  const citation = event.target.closest<HTMLElement>('[data-message-id]')
  if (!citation) return
  const messageId = Number(citation.dataset.messageId)
  if (Number.isSafeInteger(messageId) && messageId > 0) emit('openMessageContext', messageId)
}
</script>

<template>
  <div class="agent-markdown" :class="{streaming}" @click="handleClick" v-html="rendered"/>
</template>

<style scoped>
.agent-markdown{min-width:0;color:inherit;font-size:10px;line-height:1.72;overflow-wrap:anywhere}
.agent-markdown.streaming:after{display:inline-block;width:5px;height:12px;margin-left:3px;background:var(--accent);vertical-align:-2px;animation:markdown-blink .75s steps(1) infinite;content:''}
.agent-markdown :deep(> :first-child){margin-top:0}
.agent-markdown :deep(> :last-child){margin-bottom:0}
.agent-markdown :deep(p){margin:.45em 0;white-space:normal}
.agent-markdown :deep(h1),.agent-markdown :deep(h2),.agent-markdown :deep(h3),.agent-markdown :deep(h4),.agent-markdown :deep(h5),.agent-markdown :deep(h6){margin:.8em 0 .35em;color:var(--panel-text);font-weight:800;letter-spacing:0;line-height:1.35}
.agent-markdown :deep(h1){font-size:1.35em}.agent-markdown :deep(h2){font-size:1.22em}.agent-markdown :deep(h3){font-size:1.12em}.agent-markdown :deep(h4),.agent-markdown :deep(h5),.agent-markdown :deep(h6){font-size:1em}
.agent-markdown :deep(ul),.agent-markdown :deep(ol){display:grid;gap:.25em;margin:.5em 0;padding-left:1.7em}
.agent-markdown :deep(li){padding-left:.15em}.agent-markdown :deep(.task-item){display:flex;align-items:flex-start;gap:.55em;list-style:none}.agent-markdown :deep(.task-item input){flex:0 0 auto;margin:.38em 0 0;accent-color:var(--accent)}
.agent-markdown :deep(blockquote){margin:.6em 0;padding:.35em .8em;color:var(--muted-text);border-left:3px solid color-mix(in srgb,var(--accent) 55%,var(--border))}
.agent-markdown :deep(code){padding:.12em .35em;color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 18%,var(--border));border-radius:3px;font:inherit;font-family:ui-monospace,monospace}
.agent-markdown :deep(pre){max-width:100%;margin:.6em 0;padding:9px;overflow:auto;color:var(--panel-text);background:var(--panel-bg);border:1px solid var(--border);border-radius:3px;font:8px/1.6 ui-monospace,monospace;white-space:pre}
.agent-markdown :deep(pre code){padding:0;color:inherit;background:transparent;border:0;border-radius:0;font:inherit}
.agent-markdown :deep(a){color:var(--accent);text-decoration:underline;text-underline-offset:2px}.agent-markdown :deep(del){color:var(--muted-text)}
.agent-markdown :deep(.message-citation){display:inline-flex;align-items:center;min-height:19px;margin:0 .12em;padding:0 5px;color:var(--accent);background:color-mix(in srgb,var(--accent) 9%,var(--surface));border:1px solid color-mix(in srgb,var(--accent) 32%,var(--border));border-radius:3px;font:800 .86em ui-monospace,monospace;vertical-align:.08em}.agent-markdown :deep(.message-citation:hover){color:var(--accent-contrast);background:var(--accent);border-color:var(--accent)}
.agent-markdown :deep(hr){height:1px;margin:.75em 0;background:var(--border);border:0}
.agent-markdown :deep(table){display:block;width:100%;max-width:100%;margin:.6em 0;overflow:auto;border:1px solid var(--border);border-radius:3px;border-collapse:collapse;font-size:9px}.agent-markdown :deep(th),.agent-markdown :deep(td){min-width:90px;padding:6px 7px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);text-align:left;vertical-align:top}.agent-markdown :deep(th:last-child),.agent-markdown :deep(td:last-child){border-right:0}.agent-markdown :deep(tbody tr:last-child td){border-bottom:0}.agent-markdown :deep(th){background:var(--surface);font-weight:800}
.agent-markdown :deep(img){display:block;max-width:100%;max-height:420px;margin:.6em 0;background:#fff;border:1px solid var(--border);border-radius:3px;object-fit:contain}
@keyframes markdown-blink{50%{opacity:0}}
@media(prefers-reduced-motion:reduce){.agent-markdown.streaming:after{animation:none}}
</style>
