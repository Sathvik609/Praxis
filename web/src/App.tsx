import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/routes'
import { applyTheme, getTheme } from './app/theme'
import { applyPrefs, readPrefs } from './lib/prefs'
import { applyGuidance } from './session/guidance'

export default function App() {
  // At boot, not in Shell, so a deep link to a session screen still gets every display attribute.
  useEffect(() => {
    applyTheme(getTheme())
    applyPrefs(readPrefs())
    applyGuidance()
  }, [])
  return <RouterProvider router={router} />
}
