/** Colour theme from Settings, kept on this browser under `praxis.theme`. Light is the default
 *  (CLAUDE.md §1); `auto` follows the system colour scheme and keeps following it while the page
 *  is open. `data-theme` on <html> always holds the resolved `light | dark`; `data-theme-pref`
 *  holds the choice. */
export type Theme = 'light' | 'dark' | 'auto'
const KEY = 'praxis.theme'
const THEMES: readonly Theme[] = ['light', 'dark', 'auto']
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY) as Theme | null
    return t && THEMES.includes(t) ? t : 'light'
  } catch {
    return 'light'
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
