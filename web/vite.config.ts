/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

// The artifact host serves no `.glb`: the design build ships the avatar as `.glb.wasm` and
// `src/designPreview/install.ts` redirects the fetch (the bytes are unchanged).
const glbAsWasm = {
  name: 'praxis-design-glb-as-wasm',
  writeBundle(opts: { dir?: string }) {
    const dir = join(opts.dir ?? 'dist-design', 'avatar')
    copyFileSync(join(dir, 'praxis_avatar.glb'), join(dir, 'praxis_avatar.glb.wasm'))
    rmSync(join(dir, 'praxis_avatar.glb'))
  },
}

// `--mode design` (pnpm build:design): the static design preview (src/designPreview). Relative
// asset URLs so it works under any path prefix, readable (unminified) output, no sourcemaps.
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'design' ? [glbAsWasm] : [])],
  ...(mode === 'design' ? { base: './', build: { outDir: 'dist-design', emptyOutDir: true, minify: false, cssMinify: false, sourcemap: false, chunkSizeWarningLimit: 8000 } } : {}),
  server: {
    proxy: {
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true, rewrite: (p) => p.replace(/^\/ws/, '') },
      '/api': { target: 'http://127.0.0.1:8000' },
      '/health': { target: 'http://127.0.0.1:8000' },
      '/events': { target: 'http://127.0.0.1:8000' },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
}))
