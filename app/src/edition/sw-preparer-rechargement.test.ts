/**
 * #205, review Leader : « Recharger » cliqué pendant que le nouveau SW
 * s'installe resservait l'ancienne version. On ne recharge qu'une fois le
 * nouveau SW aux commandes.
 */
import { expect, it, vi } from 'vitest'
import { preparerRechargement } from './sw-register'

function conteneur(reg: Partial<ServiceWorkerRegistration> | undefined) {
  const cible = new EventTarget()
  return {
    getRegistration: async () => reg as ServiceWorkerRegistration | undefined,
    addEventListener: cible.addEventListener.bind(cible),
    removeEventListener: cible.removeEventListener.bind(cible),
    prendreControle: () => cible.dispatchEvent(new Event('controllerchange')),
  }
}

it('sans service worker : on peut recharger', async () => {
  expect(await preparerRechargement(undefined)).toBe(true)
  expect(await preparerRechargement(conteneur(undefined) as never)).toBe(true)
})

it('aucun SW en installation après update() : on peut recharger', async () => {
  const update = vi.fn(async () => undefined)
  expect(await preparerRechargement(conteneur({ update, installing: null, waiting: null } as never) as never)).toBe(true)
  expect(update).toHaveBeenCalledOnce()
})

it('SW en installation : on attend qu\'il prenne le contrôle', async () => {
  const c = conteneur({ update: async () => undefined, installing: {} as ServiceWorker, waiting: null } as never)
  let fini = false
  const p = preparerRechargement(c as never, 1000).then((v) => { fini = true; return v })
  await Promise.resolve(); await Promise.resolve()
  expect(fini).toBe(false)
  c.prendreControle()
  expect(await p).toBe(true)
})

it('SW en installation qui n\'aboutit pas dans le délai : on ne recharge pas', async () => {
  vi.useFakeTimers()
  const c = conteneur({ update: async () => undefined, installing: {} as ServiceWorker, waiting: null } as never)
  const p = preparerRechargement(c as never, 1000)
  await vi.advanceTimersByTimeAsync(1001)
  expect(await p).toBe(false)
  vi.useRealTimers()
})

it('update() en échec : on ne recharge pas', async () => {
  const c = conteneur({ update: async () => { throw new Error('offline') } } as never)
  expect(await preparerRechargement(c as never)).toBe(false)
})
