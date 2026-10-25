/**
 * #216 : en production, le nouveau SW a pris la main 30 s après son
 * installation, 1,76 s APRÈS l'expiration du délai de 15 s. Le message
 * « pas encore installée » restait à l'écran et le clic était perdu.
 * Ces tests déclenchent controllerchange après le délai, pas seulement avant.
 * Arbitrage CD 59806 : passé le délai, pas de rechargement automatique ; le
 * bandeau annonce la version prête et c'est un nouveau clic qui recharge.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const rechargerPage = vi.fn()
vi.mock('./recharger-page', () => ({ rechargerPage: () => rechargerPage() }))

const { default: MiseAJourBandeau } = await import('./MiseAJourBandeau.svelte')

let cible: EventTarget
let reg: { update: () => Promise<void>; installing: ServiceWorker | null; waiting: null; addEventListener: () => void }

function installerSW(update: () => Promise<void>) {
  cible = new EventTarget()
  reg = {
    update,
    installing: {} as ServiceWorker,
    waiting: null,
    addEventListener: () => {},
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: {
      register: async () => reg,
      getRegistration: async () => reg,
      addEventListener: cible.addEventListener.bind(cible),
      removeEventListener: cible.removeEventListener.bind(cible),
    },
  })
}

function prendreControle() {
  // Le nouveau SW est aux commandes : plus rien en cours d'installation.
  reg.installing = null
  cible.dispatchEvent(new Event('controllerchange'))
  flushSync()
}

beforeEach(() => {
  rechargerPage.mockClear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ version: '29991231.2359' }), { status: 200 })))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  delete (navigator as { serviceWorker?: unknown }).serviceWorker
})

async function rendre() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const c = mount(MiseAJourBandeau, { target: container })
  await vi.waitFor(() => {
    flushSync()
    expect(container.querySelector('.bandeau')).not.toBeNull()
  })
  const texte = () => container.textContent!.replace(/\s+/g, ' ')
  const principal = () => container.querySelector<HTMLButtonElement>('button.btn-principal')!
  return { texte, principal, fin: () => { unmount(c); container.remove() } }
}

async function cliquerPuisDepasserLeDelai(r: Awaited<ReturnType<typeof rendre>>) {
  vi.useFakeTimers()
  r.principal().click()
  await vi.advanceTimersByTimeAsync(15001)
  flushSync()
}

it('prise de main après le délai : pas de rechargement, la version prête est annoncée, un nouveau clic recharge', async () => {
  installerSW(async () => undefined)
  const r = await rendre()
  await cliquerPuisDepasserLeDelai(r)
  expect(rechargerPage).not.toHaveBeenCalled()
  expect(r.texte()).toContain(
    "L'installation prend plus de temps que prévu. La page ne se rechargera pas d'elle-même : ce message changera quand la nouvelle version sera prête.",
  )
  expect(r.texte()).not.toContain('réessaie')
  prendreControle()
  expect(rechargerPage).not.toHaveBeenCalled()
  expect(r.texte()).toContain('La nouvelle version est prête : clique sur « Recharger » pour l\'utiliser.')
  expect(r.texte()).not.toContain('prend plus de temps')
  expect(r.texte()).not.toContain('pas encore installée')
  expect(r.principal().textContent!.trim()).toBe('Recharger')
  expect(r.principal().disabled).toBe(false)
  r.principal().click()
  await vi.advanceTimersByTimeAsync(0)
  expect(rechargerPage).toHaveBeenCalledOnce()
  r.fin()
})

it('pendant l’attente : pas de bouton Annuler, « Recharger » reste disponible', async () => {
  installerSW(async () => undefined)
  const r = await rendre()
  await cliquerPuisDepasserLeDelai(r)
  expect(r.texte()).not.toContain('Annuler')
  expect(r.principal().textContent!.trim()).toBe('Recharger')
  expect(r.principal().disabled).toBe(false)
  r.fin()
})

it('vérification en échec : le message est retiré à la prise de main, qui le rendrait faux', async () => {
  installerSW(async () => { throw new Error('offline') })
  const r = await rendre()
  r.principal().click()
  await vi.waitFor(() => {
    flushSync()
    expect(r.texte()).toContain('La vérification de la nouvelle version a échoué : réessaie dans un instant.')
  })
  prendreControle()
  expect(r.texte()).not.toContain('a échoué')
  expect(rechargerPage).not.toHaveBeenCalled()
  r.fin()
})

it('prise de main avant le délai : rechargement, comme avant', async () => {
  installerSW(async () => undefined)
  const r = await rendre()
  vi.useFakeTimers()
  r.principal().click()
  await vi.advanceTimersByTimeAsync(1000)
  prendreControle()
  await vi.advanceTimersByTimeAsync(0)
  expect(rechargerPage).toHaveBeenCalledOnce()
  r.fin()
})
