import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// `pnpm build:design` only: a static design preview with fixtures in place of the session
// service (src/designPreview). MODE is a build-time constant, so every other build drops this.
if (import.meta.env.MODE === 'design') {
  void import('./designPreview/install').then((m) => m.installDesignPreview()).then(render)
} else {
  render()
}
