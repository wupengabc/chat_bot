<script lang="ts" setup>
import {computed, onBeforeUnmount, onMounted, ref, watch} from 'vue'
import {useRoute, useRouter} from 'vue-router'
import {get} from '../utils/request'
import PlayerList from './explore/player_list.vue'
import MessageList from './explore/message_list.vue'
import ShopList from './explore/shop_list.vue'
import LandmarkList from './explore/landmark_list.vue'
import WorldMap from './explore/world_map.vue'

type ExploreSection = 'players' | 'messages' | 'shops' | 'landmarks' | 'world-map'

const baseSections: Array<{ id: ExploreSection; label: string; icon: string; code: string }> = [
  {id: 'players', label: '在线玩家', icon: '◉', code: '01'},
  {id: 'messages', label: '消息列表', icon: '≡', code: '02'},
  {id: 'shops', label: '商店列表', icon: '▦', code: '03'},
  {id: 'landmarks', label: '地标列表', icon: '⌂', code: '04'},
  {id: 'world-map', label: '世界地图', icon: '▧', code: '05'},
]

const route = useRoute()
const router = useRouter()
const hasWorldMapAccess = ref(false)
const sections = computed(() => baseSections.filter(section => section.id !== 'world-map' || hasWorldMapAccess.value))

function parseSection(value: unknown): ExploreSection {
  return typeof value === 'string' && sections.value.some(section => section.id === value) ? value as ExploreSection : 'players'
}

const activeSection = ref<ExploreSection>(parseSection(route.query.section))
const sectionTransition = ref('section-switch-forward')
const navOpen = ref(false)
const navShell = ref<HTMLElement | null>(null)

function updateActiveSection(section: ExploreSection) {
  if (activeSection.value === section) return
  const currentIndex = sections.value.findIndex(item => item.id === activeSection.value)
  const nextIndex = sections.value.findIndex(item => item.id === section)
  sectionTransition.value = nextIndex >= currentIndex ? 'section-switch-forward' : 'section-switch-backward'
  activeSection.value = section
}

async function loadWorldMapAccess() {
  try {
    const response = await get<{allowed: boolean}>('/api/worlds/access')
    hasWorldMapAccess.value = response.allowed === true
  } catch {
    hasWorldMapAccess.value = false
  }
  updateActiveSection(parseSection(route.query.section))
  if (!hasWorldMapAccess.value && route.query.section === 'world-map') void router.replace({query: {...route.query, section: 'players'}})
}

function selectSection(section: ExploreSection) {
  if (activeSection.value === section && route.query.section === section) {
    navOpen.value = false
    return
  }
  updateActiveSection(section)
  navOpen.value = false
  void router.push({query: {...route.query, section}})
}

function closeNavOutside(event: MouseEvent) {
  if (navShell.value && !navShell.value.contains(event.target as Node)) {
    navOpen.value = false
  }
}

watch(() => route.query.section, value => updateActiveSection(parseSection(value)))
onMounted(() => { document.addEventListener('mousedown', closeNavOutside); void loadWorldMapAccess() })
onBeforeUnmount(() => document.removeEventListener('mousedown', closeNavOutside))
</script>

<template>
  <section class="explore-page">
    <div :class="{ 'is-open': navOpen }" class="explore-nav-shell">
      <aside aria-label="数据探索分类" class="explore-nav">
        <button :aria-expanded="navOpen" aria-label="打开数据探索导航" class="explore-nav-toggle" type="button"
                @click="navOpen = !navOpen">
          <span aria-hidden="true">{{ navOpen ? '‹' : '›' }}</span>
        </button>
        <button v-for="section in sections" :key="section.id" :aria-current="activeSection === section.id ? 'page' : undefined"
                :class="{ active: activeSection === section.id }" class="explore-nav-item"
                type="button" @click="selectSection(section.id)">
          <span aria-hidden="true" class="explore-nav-icon">{{ section.icon }}</span>
          <span class="explore-nav-label">{{ section.label }}</span>
        </button>
      </aside>
    </div>

    <main class="explore-content">
      <Transition :name="sectionTransition" mode="out-in">
        <div :key="activeSection" class="section-view">
          <PlayerList v-if="activeSection === 'players'"/>
          <MessageList v-else-if="activeSection === 'messages'"/>
          <ShopList v-else-if="activeSection === 'shops'"/>
          <LandmarkList v-else-if="activeSection === 'landmarks'"/>
          <WorldMap v-else-if="activeSection === 'world-map'"/>
          <section v-else class="explore-panel empty-panel">
            <span class="panel-kicker">ARCHIVE MODULE / {{
                sections.findIndex(section => section.id === activeSection) + 1
              }}</span>
            <h2>{{ sections.find(section => section.id === activeSection)?.label }}</h2>
            <p>这个数据模块正在接入邦溪世界档案，导航入口已准备就绪。</p>
            <div class="module-line"><span>STATUS</span><strong>COMING SOON</strong></div>
          </section>
        </div>
      </Transition>
    </main>
  </section>
