<script setup lang="ts">
import { computed } from 'vue'
import AdminIcon from './AdminIcon.vue'

const props = defineProps<{
  title: string
  value: string | number
  trend?: string
  icon: 'users' | 'flame' | 'message' | 'points' | 'landmark' | 'shop' | 'user-check'
  variant?: 'default' | 'accent' | 'success' | 'warning'
}>()

const variantClass = computed(() => `stat-card--${props.variant || 'default'}`)
</script>

<template>
  <div class="stat-card" :class="variantClass">
    <div class="stat-card-head">
      <span class="stat-icon" aria-hidden="true">
        <AdminIcon :name="icon" />
      </span>
      <span v-if="trend" class="stat-trend">{{ trend }}</span>
    </div>
    <div class="stat-card-body">
      <strong class="stat-value">{{ value }}</strong>
      <span class="stat-title">{{ title }}</span>
    </div>
    <div class="stat-glow" aria-hidden="true" />
  </div>
</template>

<style scoped>
.stat-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 18px;
  min-height: 120px;
  overflow: hidden;
  color: var(--panel-text);
  background: color-mix(in srgb, var(--panel-bg) 68%, transparent);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 8px 24px color-mix(in srgb, var(--shadow) 24%, transparent);
  transition: transform .24s cubic-bezier(.22, 1, .36, 1), box-shadow .24s ease, border-color .24s ease;
}

.stat-card:hover {
  transform: translateY(-3px);
  box-shadow: 0 14px 36px color-mix(in srgb, var(--shadow) 34%, transparent);
  border-color: color-mix(in srgb, var(--accent) 42%, var(--border));
}

.stat-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.stat-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 5px;
  font-size: 18px;
  background: var(--surface);
  border: 1px solid var(--border);
  transition: background-color .2s ease, border-color .2s ease;
}

.stat-trend {
  padding: 3px 7px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .04em;
  background: var(--surface);
  color: var(--muted-text);
}

.stat-card-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: auto;
}

.stat-value {
  font-size: clamp(26px, 3vw, 32px);
  line-height: 1;
  letter-spacing: -.04em;
  font-weight: 800;
}

.stat-title {
  color: var(--muted-text);
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .06em;
  text-transform: uppercase;
}

.stat-glow {
  position: absolute;
  right: -20%;
  top: -20%;
  width: 70%;
  height: 70%;
  border-radius: 50%;
  opacity: .14;
  filter: blur(24px);
  pointer-events: none;
  transition: opacity .3s ease;
}

.stat-card:hover .stat-glow {
  opacity: .22;
}

.stat-card--default .stat-icon { color: var(--panel-text); }
.stat-card--default .stat-glow { background: var(--accent); }

.stat-card--accent .stat-icon {
  color: var(--accent-contrast);
  background: var(--accent);
  border-color: transparent;
}
.stat-card--accent .stat-glow { background: var(--accent); }

.stat-card--success .stat-icon {
  color: var(--success-text);
  background: var(--success-soft);
  border-color: transparent;
}
.stat-card--success .stat-glow { background: var(--success); }

.stat-card--warning .stat-icon {
  color: var(--warning-text);
  background: var(--warning-soft);
  border-color: transparent;
}
.stat-card--warning .stat-glow { background: var(--warning); }
</style>
