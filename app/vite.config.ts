/// <reference types="vitest" />
import { execSync } from 'node:child_process'
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

// SHA du commit au moment du build — discussion CD 2026-09-12 :
// « le timestamp dit QUAND, il ne dit pas CE QUI ». Un SHA de 7 caractères
// permet de vérifier immédiatement contre le dépôt qu'on est bien sur le
// bon commit — utile pour un rapport de bug tracable, un cache navigateur
// resté sur une vieille version, ou une confusion branche/main.
// En CI GitHub Actions, `actions/checkout@v4` produit un checkout git valide
// donc `git rev-parse HEAD` renvoie le SHA du merge commit sur main. En
// local dev, le SHA affiché est celui du HEAD courant.
//
// Détection du working tree modifié (nit N1 review Leader PR #106) : le SHA
// seul ne dit pas si le code buildé correspond au commit ou s'il porte des
// modifications non committées. Un suffixe `-dirty` est ajouté quand
// `git status --porcelain` retourne au moins une ligne. Le suffixe suit la
// convention `git describe --dirty` sans dépendre de l'existence d'un tag
// (qu'on n'a pas dans Balance).
//
// Fallback (nit N2) : `console.warn` sur l'erreur au lieu d'un catch
// silencieux. En CI un warn apparaît dans les logs sans faire échouer le
// build — le SHA reste vide, le pied de page dégrade proprement.
const APP_SHA = (() => {
  const cwd = import.meta.dirname
  let sha = ''
  try {
    sha = execSync('git rev-parse HEAD', { cwd }).toString().trim().slice(0, 7)
  } catch (err) {
    console.warn('[vite.config] git rev-parse HEAD indisponible, SHA build vide :', err)
    return ''
  }
  try {
    const dirty = execSync('git status --porcelain', { cwd }).toString().length > 0
    return dirty ? `${sha}-dirty` : sha
  } catch (err) {
    console.warn('[vite.config] git status --porcelain indisponible, dirty non vérifié :', err)
    return sha
  }
})()

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_SHA__: JSON.stringify(APP_SHA),
  },
  plugins: [svelte(), viteSingleFile()],
  // Force la condition `browser` pour que `svelte/mount` soit disponible en
  // test (sinon vitest résout `svelte/index-server.js` qui refuse `mount()`).
  // Requis pour les tests `.svelte.test.ts` qui montent un composant en jsdom.
  resolve: {
    conditions: process.env.VITEST ? ['browser'] : [],
  },
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
    include: ['src/**/*.test.ts', 'src/**/*.svelte.test.ts'],
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
