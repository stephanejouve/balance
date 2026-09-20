/**
 * Tests svelte-mount du composant `Inscriptions.svelte` — colonne Resp.
 * étape 1b affiche le **libellé** de la personne, pas l'id technique
 * slugifié (CD 6990 anomalie 8, précisé CD 7361 2026-09-20).
 *
 * Garde-fou négatif (feedback CD 6701) : le test ferme la porte au
 * bug historique où l'input `bind:value={g.responsable_id}` affichait
 * `fanny-a` (id slugifié) au lieu de `Fanny (A)` (libellé). Le fix
 * remplace l'input libre par un `<select>` peuplé des personnes.
 *
 * Fichier `.svelte.test.ts` pour autoriser les runes ($state, $derived)
 * dans le test — vite.config.ts:38 étend `include` avec ce pattern.
 */

import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Inscriptions, Personne, Session } from '../domain/model'
import InscriptionsComponent from './Inscriptions.svelte'

describe('Inscriptions.svelte — colonne Resp. affiche libellé (CD 6990 #8)', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  const fanny: Personne = { id: 'fanny-a', nom: 'Fanny', discriminant: '(A)' } as Personne
  const jocelyne: Personne = { id: 'jocelyne-a', nom: 'Jocelyne', discriminant: '(A)' } as Personne

  // Fixtures minimales — le test cible uniquement le rendu de la
  // colonne Resp. Cast via `unknown` volontaire : les champs manquants
  // (Session complet, `refus` sur Inscriptions) ne sont pas lus par
  // le rendu de la ligne du groupe, mais Zod-inférence les exige.
  const inscriptionsFixture = (respId: string): Inscriptions =>
    ({
      session_id: 's',
      personnes: [fanny, jocelyne],
      groupes: [
        {
          id: 'g1',
          titre: 'Bohemian Rhapsody',
          auteur: '',
          style: '',
          tonalite: '',
          responsable_id: respId,
          membres: [],
          postes_cherches: [],
          repetitions_deja_faites: 0,
          echeance: 'apero_mercredi',
        },
      ],
      imposes: { concert_vendredi: [] },
      refus: [],
    }) as unknown as Inscriptions

  const sessionFixture = {
    id: 's',
    debut: '2026-08-23',
    fin: '2026-08-30',
    duree_min_creneau_min: 30,
  } as unknown as Session

  const mountInscriptions = (respId: string) =>
    mount(InscriptionsComponent, {
      target: container,
      props: {
        inscriptions: inscriptionsFixture(respId),
        session: sessionFixture,
        personnesParId: new Map([
          ['fanny-a', fanny],
          ['jocelyne-a', jocelyne],
        ]),
        plus_grande_jauge_active: 30,
        onAjouterGroupe: () => {},
        onSupprimerGroupe: () => {},
        onRetirerMembre: () => {},
        onInvalider: () => {},
      },
    })

  it('la colonne Resp. affiche « Fanny (A) », jamais « fanny-a » (garde-fou sujet C rappelé CD 7361)', () => {
    const app = mountInscriptions('fanny-a')
    flushSync()

    // Ouvrir le <details> pour révéler le tbody (le composant est fermé
    // par défaut, contenu invisible tant que la summary n'est pas cliquée).
    const details = container.querySelector('details')
    details!.setAttribute('open', 'true')
    flushSync()

    const select = container.querySelector('select') as HTMLSelectElement | null
    expect(select).not.toBeNull()

    // L'option sélectionnée doit être celle de Fanny, et son texte
    // affichable = « Fanny (A) », pas « fanny-a ».
    const selectedOption = select!.querySelector('option[selected]') as HTMLOptionElement | null
      ?? Array.from(select!.options).find((o) => o.value === 'fanny-a') as HTMLOptionElement | undefined
    expect(selectedOption).toBeDefined()
    expect(selectedOption!.textContent).toContain('Fanny (A)')
    expect(selectedOption!.textContent).not.toContain('fanny-a')

    unmount(app)
  })

  it('les options du select trient par libellé, pas par id slug (Fanny avant Jocelyne)', () => {
    const app = mountInscriptions('')
    flushSync()

    const details = container.querySelector('details')
    details!.setAttribute('open', 'true')
    flushSync()

    const select = container.querySelector('select') as HTMLSelectElement
    // Ordre attendu : « — aucun — », « Fanny (A) », « Jocelyne (A) ».
    // Pas d'id technique visible dans le texte des options.
    const optionTexts = Array.from(select.options).map((o) => o.textContent?.trim() ?? '')
    expect(optionTexts).toEqual(['— aucun —', 'Fanny (A)', 'Jocelyne (A)'])
    expect(optionTexts.some((t) => t.includes('fanny-a'))).toBe(false)
    expect(optionTexts.some((t) => t.includes('jocelyne-a'))).toBe(false)

    unmount(app)
  })

  it('cas legacy : responsable_id absent des personnes → option fallback marquée « inconnu »', () => {
    // Import Excel legacy qui slugifie un nom non présent dans le
    // fichier des identités relues (cf. migrate.ts:194) — le select
    // doit garder la trace du champ existant sans le perdre.
    const app = mountInscriptions('inconnue-x')
    flushSync()

    const details = container.querySelector('details')
    details!.setAttribute('open', 'true')
    flushSync()

    const select = container.querySelector('select') as HTMLSelectElement
    const fallback = Array.from(select.options).find((o) => o.value === 'inconnue-x')
    expect(fallback).toBeDefined()
    expect(fallback!.textContent).toContain('inconnu')
    // La valeur brute reste affichée dans le libellé fallback pour
    // signaler à l'organisateur que l'identité n'est pas relue.
    expect(fallback!.textContent).toContain('inconnue-x')

    unmount(app)
  })
})
