import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/routes'
import { applyTheme, getTheme } from './app/theme'

export default function App() {
  useEffect(() => {
    applyTheme(getTheme())
  }, [])
  return <RouterProvider router={router} />
}
