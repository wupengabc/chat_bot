<script lang="ts" setup>defineProps<{ title: string }>()</script>
<template>
  <section class="placeholder"><span>AUTHENTICATED AREA</span>
    <h1>{{ title }}</h1>
    <p>页面功能将在后续实现。</p></section>
</template>
<style scoped>.placeholder {
  min-height: 100vh;
  padding: 28vh clamp(18px, 6vw, 90px);
}

.placeholder span {
  color: var(--accent);
  font: 700 10px ui-monospace, monospace;
  letter-spacing: .12em
}

.placeholder h1 {
  margin: 12px 0;
  font-size: clamp(44px, 8vw, 100px);
  letter-spacing: -.07em
}

.placeholder p {
  color: var(--page-muted);
  font-size: 13px
}</style>
