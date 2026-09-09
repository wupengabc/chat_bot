import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

export type ThemeMode = 'system' | 'light' | 'dark'
export type ThemePalette = 'forest' | 'md-blue' | 'violet' | 'amber'

type ResolvedTheme = 'light' | 'dark'
type ThemeTokens = {
  pageBgStart: string
  pageBgEnd: string
  pageText: string
  pageMuted: string
  panelBg: string
  panelText: string
  mutedText: string
  surface: string
  surfaceHover: string
  surfaceSelected: string
  border: string
  accent: string
  accentContrast: string
  accentSoft: string
  success: string
  successText: string
  successSoft: string
  warning: string
  warningText: string
  warningSoft: string
  danger: string
  overlay: string
  shadow: string
}

const storageKey = 'wp-bx-theme-settings'

const palettes: Record<ThemePalette, Record<ResolvedTheme, ThemeTokens>> = {
  forest: {
    light: { pageBgStart: '#edf3eb', pageBgEnd: '#d7e2d8', pageText: '#1e3327', pageMuted: '#526b5b', panelBg: '#fafbf6', panelText: '#1d3024', mutedText: '#66766b', surface: '#edf1e9', surfaceHover: '#e1e8df', surfaceSelected: '#d5e2d2', border: '#c9d3c8', accent: '#4f7b35', accentContrast: '#f7faef', accentSoft: '#dceacd', success: '#43823f', successText: '#28552b', successSoft: '#dcebd2', warning: '#a66d1d', warningText: '#70460c', warningSoft: '#f5e4bd', danger: '#b74438', overlay: 'rgba(20,39,28,.32)', shadow: 'rgba(34,54,42,.16)' },
    dark: { pageBgStart: '#10261f', pageBgEnd: '#07130f', pageText: '#e8eee8', pageMuted: '#91a399', panelBg: '#14251f', panelText: '#e5ece6', mutedText: '#87998f', surface: '#1a3028', surfaceHover: '#233d33', surfaceSelected: '#29483a', border: '#345047', accent: '#8bb85b', accentContrast: '#102015', accentSoft: '#29482f', success: '#71b565', successText: '#b9e6b4', successSoft: '#203e2a', warning: '#d1a04a', warningText: '#f0d39c', warningSoft: '#45371e', danger: '#e07367', overlay: 'rgba(2,8,5,.72)', shadow: 'rgba(0,0,0,.42)' },
  },
  'md-blue': {
    light: { pageBgStart: '#f4f8fd', pageBgEnd: '#dfeaf7', pageText: '#18324b', pageMuted: '#4f6982', panelBg: '#ffffff', panelText: '#17324d', mutedText: '#60758b', surface: '#edf4fb', surfaceHover: '#e1edf9', surfaceSelected: '#d2e5f8', border: '#bdd3e9', accent: '#1565c0', accentContrast: '#ffffff', accentSoft: '#d6e8fa', success: '#2e7d5a', successText: '#205c43', successSoft: '#d8eee5', warning: '#a96612', warningText: '#71430a', warningSoft: '#f7e5bd', danger: '#c43d3d', overlay: 'rgba(15,45,75,.28)', shadow: 'rgba(20,68,112,.17)' },
    dark: { pageBgStart: '#0d2945', pageBgEnd: '#050f1b', pageText: '#e9f2fb', pageMuted: '#91abc3', panelBg: '#101f2e', panelText: '#e5eff9', mutedText: '#849bb0', surface: '#172b3e', surfaceHover: '#203950', surfaceSelected: '#254763', border: '#31536e', accent: '#5ba7eb', accentContrast: '#071725', accentSoft: '#183d5f', success: '#64b88f', successText: '#b5e5cf', successSoft: '#173d31', warning: '#d8a24a', warningText: '#f1d29a', warningSoft: '#47371d', danger: '#ed7777', overlay: 'rgba(2,8,15,.75)', shadow: 'rgba(0,0,0,.46)' },
  },
  violet: {
    light: { pageBgStart: '#f8f4fd', pageBgEnd: '#e8def5', pageText: '#35254c', pageMuted: '#67577d', panelBg: '#fdfbff', panelText: '#332448', mutedText: '#756886', surface: '#f1ecf8', surfaceHover: '#e8e0f3', surfaceSelected: '#ddcff0', border: '#d2c2e7', accent: '#6f49b5', accentContrast: '#ffffff', accentSoft: '#e5d8f7', success: '#47805b', successText: '#2b593a', successSoft: '#dcebdd', warning: '#a56b1c', warningText: '#70470c', warningSoft: '#f4e2bd', danger: '#b94552', overlay: 'rgba(45,28,68,.3)', shadow: 'rgba(60,38,88,.18)' },
    dark: { pageBgStart: '#291b43', pageBgEnd: '#0e0818', pageText: '#f1eafa', pageMuted: '#b7a7ca', panelBg: '#21172f', panelText: '#eee6f7', mutedText: '#a091b2', surface: '#2c203d', surfaceHover: '#3a2b50', surfaceSelected: '#493663', border: '#5b4673', accent: '#b28ae1', accentContrast: '#1b1028', accentSoft: '#432e5e', success: '#75b987', successText: '#bee6c7', successSoft: '#25422f', warning: '#d4a04d', warningText: '#efd29c', warningSoft: '#49371f', danger: '#e47784', overlay: 'rgba(7,3,12,.76)', shadow: 'rgba(0,0,0,.47)' },
  },
  amber: {
    light: { pageBgStart: '#fff9ed', pageBgEnd: '#f2dfbd', pageText: '#4a2d13', pageMuted: '#76593c', panelBg: '#fffdf8', panelText: '#4b2d12', mutedText: '#806a4e', surface: '#faf0df', surfaceHover: '#f5e5ca', surfaceSelected: '#f0d9b2', border: '#e2c99e', accent: '#a85f0b', accentContrast: '#ffffff', accentSoft: '#f7dfb8', success: '#4b7b43', successText: '#31552e', successSoft: '#dce9d5', warning: '#a85f0b', warningText: '#6d3d08', warningSoft: '#f7dfb8', danger: '#b94439', overlay: 'rgba(66,39,13,.3)', shadow: 'rgba(91,54,17,.17)' },
    dark: { pageBgStart: '#3a230d', pageBgEnd: '#140b03', pageText: '#f8eedc', pageMuted: '#c2a77d', panelBg: '#281b0f', panelText: '#f3e8d5', mutedText: '#ae9672', surface: '#372719', surfaceHover: '#493522', surfaceSelected: '#5a4229', border: '#6c5132', accent: '#e0a24c', accentContrast: '#211306', accentSoft: '#543b1d', success: '#7bb06f', successText: '#c6e3be', successSoft: '#2c4127', warning: '#e0a24c', warningText: '#f5d59e', warningSoft: '#533b1e', danger: '#e27869', overlay: 'rgba(10,5,1,.76)', shadow: 'rgba(0,0,0,.48)' },
  },
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>('system')
  const palette = ref<ThemePalette>('forest')
  const systemIsDark = ref(false)
  const initialized = ref(false)
  let mediaQuery: MediaQueryList | undefined
  const isDark = computed(() => mode.value === 'dark' || (mode.value === 'system' && systemIsDark.value))
  const icon = computed(() => (mode.value === 'dark' ? '☾' : mode.value === 'light' ? '☼' : '◐'))

  function persist() {
    if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey, JSON.stringify({ mode: mode.value, palette: palette.value }))
  }

  function syncDocument() {
    if (typeof document === 'undefined') return
    const resolvedTheme: ResolvedTheme = isDark.value ? 'dark' : 'light'
    const root = document.documentElement
    root.dataset.theme = mode.value
    root.dataset.resolvedTheme = resolvedTheme
    root.dataset.palette = palette.value
    root.style.colorScheme = resolvedTheme
    Object.entries(palettes[palette.value][resolvedTheme]).forEach(([name, value]) => {
      root.style.setProperty(`--${name.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value)
    })
  }

  function setMode(nextMode: ThemeMode) { mode.value = nextMode; persist(); syncDocument() }
  function setPalette(nextPalette: ThemePalette) { palette.value = nextPalette; persist(); syncDocument() }
  function handleSystemChange(event: MediaQueryListEvent) { systemIsDark.value = event.matches; if (mode.value === 'system') syncDocument() }

  function initialize() {
    if (typeof window === 'undefined' || initialized.value) return
    try {
      const settings = JSON.parse(localStorage.getItem(storageKey) || '{}') as { mode?: ThemeMode; palette?: ThemePalette }
      if (settings.mode === 'system' || settings.mode === 'light' || settings.mode === 'dark') mode.value = settings.mode
      if (settings.palette === 'forest' || settings.palette === 'md-blue' || settings.palette === 'violet' || settings.palette === 'amber') palette.value = settings.palette
    } catch { /* use defaults */ }
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemIsDark.value = mediaQuery.matches
    mediaQuery.addEventListener('change', handleSystemChange)
    initialized.value = true
    syncDocument()
  }

  function dispose() { mediaQuery?.removeEventListener('change', handleSystemChange) }
  return { mode, palette, isDark, icon, initialize, dispose, setMode, setPalette }
})
