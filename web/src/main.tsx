import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { DESIGN_PREVIEW } from './lib/config'

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

// `pnpm build:design` only: a static design preview with fixtures in place of the session
// service (src/designPreview). DESIGN_PREVIEW is a build-time constant, so every other build
// drops this import.
if (DESIGN_PREVIEW) {
  void import('./designPreview/install').then((m) => m.installDesignPreview()).then(render)
} else {
  render()
}
