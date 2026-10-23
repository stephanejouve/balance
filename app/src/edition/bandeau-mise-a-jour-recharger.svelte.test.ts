/**
 * #205 : sur le site en ligne, la nouvelle version détectée par le manifest
 * (path fetch, arrivé avant le service worker) n'était proposée qu'en
 * « Télécharger », qui dépose un fichier et laisse l'onglet sur l'ancienne
 * version. Le remède constaté par CD était le rechargement.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, it, vi } from 'vitest'
import MiseAJourBandeau from './MiseAJourBandeau.svelte'

afterEach(() => {
  vi.unstubAllGlobals()
})

async function rendre() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: '29991231.2359' }), { status: 200 })))
  const container = document.createElement('div')
  document.body.appendChild(container)
  const c = mount(MiseAJourBandeau, { target: container })
  await vi.waitFor(() => {
    flushSync()
    expect(container.querySelector('.bandeau')).not.toBeNull()
  })
  return { container, fin: () => { unmount(c); container.remove() } }
}

it('sur le web (http:), path fetch : « Recharger » en principal, « Télécharger » en secondaire', async () => {
  expect(location.protocol).toMatch(/^https?:$/)
  const r = await rendre()
  const boutons = [...r.container.querySelectorAll('.actions button, .actions a')].map((e) => e.textContent!.trim())
  expect(boutons).toEqual(['Recharger', 'Télécharger', '×'])
  expect(r.container.querySelector('button.btn-principal')!.textContent).toBe('Recharger')
  expect(r.container.querySelector('a[download]')!.classList.contains('btn-secondaire')).toBe(true)
  r.fin()
})

it('le bandeau prévient avant le clic que le rechargement repart d\'une page vierge', async () => {
  const r = await rendre()
  expect(r.container.textContent!.replace(/\s+/g, ' ')).toContain(
    "Le rechargement repart d'une page vierge : sauvegarde d'abord ton travail (« Sauvegarder l'état .json »).",
  )
  r.fin()
})
