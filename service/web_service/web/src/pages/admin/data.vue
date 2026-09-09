<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import MessagesPage from './data/messages.vue'
import ShopsPage from './data/shops.vue'
import LandmarksPage from './data/landmarks.vue'
import LogsPage from './data/logs.vue'
import PointLogsPage from './data/point_logs.vue'
import UsersPage from './data/users.vue'
import AdminIcon from '../../components/admin/AdminIcon.vue'
import { useAuthStore } from '../../stores/auth'

type DataSection = 'messages' | 'shops' | 'landmarks' | 'point-logs' | 'logs' | 'users'

const sections: Array<{ id: DataSection; label: string; icon: 'message-square' | 'store' | 'map-pin' | 'points' | 'file-text' | 'user-cog' }> = [
  { id: 'messages', label: '消息管理', icon: 'message-square' },
  { id: 'shops', label: '商店管理', icon: 'store' },
  { id: 'landmarks', label: '地标管理', icon: 'map-pin' },
  { id: 'point-logs', label: '积分日志', icon: 'points' },
  { id: 'logs', label: '日志管理', icon: 'file-text' },
  { id: 'users', label: '用户管理', icon: 'user-cog' },
]

const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const sectionIds = new Set<DataSection>(sections.map(s => s.id))
const isOwner = computed(() => authStore.user?.role === 'owner')
const visibleSections = computed(() => sections.filter(section => section.id !== 'logs' || isOwner.value))

function parseSection(value: unknown): DataSection {
  if (value === 'logs' && !isOwner.value) return 'messages'
  return typeof value === 'string' && sectionIds.has(value as DataSection) ? value as DataSection : 'messages'
}

const activeSection = ref<DataSection>(parseSection(route.query.section))
const sectionTransition = ref('section-switch-forward')
const navOpen = ref(false)
const navShell = ref<HTMLElement | null>(null)

function updateActiveSection(section: DataSection) {
  if (activeSection.value === section) return
  const currentIndex = sections.findIndex(item => item.id === activeSection.value)
  const nextIndex = sections.findIndex(item => item.id === section)
  sectionTransition.value = nextIndex >= currentIndex ? 'section-switch-forward' : 'section-switch-backward'
  activeSection.value = section
}

function selectSection(section: DataSection) {
  if (activeSection.value === section && route.query.section === section) {
    navOpen.value = false
    return
  }
  updateActiveSection(section)
  navOpen.value = false
  void router.push({ query: { ...route.query, section } })
}

function closeNavOutside(event: MouseEvent) {
  if (navShell.value && !navShell.value.contains(event.target as Node)) {
    navOpen.value = false
  }
}

watch(() => route.query.section, value => {
  const section = parseSection(value)
  updateActiveSection(section)
  if (value === 'logs' && section !== 'logs') void router.replace({ query: { ...route.query, section } })
})
watch(isOwner, owner => {
  if (!owner && activeSection.value === 'logs') selectSection('messages')
})
onMounted(() => {
  document.addEventListener('mousedown', closeNavOutside)
  if (route.query.section === 'logs' && !isOwner.value) void router.replace({ query: { ...route.query, section: 'messages' } })
})
onBeforeUnmount(() => document.removeEventListener('mousedown', closeNavOutside))
</script>

<template>
  <section class="data-page">
    <div :class="{ 'is-open': navOpen }" class="data-nav-shell" ref="navShell">
      <aside aria-label="数据管理分类" class="data-nav">
        <button :aria-expanded="navOpen" aria-label="打开数据管理导航" class="data-nav-toggle" type="button"
                @click="navOpen = !navOpen">
          <span aria-hidden="true">{{ navOpen ? '‹' : '›' }}</span>
        </button>
        <button v-for="section in visibleSections" :key="section.id"
                :aria-current="activeSection === section.id ? 'page' : undefined"
                :class="{ active: activeSection === section.id }" class="data-nav-item"
                type="button" @click="selectSection(section.id)">
          <span class="data-nav-icon">
            <AdminIcon :name="section.icon" />
          </span>
          <span class="data-nav-label">{{ section.label }}</span>
        </button>
      </aside>
    </div>

    <main class="data-content">
      <Transition :name="sectionTransition" mode="out-in">
        <div :key="activeSection" class="section-view">
          <MessagesPage v-if="activeSection === 'messages'" />
          <ShopsPage v-else-if="activeSection === 'shops'" />
           <LandmarksPage v-else-if="activeSection === 'landmarks'" />
           <PointLogsPage v-else-if="activeSection === 'point-logs'" />
           <LogsPage v-else-if="activeSection === 'logs' && isOwner" />
          <UsersPage v-else-if="activeSection === 'users'" />
        </div>
      </Transition>
    </main>
  </section>
</template>

<style scoped>
.data-page {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100dvh;
  min-height: 0;
  padding: 76px 0 0;
  overflow: hidden;
  color: var(--page-text);
}

.data-nav-shell {
  position: fixed;
  z-index: 9;
  top: 0;
  left: 0;
  width: clamp(12px, 3vw, 42px);
  height: 100dvh;
}

.data-nav {
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

.data-nav-shell.is-open .data-nav {
  transform: translateY(-50%) translateX(0);
}

@media (min-width: 761px) {
  .data-nav-shell:hover .data-nav {
    transform: translateY(-50%) translateX(0);
  }
}

.data-nav-toggle {
  position: absolute;
  z-index: 1;
  top: 50%;
  right: -9px;
  display: none;
  place-items: center;
  width: 9px;
  height: 58px;
  padding: 0;
  color: var(--accent-contrast);
  background: var(--accent);
  border: 0;
  border-radius: 0 5px 5px 0;
  box-shadow: 0 8px 22px var(--shadow);
  transform: translateY(-50%);
}

.data-nav-toggle span {
  font-size: 14px;
  line-height: 1;
}

.data-nav-item {
  display: grid;
  place-items: center;
  align-content: center;
  gap: 6px;
  aspect-ratio: 1;
  width: 100%;
  padding: 6px;
  color: var(--muted-text);
  background: transparent;
  border: 0;
  border-radius: 5px;
  text-align: center;
  cursor: pointer;
  transition: color .2s ease, background-color .2s ease;
}

.data-nav-item:hover {
  color: var(--panel-text);
  background: var(--surface-hover);
}

.data-nav-item.active {
  color: var(--accent);
  background: var(--surface-selected);
}

.data-nav-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  font-size: 14px;
}

.data-nav-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-weight: 650;
}

.data-content, .section-view {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  width: 100%;
}

.data-content {
  flex: 1 1 auto;
  overflow: hidden;
}

.section-view {
  flex: 1 1 auto;
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

@media (max-width: 760px) {
  .data-page {
    padding-top: 76px;
  }

  .data-nav-shell {
    width: 0;
    height: 0;
  }

  .data-nav-toggle {
    display: grid;
  }

  .data-nav {
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

  .data-nav-shell.is-open .data-nav {
    transform: translateY(-50%) translateX(0);
  }

  .data-nav-label {
    font-size: 10px;
  }

}

@media (max-width: 560px) {
  .data-nav {
    transform: translateY(-50%) translateX(calc(-100% + 12px));
  }

  .data-nav-shell.is-open .data-nav {
    transform: translateY(-50%) translateX(0);
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
