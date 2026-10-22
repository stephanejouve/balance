/**
 * Tests svelte-mount de `Indispos.svelte` — une règle ignorée par le
 * solveur le dit dans l'éditeur (#151, arbitrage CD 2026-10-22 : « c'est
 * le silence qui fait le défaut »).
 *
 * Garde-fou négatif : avant #151, une saisie « mardi, motif kiné » était
 * affichée et éditable sans aucun signal, alors que `indispoBloque` l'ignorait.
 */

import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Personne } from '../domain/model'
import Indispos from './Indispos.svelte'

describe('Indispos.svelte — état visible des règles ignorées (#151)', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  const personne = (indispos: Personne['indispos']): Personne =>
    ({ id: 'p', nom: 'Léa', discriminant: '', instruments: [], role: 'musicien', indispos }) as Personne

  function rendre(p: Personne) {
    const c = mount(Indispos, {
      target: container,
      props: {
        personnesAvecIndispo: [p],
        personnesSansIndispo: [],
        nbIndispoTotal: p.indispos.length,
        onAjouterIndispo: () => {},
        onSupprimerIndispo: () => {},
        onInvalider: () => {},
      },
    })
    flushSync()
    return c
  }

  it('règle ignorée : la raison est affichée sous la règle', () => {
    const c = rendre(personne([{ jours: ['mardi'], roles: [], motif: 'kiné' }]))
    const notes = container.querySelectorAll('.indispo-ignoree')
    expect(notes).toHaveLength(1)
    expect(notes[0].textContent).toContain('Ignorée dans le calcul')
    expect(notes[0].textContent).toContain('videz le motif')
    unmount(c)
  })

  it('règle interprétable : aucun signal', () => {
    const c = rendre(personne([{ jours: ['mardi'], roles: [], motif: '' }]))
    expect(container.querySelectorAll('.indispo-ignoree')).toHaveLength(0)
    unmount(c)
  })
})
