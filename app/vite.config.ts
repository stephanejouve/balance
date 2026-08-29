/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Version = timestamp `YYYYMMDD.HHMM` UTC — monotone, string-comparable,
// aucun bump manuel à oublier. Chaque build produit une version unique.
// Injectée dans le bundle via `define` + accessible côté client comme
// `__APP_VERSION__`. Un fichier `dist/version.json` est aussi émis par
// pages.yml au deploy pour le check-update online (voir composant
// `MiseAJourBandeau.svelte`).
const APP_VERSION = (() => {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}.${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
})()

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
  },
  plugins: [svelte(), viteSingleFile()],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100_000_000,
    chunkSizeWarningLimit: 100_000_000,
    cssCodeSplit: false,
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: fileURLToPath(new URL('./balance.html', import.meta.url)),
      output: { inlineDynamicImports: true },
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.{ts,svelte}'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.d.ts',
        'src/main.ts',
        'src/fixtures/**',
      ],
    },
  },
})
