<script setup lang="ts">
defineProps<{modelValue: boolean; label: string; ariaLabel?: string}>()
const emit = defineEmits<{(event: 'update:modelValue', value: boolean): void}>()
</script>

<template>
  <button class="base-checkbox" :class="{checked: modelValue}" type="button" :aria-label="ariaLabel || label" :aria-pressed="modelValue" @click="emit('update:modelValue', !modelValue)">
    <i aria-hidden="true"></i><span>{{ label }}</span>
  </button>
</template>

<style scoped>
.base-checkbox{display:inline-flex;align-items:center;gap:7px;min-height:34px;padding:0 3px;color:var(--muted-text);background:transparent;border:0;font-size:11px;font-weight:700}.base-checkbox i{display:grid;place-items:center;width:14px;height:14px;box-sizing:border-box;border:1px solid var(--border);border-radius:3px}.base-checkbox.checked{color:var(--panel-text)}.base-checkbox.checked i{background:var(--accent);border-color:var(--accent)}.base-checkbox.checked i::after{content:"";width:6px;height:3px;border-bottom:1.5px solid var(--accent-contrast);border-left:1.5px solid var(--accent-contrast);transform:translateY(-1px) rotate(-45deg)}.base-checkbox:hover i,.base-checkbox:focus-visible i{border-color:var(--accent)}.base-checkbox:focus-visible{outline:1px solid var(--accent);outline-offset:2px}
</style>
