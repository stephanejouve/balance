/**
 * #205 : l'installation du service worker doit contourner le cache HTTP.
 * GitHub Pages sert balance.html en `max-age=600` ; sans `cache: 'reload'`,
 * un nouveau SW pouvait remettre en cache l'ancienne page sous le nouveau
 * nom, et « Recharger » servait encore l'ancienne version.
 *
 * `public/sw.js` n'est pas un module : on l'exécute dans un contexte qui
 * simule le global d'un service worker, puis on déclenche `install`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'

it('install : chaque ressource est demandée avec cache « reload »', async () => {
  const source = readFileSync(join(__dirname, '..', '..', 'public', 'sw.js'), 'utf8')
  const ecouteurs: Record<string, (evt: unknown) => void> = {}
  const demandes: Request[] = []
  const attentes: Promise<unknown>[] = []
  const self = {
    addEventListener: (type: string, f: (evt: unknown) => void) => { ecouteurs[type] = f },
    skipWaiting: () => {},
    clients: { claim: () => {} },
    location: { origin: 'https://example.test' },
  }
  const caches = {
    open: async () => ({ add: async (r: Request) => { demandes.push(r) } }),
  }
  // Dans un vrai SW, une URL relative se résout contre l'adresse du SW.
  class RequestSW extends Request {
    constructor(url: string, init?: RequestInit) {
      super(new URL(url, 'https://example.test/balance/sw.js'), init)
    }
  }
  runInNewContext(source, { self, caches, Request: RequestSW, URL, Promise })

  ecouteurs.install({ waitUntil: (p: Promise<unknown>) => attentes.push(p) })
  await Promise.all(attentes)

  expect(demandes.length).toBe(3)
  for (const r of demandes) {
    expect(r).toBeInstanceOf(Request)
    expect(r.cache).toBe('reload')
  }
})
