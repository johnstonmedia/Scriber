import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { copyFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * GitHub Pages serves a project site from /<repo>/, so the base path is
 * configurable. A custom domain (or Firebase Hosting / Render) serves from the
 * root, which is the default.
 */
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    react(),
    {
      // GitHub Pages has no SPA rewrite, so it answers deep links with 404.html.
      // Serving a copy of the app there makes client-side routes work.
      name: 'spa-404-fallback',
      closeBundle() {
        const dist = resolve(__dirname, 'dist')
        copyFileSync(resolve(dist, 'index.html'), resolve(dist, '404.html'))
      },
    },
  ],
})
