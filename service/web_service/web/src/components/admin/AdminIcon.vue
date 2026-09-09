<script setup lang="ts">
const props = defineProps<{
  name: 'users' | 'flame' | 'message' | 'message-square' | 'points' | 'landmark' | 'map-pin' | 'shop' | 'store' | 'server' | 'bell' | 'layout-grid' | 'activity' | 'chart-line' | 'share' | 'settings' | 'file-text' | 'user-cog' | 'user-check'
}>()

const icons: Record<string, string> = {
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M16 3.128a4 4 0 0 1 0 7.744M22 21v-2a4 4 0 0 0-3-3.87',
  'user-check': 'm16 11l2 2l4-4m-6 12v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2',
  'user-cog': 'M10 15H6a4 4 0 0 0-4 4v2m12.305-4.47l.923-.382m0-2.296l-.923-.383m2.547-1.241l-.383-.923m.383 6.467l-.383.924m2.679-6.468l.383-.923m-.001 7.391l-.382-.924m1.624-3.92l.924-.383m-.924 2.679l.924.383',
  flame: 'M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0a5 5 0 0 1 1-3a1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4',
  message: 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z',
  'message-square': 'M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z',
  points: 'M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8m4 2V6',
  landmark: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
  'map-pin': 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0',
  shop: 'M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5m8.774-10.69a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.451 0a1.12 1.12 0 0 0-1.548 0a2.5 2.5 0 0 1-3.452 0a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244',
  store: 'M15 21v-5a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v5m8.774-10.69a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.451 0a1.12 1.12 0 0 0-1.548 0a2.5 2.5 0 0 1-3.452 0a1.12 1.12 0 0 0-1.549 0a2.5 2.5 0 0 1-3.77-3.248l2.889-4.184A2 2 0 0 1 7 2h10a2 2 0 0 1 1.653.873l2.895 4.192a2.5 2.5 0 0 1-3.774 3.244',
  server: 'M2 2h20v8H2zm0 10h20v8H2zM6 6h.01M6 18h.01',
  bell: 'M10.268 21a2 2 0 0 0 3.464 0m-10.47-5.674A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326',
  'layout-grid': 'M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z',
  activity: 'M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2',
  'chart-line': 'M3 3v16a2 2 0 0 0 2 2h16M19 9l-5 5l-4-4l-3 3',
  share: 'M18 5a3 3 0 1 1 0 6 3 3 0 0 1 0-6M6 12a3 3 0 1 1 0 6 3 3 0 0 1 0-6M18 19a3 3 0 1 1 0 6 3 3 0 0 1 0-6M8.59 13.51l6.83 3.98m-.01-10.98l-6.82 3.98',
  settings: 'M9.671 4.136a2.34 2.34 0 0 1 4.659 0a2.34 2.34 0 0 0 3.319 1.915a2.34 2.34 0 0 1 2.33 4.033a2.34 2.34 0 0 0 0 3.831a2.34 2.34 0 0 1-2.33 4.033a2.34 2.34 0 0 0-3.319 1.915a2.34 2.34 0 0 1-4.659 0a2.34 2.34 0 0 0-3.32-1.915a2.34 2.34 0 0 1-2.33-4.033a2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915',
  'file-text': 'M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2zM14 2v5a1 1 0 0 0 1 1h5M10 9H8m8 4H8m8 4H8',
}

const circles: Record<string, Array<{cx: number; cy: number; r: number}>> = {
  'user-cog': [{cx: 18, cy: 15, r: 3}, {cx: 9, cy: 7, r: 4}],
  'user-check': [{cx: 9, cy: 7, r: 4}],
  users: [{cx: 9, cy: 7, r: 4}],
  landmark: [{cx: 12, cy: 10, r: 3}],
  'map-pin': [{cx: 12, cy: 10, r: 3}],
}

const isStrokeOnly = ['message', 'message-square', 'bell', 'activity', 'chart-line', 'share', 'settings', 'file-text', 'user-check', 'user-cog'].includes(props.name)
</script>

<template>
  <svg class="admin-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="icons[name]" :fill="isStrokeOnly ? 'none' : 'currentColor'" />
    <circle v-for="(c, i) in circles[name] || []" :key="i" :cx="c.cx" :cy="c.cy" :r="c.r" fill="currentColor" stroke="none" />
  </svg>
</template>

<style scoped>
.admin-icon {
  display: block;
  width: 1em;
  height: 1em;
  flex: none;
}
</style>
