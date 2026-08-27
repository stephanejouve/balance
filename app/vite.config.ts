/// <reference types="vitest" />
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { viteSingleFile } from 'vite-plugin-singlefile'

export default defineConfig({
  // Base relative : permet à `dist/balance.html` de fonctionner quel que soit
  // le chemin de service (double-clic file:// ou GitHub Pages sous /balance/).
  base: './',
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
  },
})
