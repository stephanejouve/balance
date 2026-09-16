/**
 * Tests svelte-mount de `BandeauSessionTerminee.svelte` — verrou du fix
 * CD 6972 (2026-09-16). Bug destructeur observé en ligne le 15/09 sur
 * `de0812b` : le clic « Rejouer à cette date » rechargeait la page avec
 * `window.location.href = ...`, ce qui vidait les inscriptions et tous
 * les états non-URL (imports, mutations de contraintes, etc.). Le fix
 * remplace le reload par un callback `onRejouer` que le parent gère en
 * place (mutation `maintenantFixe` + `history.pushState`).
 *
 * Le test verrouille le contrat du composant : au clic, il DOIT appeler
 * `onRejouer` avec la date proposée, et rien d'autre. Un futur refactor
 * qui remettrait un `window.location.href = ...` inline casserait la
 * classe entière — ce test est la barrière qui l'attrape.
 */

import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BandeauSessionTerminee from './BandeauSessionTerminee.svelte'

describe('BandeauSessionTerminee.svelte — callback in-place (CD 6972)', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  it('appelle onRejouer avec la dateProposee au clic (pas de reload)', () => {
    const spy = vi.fn()
    const app = mount(BandeauSessionTerminee, {
      target: container,
      props: {
        proposition: { dateFin: '2026-08-28', dateProposee: '2026-08-23' },
        onRejouer: spy,
      },
    })
    flushSync()

    const bouton = container.querySelector('button.rejouer') as HTMLButtonElement
    expect(bouton).not.toBeNull()
    bouton.click()
    flushSync()

    expect(spy).toHaveBeenCalledExactlyOnceWith('2026-08-23')
    unmount(app)
  })

  it("n'appelle rien quand proposition est null (bandeau non affiché)", () => {
    const spy = vi.fn()
    const app = mount(BandeauSessionTerminee, {
      target: container,
      props: { proposition: null, onRejouer: spy },
    })
    flushSync()

    // Pas de bandeau, pas de bouton — le composant ne rend rien.
    expect(container.querySelector('button.rejouer')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    unmount(app)
  })
})
