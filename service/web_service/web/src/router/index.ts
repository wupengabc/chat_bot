import { ref, watch } from 'vue'
import { createRouter, createWebHistory, type RouteLocationRaw } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import HomePage from '../pages/index/index.vue'
import ExplorePage from '../pages/ExplorePage.vue'
import AgentPage from '../pages/AgentPage.vue'
import AdminPage from '../pages/admin/index.vue'
import AdminData from '../pages/admin/data.vue'
import AdminShares from '../pages/admin/shares.vue'
import AdminSettings from '../pages/admin/settings.vue'
import MapShares from '../pages/shares/MapShares.vue'

export const loginDialogOpen = ref(false)
export const loginRequired = ref(false)
let intendedRoute: RouteLocationRaw | null = null

export function openLogin() {
  loginDialogOpen.value = true
}

export function closeLogin() {
  loginDialogOpen.value = false
  loginRequired.value = false
  intendedRoute = null
}

export function takeIntendedRoute() {
  const route = intendedRoute
  intendedRoute = null
  return route
}

export const adminRoles = new Set(['admin', 'owner'])
export const isAdmin = (role?: string | null) => adminRoles.has(role || '')

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', name: 'home', component: HomePage },
    { path: '/explore', name: 'explore', component: ExplorePage, meta: { requiresAuth: true } },
    { path: '/shares', name: 'shares', component: MapShares, meta: { requiresAuth: true } },
    { path: '/agent', name: 'agent', component: AgentPage, meta: { requiresAuth: true } },
    {
      path: '/admin',
      name: 'admin',
      component: AdminPage,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/data',
      name: 'admin-data',
      component: AdminData,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/shares',
      name: 'admin-shares',
      component: AdminShares,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
    {
      path: '/admin/settings',
      name: 'admin-settings',
      component: AdminSettings,
      meta: { requiresAuth: true, requiresAdmin: true },
    },
  ],
})

let watchingAuth = false

router.beforeEach(async to => {
  const authStore = useAuthStore()
  if (!watchingAuth) {
    watchingAuth = true
    watch(() => authStore.isLoggedIn, isLoggedIn => {
      if (!isLoggedIn && router.currentRoute.value.meta.requiresAuth) {
        intendedRoute = router.currentRoute.value.fullPath
        loginDialogOpen.value = true
        loginRequired.value = true
        void router.replace({ name: 'home' })
      }
    })
  }
  await authStore.initialize()
  if (to.meta.requiresAuth && !authStore.isLoggedIn) {
    intendedRoute = to.fullPath
    loginDialogOpen.value = true
    loginRequired.value = true
    return { name: 'home' }
  }
  if (to.meta.requiresAdmin && !isAdmin(authStore.user?.role)) {
    return { name: 'home' }
  }
})

export default router