</template>

<style scoped>
.explore-page {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  padding: 76px 0 0;
  overflow: hidden;
  color: var(--page-text);
}

.explore-nav-shell {
  position: fixed;
  z-index: 9;
  top: 0;
  left: 0;
  width: clamp(12px, 3vw, 42px);
  height: 100dvh;
}

.explore-nav {
  position: fixed;
  z-index: 9;
  top: 50%;
  left: 0;
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
  width: 76px;
  padding: 6px;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 18px 48px var(--shadow);
  transform: translateY(-50%) translateX(calc(-100% + clamp(12px, 3vw, 42px)));
  transition: transform .28s cubic-bezier(.22, 1, .36, 1);
}

.explore-nav-shell.is-open .explore-nav {
  transform: translateY(-50%) translateX(0);
}

@media (min-width: 761px) {
  .explore-nav-shell:hover .explore-nav {
    transform: translateY(-50%) translateX(0);
  }
}

.explore-nav-toggle {
  position: absolute;
  z-index: 1;
  top: 50%;
  right: -14px;
  display: none;
  place-items: center;
  width: 14px;
  height: 66px;
  padding: 0;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 0;
  border-radius: 0 5px 5px 0;
  box-shadow: 0 8px 22px var(--shadow);
  transform: translateY(-50%);
}

.explore-nav-toggle span {
  font-size: 16px;
  line-height: 1;
}

.explore-nav-item {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  aspect-ratio: 1;
  padding: 6px;
  color: var(--muted-text);
  background: transparent;
  border: 0;
  border-radius: 5px;
  text-align: center;
  transition: color .2s ease, background-color .2s ease;
}

.explore-nav-item:hover {
  color: var(--panel-text);
  background: var(--surface-hover);
}

.explore-nav-item.active {
  color: var(--accent);
  background: var(--surface-selected);
}

.explore-nav-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  font-size: 14px;
}

.explore-nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
}

.explore-content, .section-view {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
}

.section-view {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  width: 100%;
  height: 100%;
  transform-origin: center;
  will-change: opacity, transform, filter;
}

.section-switch-forward-enter-active,
.section-switch-backward-enter-active {
  transition: opacity .2s ease, transform .28s cubic-bezier(.22, 1, .36, 1), filter .2s ease;
}

.section-switch-forward-leave-active,
.section-switch-backward-leave-active {
  transition: opacity .14s ease, transform .18s cubic-bezier(.4, 0, 1, 1), filter .14s ease;
}

.section-switch-forward-enter-from,
.section-switch-backward-enter-from,
.section-switch-forward-leave-to,
.section-switch-backward-leave-to {
  opacity: 0;
  filter: blur(2px);
}

.section-switch-forward-enter-from {
  transform: translateX(28px) scale(.992);
}

.section-switch-forward-leave-to {
  transform: translateX(-18px) scale(.996);
}

.section-switch-backward-enter-from {
  transform: translateX(-28px) scale(.992);
}

.section-switch-backward-leave-to {
  transform: translateX(18px) scale(.996);
}

.explore-panel {
  flex: 1 1 auto;
  min-height: 0;
  margin-top: 0;
  padding: 22px;
  overflow: auto;
  color: var(--panel-text);
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 5px;
  box-shadow: 0 18px 46px var(--shadow);
}

.empty-panel h2 {
  margin: 7px 0 0;
  font-size: clamp(34px, 5vw, 64px);
}

.panel-kicker {
  color: var(--accent);
  font: 700 8px ui-monospace, monospace;
}

.empty-panel p {
  max-width: 390px;
  margin: 12px 0 42px;
  color: var(--muted-text);
  font-size: 12px;
  line-height: 1.7;
}

.module-line {
  display: flex;
  justify-content: space-between;
  max-width: 390px;
  padding-top: 12px;
  border-top: 1px solid var(--border);
  color: var(--muted-text);
  font: 9px ui-monospace, monospace;
}

.module-line strong {
  color: var(--accent);
}

.section-view :deep(.player-overview),
.section-view :deep(.message-toolbar),
.section-view :deep(.shop-toolbar),
.section-view :deep(.landmark-toolbar) {
  height: 48px !important;
  min-height: 48px !important;
  max-height: 48px !important;
  flex-basis: 48px;
  padding: 6px 10px;
  background: color-mix(in srgb, var(--surface) 34%, var(--panel-bg));
  border-bottom: 1px solid var(--border);
}

.section-view :deep(.player-panel),
.section-view :deep(.message-panel),
.section-view :deep(.shop-panel),
.section-view :deep(.landmark-panel) {
  margin-top: 0;
}

