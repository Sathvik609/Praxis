/** Colour theme from Settings, kept on this browser under `praxis.theme.v2`. Dark is the default
 *  (24 Oct 2026, was light; the key moved from `praxis.theme` because boot saved "light" in every
 *  browser that had opened the app, so the old key would have kept them light); `auto` follows the system colour scheme and keeps following it while the page
 *  is open. `data-theme` on <html> always holds the resolved `light | dark`; `data-theme-pref`
 *  holds the choice. */
export type Theme = 'light' | 'dark' | 'auto'
const KEY = 'praxis.theme.v2'
const THEMES: readonly Theme[] = ['light', 'dark', 'auto']
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY) as Theme | null
    return t && THEMES.includes(t) ? t : 'dark'
  } catch {
    return 'dark'
  }
}

function systemDark(): boolean {
  try {
    return window.matchMedia(DARK_QUERY).matches
  } catch {
    return false
  }
}

let listening = false

export function applyTheme(t: Theme) {
  const root = document.documentElement
  root.dataset.theme = t === 'auto' ? (systemDark() ? 'dark' : 'light') : t
  root.dataset.themePref = t
  if (!listening) {
    try {
      window.matchMedia(DARK_QUERY).addEventListener('change', () => {
        if (root.dataset.themePref === 'auto') root.dataset.theme = systemDark() ? 'dark' : 'light'
      })
      listening = true
    } catch {
      /* no matchMedia: auto resolves once */
    }
  }
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* private mode: theme is not persisted */
  }
}
