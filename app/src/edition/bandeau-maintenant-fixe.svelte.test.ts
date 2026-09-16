/**
 * Tests svelte-mount de `BandeauMaintenantFixe.svelte` — verrou du fix
 * CD 6972 (2026-09-16) sur le bandeau symétrique. Même bug destructeur
 * que « Rejouer à cette date » : le clic « Revenir à aujourd'hui »
 * rechargeait la page avec `window.location.href = ...`, ce qui vidait
 * les inscriptions et tous les états non-URL. Le fix remplace le reload
 * par un callback `onRevenirAujourdhui` que le parent gère en place.
 *
 * Cousin direct de `bandeau-session-terminee.svelte.test.ts` — même
 * classe de bug, corrigée d'un coup.
 */

import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BandeauMaintenantFixe from './BandeauMaintenantFixe.svelte'

describe('BandeauMaintenantFixe.svelte — callback in-place (CD 6972)', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  it('appelle onRevenirAujourdhui au clic (pas de reload)', () => {
    const spy = vi.fn()
    const app = mount(BandeauMaintenantFixe, {
      target: container,
      props: {
        maintenantFixe: new Date(2026, 7, 23, 12, 0),
        onRevenirAujourdhui: spy,
      },
    })
    flushSync()

    const bouton = container.querySelector('button.sortir') as HTMLButtonElement
    expect(bouton).not.toBeNull()
    bouton.click()
    flushSync()

    expect(spy).toHaveBeenCalledOnce()
    unmount(app)
  })

  it("n'affiche pas le bandeau quand maintenantFixe est null", () => {
    const spy = vi.fn()
    const app = mount(BandeauMaintenantFixe, {
      target: container,
      props: { maintenantFixe: null, onRevenirAujourdhui: spy },
    })
    flushSync()

    expect(container.querySelector('button.sortir')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    unmount(app)
  })
})
