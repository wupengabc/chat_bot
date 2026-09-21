<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { webDocuments } from "./document-pages/docsRegistry";

const activeDocumentId = ref(webDocuments[0]?.id || "");
const navigationOpen = ref(false);
const documentView = ref<HTMLElement | null>(null);
const activeDocument = computed(() => webDocuments.find(document => document.id === activeDocumentId.value) || webDocuments[0]);
const documentGroups = computed(() => [...new Set(webDocuments.map(document => document.group))]);

function selectDocument(id: string) {
  activeDocumentId.value = id;
  navigationOpen.value = false;
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
  void nextTick(() => documentView.value?.scrollTo({ top: 0 }));
}

function handleDocumentClick(event: MouseEvent) {
  const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
  const id = anchor?.hash.slice(1);
  const view = documentView.value;
  if (!id || !view) return;

  const target = view.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  if (!target) return;

  event.preventDefault();
  const top = target.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop - 20;
  view.scrollTo({ top, behavior: "smooth" });
  window.history.replaceState(null, "", `#${id}`);
}
</script>

<template>
  <section class="docs-workspace" :class="{ 'navigation-open': navigationOpen }">
    <aside class="document-navigation">
      <header>
        <span>WEB DOCUMENTATION</span>
        <strong>开发者文档</strong>
        <small>{{ webDocuments.length }} 篇文档</small>
      </header>
      <div v-for="group in documentGroups" :key="group" class="document-group">
        <h2>{{ group }}</h2>
        <button v-for="document in webDocuments.filter(item => item.group === group)" :key="document.id" type="button" :class="{ active: activeDocumentId === document.id }" @click="selectDocument(document.id)">
          <span><strong>{{ document.title }}</strong><small>{{ document.summary }}</small></span>
          <b v-if="document.method">{{ document.method }}</b>
        </button>
      </div>
      <footer><span>API 费用从账户积分余额扣除</span></footer>
    </aside>

    <main ref="documentView" class="document-view" @click="handleDocumentClick">
      <button class="document-menu-button" type="button" :aria-expanded="navigationOpen" @click="navigationOpen = !navigationOpen">{{ navigationOpen ? "关闭目录" : "文档目录" }}</button>
      <component :is="activeDocument.component" v-if="activeDocument" />
      <div v-else class="empty-docs"><strong>暂无文档</strong><span>新文档会显示在这里。</span></div>
    </main>
  </section>
</template>

<style scoped>
.docs-workspace { display: grid; grid-template-columns: 250px minmax(0, 1fr); width: 100%; height: 100%; min-height: 0; overflow: hidden; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 5px; box-shadow: 0 18px 46px var(--shadow); }
.document-navigation { display: flex; flex-direction: column; min-height: 0; padding: 24px 14px 14px; overflow-y: auto; background: color-mix(in srgb, var(--surface) 68%, var(--panel-bg)); border-right: 1px solid var(--border); }
.document-navigation > header { display: grid; gap: 5px; padding: 0 9px 22px; border-bottom: 1px solid var(--border); }
.document-navigation > header span { color: var(--accent); font: 800 8px ui-monospace, SFMono-Regular, Consolas, monospace; }
.document-navigation > header strong { font-size: 18px; letter-spacing: 0; }
.document-navigation > header small { color: var(--muted-text); font-size: 9px; }
.document-group { padding-top: 21px; }
.document-group h2 { margin: 0 9px 8px; color: var(--muted-text); font-size: 9px; font-weight: 800; }
.document-group button { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 8px; width: 100%; min-height: 54px; padding: 9px; color: var(--muted-text); background: transparent; border: 1px solid transparent; border-radius: 4px; text-align: left; }
.document-group button:hover { color: var(--panel-text); background: var(--surface-hover); }
.document-group button.active { color: var(--panel-text); background: var(--panel-bg); border-color: var(--border); box-shadow: 0 5px 16px color-mix(in srgb, var(--shadow) 38%, transparent); }
.document-group button > span { display: grid; gap: 4px; min-width: 0; }
.document-group button strong { overflow: hidden; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.document-group button small { overflow: hidden; color: var(--muted-text); font-size: 8px; text-overflow: ellipsis; white-space: nowrap; }
.document-group button > b { padding: 3px 5px; color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); border-radius: 2px; font: 800 8px ui-monospace, SFMono-Regular, Consolas, monospace; }
.document-navigation > footer { margin-top: auto; padding: 18px 9px 3px; color: var(--muted-text); border-top: 1px solid var(--border); font-size: 8px; line-height: 1.6; }
.document-view { position: relative; min-width: 0; min-height: 0; overflow-y: auto; scroll-behavior: smooth; }
.document-menu-button { display: none; }
.empty-docs { display: grid; place-content: center; gap: 6px; height: 100%; color: var(--muted-text); text-align: center; }
@media (max-width: 900px) {
  .docs-workspace { grid-template-columns: 210px minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .docs-workspace { display: block; position: relative; }
  .document-navigation { position: absolute; z-index: 4; inset: 0 auto 0 0; width: min(280px, calc(100% - 42px)); transform: translateX(-100%); transition: transform .22s ease; }
  .navigation-open .document-navigation { transform: translateX(0); }
  .document-view { height: 100%; }
  .document-menu-button { position: sticky; z-index: 3; top: 8px; left: 8px; display: block; height: 30px; margin: 8px 0 -38px 8px; padding: 0 9px; color: var(--panel-text); background: var(--panel-bg); border: 1px solid var(--border); border-radius: 3px; box-shadow: 0 5px 16px var(--shadow); font-size: 9px; font-weight: 800; }
}
</style>
