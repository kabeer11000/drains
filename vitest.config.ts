import { defineConfig } from 'vitest/config'
import path from 'node:path'

// Deliberately not importing astro.config.mjs here — that pulls in the
// Astro/Vite integration pipeline, which vitest doesn't need just to run
// plain .ts unit tests. Only the '@' alias (from tsconfig.json paths) is
// needed to resolve imports the same way the app does.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
