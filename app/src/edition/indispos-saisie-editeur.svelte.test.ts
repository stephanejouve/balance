/**
 * Tests svelte-mount de `Indispos.svelte` — chemin de réparation #151
 * (arbitrage CD 2026-10-22) : une ancienne saisie ignorée se répare au
 * premier contact dans l'éditeur, parce que toute écriture pose
 * `saisie_editeur`. Mais l'ouverture seule ne marque rien.
 */
import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Personne } from '../domain/model'
import { estIndispoInterpretable } from '../engine/indispo'
import Indispos from './Indispos.svelte'

describe('Indispos.svelte — marqueur saisie_editeur (#151)', () => {
  let container: HTMLDivElement
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  function rendre(p: Personne) {
    let invalide = 0
    const c = mount(Indispos, {
      target: container,
      props: {
        personnesAvecIndispo: [p],
        personnesSansIndispo: [],
        nbIndispoTotal: p.indispos.length,
        onAjouterIndispo: () => {},
        onSupprimerIndispo: () => {},
        onInvalider: () => { invalide++ },
      },
    })
    flushSync()
    return { c, invalide: () => invalide }
  }

  const ancienne = (): Personne =>
    ({ id: 'p', nom: 'Léa', discriminant: '', instruments: [], role: 'musicien',
       indispos: [{ jours: ['mardi'], roles: [], motif: 'kiné' }] }) as Personne

  it('ouvrir l\'éditeur ne marque rien (une indispo importée n\'est pas requalifiée par simple lecture)', () => {
    const p = ancienne()
    const { c } = rendre(p)
    expect(p.indispos[0].saisie_editeur).toBeUndefined()
    expect(estIndispoInterpretable(p.indispos[0])).toBe(false)
    unmount(c)
  })

  it('réécrire le champ jours avec la MÊME valeur pose le marqueur et répare la règle', () => {
    const p = ancienne()
    const { c, invalide } = rendre(p)
    const jours = container.querySelector<HTMLInputElement>('input[placeholder="mardi, 2026-08-25"]')!
    jours.value = 'mardi'
    jours.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
    expect(p.indispos[0].jours).toEqual(['mardi'])
    expect(p.indispos[0].saisie_editeur).toBe(true)
    expect(estIndispoInterpretable(p.indispos[0])).toBe(true)
    expect(invalide()).toBe(1)
    unmount(c)
  })

  it('valider le motif inchangé (événement change) pose aussi le marqueur', () => {
    const p = ancienne()
    const { c } = rendre(p)
    const motif = container.querySelector<HTMLInputElement>('input[placeholder="motif"]')!
    motif.dispatchEvent(new Event('change', { bubbles: true }))
    flushSync()
    expect(p.indispos[0].motif).toBe('kiné')
    expect(p.indispos[0].saisie_editeur).toBe(true)
    unmount(c)
  })
})

/**
 * Le pendant de « Ignorée dans le calcul » (CD 2026-10-22, saut signalé par
 * Leader) : quand une écriture rend active une règle jusque-là ignorée,
 * l'éditeur le dit au même endroit — sinon un « arrive mardi midi » importé
 * se met à bloquer tout le mardi en silence dès qu'on touche ses rôles.
 */
describe('Indispos.svelte — une règle activée par l\'écriture le dit (#151)', () => {
  let container: HTMLDivElement
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  function rendre(indispos: Personne['indispos']) {
    const personnes = $state([
      { id: 'p', nom: 'Léa', discriminant: '', instruments: [], role: 'musicien', indispos } as Personne,
    ])
    const c = mount(Indispos, {
      target: container,
      props: {
        personnesAvecIndispo: personnes,
        personnesSansIndispo: [],
        nbIndispoTotal: indispos.length,
        onAjouterIndispo: () => {},
        onSupprimerIndispo: () => {},
        onInvalider: () => {},
      },
    })
    flushSync()
    return { c, ind: () => personnes[0].indispos[0] }
  }
  const note = () => container.querySelector('[role="note"]')?.textContent ?? null
  const taperRoles = (v: string) => {
    const roles = container.querySelector<HTMLInputElement>('input[placeholder^="rôles"]')!
    roles.value = v
    roles.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()
  }

  it('« arrive mardi midi » importé : ignorée, puis toucher les rôles → « compte maintenant : elle bloque mardi, toute la journée »', () => {
    const { c, ind } = rendre([{ jours: ['mardi'], roles: [], motif: 'arrive mardi midi' }])
    expect(note()).toMatch(/^Ignorée dans le calcul/)
    taperRoles('')
    expect(ind().saisie_editeur).toBe(true)
    expect(note()).toBe('Cette règle compte maintenant : elle bloque mardi, toute la journée.')
    unmount(c)
  })

  it('une règle déjà active n\'annonce rien quand on l\'édite', () => {
    const { c } = rendre([{ jours: ['mardi'], roles: [], motif: 'absent mardi' }])
    expect(note()).toBeNull()
    taperRoles('chant')
    expect(note()).toBeNull()
    unmount(c)
  })

  it('une règle créée dans l\'éditeur (marquée d\'emblée) n\'annonce rien', () => {
    const { c } = rendre([{ jours: [], roles: [], motif: '', saisie_editeur: true }])
    expect(note()).toMatch(/^Ignorée dans le calcul/)
    taperRoles('chant')
    expect(note()).toBeNull()
    unmount(c)
  })
})