.section-view :deep(.directory-title),
.section-view :deep(.message-summary),
.section-view :deep(.shop-summary),
.section-view :deep(.archive-summary) {
  gap: 10px;
}

.section-view :deep(.directory-title strong),
.section-view :deep(.message-summary strong),
.section-view :deep(.shop-summary strong),
.section-view :deep(.archive-summary strong) {
  font-size: 15px;
}

.section-view :deep(.directory-title small),
.section-view :deep(.message-summary small),
.section-view :deep(.shop-summary span),
.section-view :deep(.archive-summary small) {
  font-size: 12px;
}

.section-view :deep(.message-filters),
.section-view :deep(.shop-search),
.section-view :deep(.quick-search) {
  min-width: 0;
}

.section-view :deep(.message-filters input),
.section-view :deep(.shop-search input),
.section-view :deep(.quick-search input) {
  height: 32px;
  font-size: 12px;
}

.section-view :deep(.message-filters input) {
  background: var(--surface);
  border-color: var(--border);
}

.section-view :deep(.shop-search),
.section-view :deep(.quick-search input),
.section-view :deep(.message-filters input),
.section-view :deep(.range-trigger),
.section-view :deep(.select-trigger) {
  min-height: 32px;
  border-radius: 4px;
}

.section-view :deep(.refresh-button),
.section-view :deep(.player-search-button),
.section-view :deep(.message-search-button),
.section-view :deep(.message-clear-button),
.section-view :deep(.custom-avg-button),
.section-view :deep(.update-button),
.section-view :deep(.search-button),
.section-view :deep(.landmark-toolbar .toolbar-actions button) {
  min-height: 32px;
  font-size: 11px;
}

.section-view :deep(.message-toolbar) {
  grid-template-columns: auto minmax(0, 1fr) 36px;
}

.section-view :deep(.shop-toolbar) {
  grid-template-columns: minmax(160px, 1fr) minmax(240px, 440px) auto auto 36px;
}

.section-view :deep(.landmark-toolbar) {
  grid-template-columns: auto minmax(240px, 1fr) auto;
}

.section-view :deep(.message-toolbar .refresh-button),
.section-view :deep(.shop-toolbar .refresh-button),
.section-view :deep(.landmark-toolbar .refresh-button) {
  width: 32px;
  height: 32px;
  padding: 0;
}

.section-view :deep(.refresh-button svg),
.section-view :deep(.custom-avg-button svg),
.section-view :deep(.update-button svg) {
  width: 17px;
  height: 17px;
}

.section-view :deep(.message-filters label),
.section-view :deep(.range-filter) {
  font-size: 12px;
}



@media (max-width: 760px) {
  .explore-page {
    padding-top: 76px;
  }

  .section-view :deep(.player-overview),
  .section-view :deep(.message-toolbar),
  .section-view :deep(.shop-toolbar),
  .section-view :deep(.landmark-toolbar) {
    padding: 6px 8px;
  }

  .section-view :deep(.message-toolbar) {
    grid-template-columns: minmax(0, 1fr) 36px;
  }

  .section-view :deep(.shop-toolbar) {
    grid-template-columns: minmax(0, 1fr) auto auto 36px;
  }

  .section-view :deep(.landmark-toolbar) {
    grid-template-columns: minmax(0, 1fr) auto;
  }

  .explore-nav-shell {
    width: 0;
    height: 0;
  }

  .explore-nav-toggle {
    display: grid;
  }

  .explore-nav {
    position: fixed;
    top: 50%;
    left: 0;
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
    width: 68px;
    padding: 5px;
    color: var(--panel-text);
    background: var(--panel-bg);
    border: 1px solid var(--border);
    border-radius: 5px;
    box-shadow: 0 18px 48px var(--shadow);
    transform: translateY(-50%) translateX(calc(-100% + 12px));
    transition: transform .28s cubic-bezier(.22, 1, .36, 1);
  }

  .explore-nav-shell.is-open .explore-nav {
    transform: translateY(-50%) translateX(0);
  }

  .explore-nav-label {
    font-size: 10px;
  }

}

@media (max-width: 560px) {
  .explore-nav {
    transform: translateY(-50%) translateX(calc(-100% + 12px));
  }

  .explore-nav-shell.is-open .explore-nav {
    transform: translateY(-50%) translateX(0);
  }
}

@media (max-width: 480px) {
  .explore-nav-label {
    font-size: 9px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .section-switch-forward-enter-active,
  .section-switch-forward-leave-active,
  .section-switch-backward-enter-active,
  .section-switch-backward-leave-active {
    transition-duration: .01ms;
  }

  .section-switch-forward-enter-from,
  .section-switch-forward-leave-to,
  .section-switch-backward-enter-from,
  .section-switch-backward-leave-to {
    filter: none;
    transform: none;
  }
}
</style>
