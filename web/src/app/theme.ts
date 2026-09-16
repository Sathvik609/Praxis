export type Theme = 'light' | 'dark'
const KEY = 'praxis.theme'

export function getTheme(): Theme {
  try {
    return (localStorage.getItem(KEY) as Theme | null) ?? 'light'
  } catch {
    return 'light'
  }
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  try {
    localStorage.setItem(KEY, t)
  } catch {
    /* private mode: theme is not persisted */
  }
}
