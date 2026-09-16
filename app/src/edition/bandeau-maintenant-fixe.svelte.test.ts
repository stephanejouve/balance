/**
 * Tests svelte-mount de `BandeauMaintenantFixe.svelte`.
 *
 * Verrous cumulés :
 *  - CD 6972 (fix bug destructeur reload) : le clic doit passer par un
 *    callback, pas par `window.location.href`.
 *  - CD 6982 (état incohérent post-rechargement) : quand `sessionVide`
 *    est vrai (inscriptions vides mais `?maintenant=` préservé), le
 *    bandeau nomme cet état plutôt que laisser croire au rejeu qui
 *    aurait vidé les données.
 */

import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BandeauMaintenantFixe from './BandeauMaintenantFixe.svelte'

describe('BandeauMaintenantFixe.svelte', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  it('appelle onRevenirAujourdhui au clic (CD 6972, pas de reload)', () => {
    const spy = vi.fn()
    const app = mount(BandeauMaintenantFixe, {
      target: container,
      props: {
        maintenantFixe: new Date(2026, 7, 23, 12, 0),
        sessionVide: false,
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
      props: { maintenantFixe: null, sessionVide: false, onRevenirAujourdhui: spy },
    })
    flushSync()

    expect(container.querySelector('button.sortir')).toBeNull()
    expect(spy).not.toHaveBeenCalled()
    unmount(app)
  })

  it('affiche « aucune session chargée » quand sessionVide (CD 6982)', () => {
    // État incohérent post-rechargement : URL préserve `?maintenant=`
    // mais les inscriptions ont été réinitialisées. Le bandeau nomme
    // cet état plutôt que laisser croire que le rejeu a fait perdre
    // les données (confusion qui a coûté du temps sur les smokes).
    const app = mount(BandeauMaintenantFixe, {
      target: container,
      props: {
        maintenantFixe: new Date(2026, 7, 23, 12, 0),
        sessionVide: true,
        onRevenirAujourdhui: vi.fn(),
      },
    })
    flushSync()

    const contenu = container.querySelector('.bandeau .contenu')
    expect(contenu).not.toBeNull()
    expect(contenu!.textContent).toContain('aucune session chargée')
    unmount(app)
  })

  it("n'affiche PAS la mention quand la session porte au moins une donnée", () => {
    // Contre-exemple qui verrouille l'invariant : si un futur refactor
    // inverse la condition ou l'affiche toujours, ce test l'attrape.
    const app = mount(BandeauMaintenantFixe, {
      target: container,
      props: {
        maintenantFixe: new Date(2026, 7, 23, 12, 0),
        sessionVide: false,
        onRevenirAujourdhui: vi.fn(),
      },
    })
    flushSync()

    const contenu = container.querySelector('.bandeau .contenu')
    expect(contenu!.textContent).not.toContain('aucune session chargée')
    unmount(app)
  })
})
