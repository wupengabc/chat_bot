<script setup lang="ts">
defineProps<{
  title: string
  subtitle?: string
}>()
</script>

<template>
  <section class="admin-page">
    <div class="admin-card">
      <span class="admin-badge">ADMIN</span>
      <h1>{{ title }}</h1>
      <p v-if="subtitle" class="admin-subtitle">{{ subtitle }}</p>
      <p class="admin-hint">该模块正在建设中，敬请期待。</p>
      <slot />
    </div>
  </section>
</template>

<style scoped>
.admin-page {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: calc(100vh - 88px);
  padding: 24px;
}

.admin-card {
  width: min(560px, 100%);
  padding: 36px;
  text-align: center;
  color: var(--panel-text);
  background: color-mix(in srgb, var(--panel-bg) 92%, transparent);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 18px 46px color-mix(in srgb, var(--shadow) 38%, transparent);
  -webkit-backdrop-filter: blur(18px);
  backdrop-filter: blur(18px);
}

.admin-badge {
  display: inline-block;
  padding: 4px 10px;
  margin-bottom: 18px;
  color: var(--accent-contrast);
  background: var(--accent);
  border-radius: 4px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.12em;
}

.admin-card h1 {
  margin: 0 0 10px;
  font-size: clamp(28px, 5vw, 42px);
  letter-spacing: -0.04em;
}

.admin-subtitle {
  margin: 0 0 20px;
  color: var(--muted-text);
  font-size: 13px;
}

.admin-hint {
  margin: 22px 0 0;
  padding: 14px 18px;
  color: var(--warning-text);
  background: var(--warning-soft);
  border: 1px solid color-mix(in srgb, var(--warning) 24%, var(--border));
  border-radius: 5px;
  font-size: 13px;
}
</style>
