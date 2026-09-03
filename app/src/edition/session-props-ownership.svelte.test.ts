/**
 * Tests d'ownership des props sur Session.svelte — bug #19 smoke Stéphane
 * 2026-09-03 : « la marge d'occupation change toute seule après suppression
 * d'une salle et relance ». Corrélé aux 156 warnings `ownership_invalid_mutation`
 * pointant tous sur Session.svelte:38 (`bind:value={session.marge_pct}`).
 *
 * Le test suit la consigne Stéphane 2026-09-03 : reproduire le bug AVANT
 * de corriger, pour prouver que le fix traite la cause et pas un symptôme.
 *
 * Setup : mount() Svelte 5 en jsdom (déjà configuré via `environment: jsdom`
 * dans vite.config.ts). Fichier `.svelte.test.ts` pour autoriser les runes
 * (`$state`, `$props`) dans un test — vite.config.ts:38 étend `include`.
 */

import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import { Session as SessionSchema } from '../domain/model'
import SessionComponent from './Session.svelte'

describe('Session.svelte — ownership prop mutation (bug #19)', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  const mountSession = (session: ReturnType<typeof SessionSchema.parse>, nbCreneaux = 28) =>
    mount(SessionComponent, {
      target: container,
      props: {
        session,
        nbCreneaux,
        onAjouterRegle: () => {},
        onSupprimerRegle: () => {},
        onInvalider: () => {},
      },
    })

  it('marge_pct=0 est conservé au mount (verrou initial)', () => {
    const session = SessionSchema.parse({
      id: 's',
      nom: 'test',
      lieu_id: 'l',
      date_debut: '2026-01-01',
      date_fin: '2026-01-07',
      date_butoir: '2026-01-07',
      marge_pct: 0,
    })
    const comp = mountSession(session)
    flushSync()

    const range = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(range).not.toBeNull()
    expect(range.value).toBe('0')
    expect(session.marge_pct).toBe(0)

    unmount(comp)
  })

  it('marge_pct=0 défini par Zod default → mount respecte 0 (pas 20)', () => {
    // Défaut Zod = 0 (model.ts:278). Si un pattern `|| 20` ou similaire
    // transformait 0 en 20 quelque part, ce test échouerait.
    const session = SessionSchema.parse({
      id: 's',
      nom: 'test',
      lieu_id: 'l',
      date_debut: '2026-01-01',
      date_fin: '2026-01-07',
      date_butoir: '2026-01-07',
      // marge_pct absent → défaut Zod
    })
    expect(session.marge_pct).toBe(0)

    const comp = mountSession(session)
    flushSync()
    const range = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(range.value).toBe('0')

    unmount(comp)
  })

  it('marge_pct=0 préservé après changement de nbCreneaux (re-render prop parente)', () => {
    // Reproduit le scénario Stéphane :
    // - Session avec marge_pct=0
    // - Utilisateur supprime une salle → nbCreneaux change (dérivé de lieu)
    // - Le composant se ré-évalue avec la nouvelle nbCreneaux
    // - marge_pct doit rester à 0 dans l'objet session partagé
    const session = $state(
      SessionSchema.parse({
        id: 's',
        nom: 'test',
        lieu_id: 'l',
        date_debut: '2026-01-01',
        date_fin: '2026-01-07',
        date_butoir: '2026-01-07',
        marge_pct: 0,
      }),
    )
    const wrapper = $state({ nbCreneaux: 28 })
    const comp = mount(SessionComponent, {
      target: container,
      props: {
        get session() {
          return session
        },
        get nbCreneaux() {
          return wrapper.nbCreneaux
        },
        onAjouterRegle: () => {},
        onSupprimerRegle: () => {},
        onInvalider: () => {},
      },
    })
    flushSync()

    // Simule suppression d'une salle → recalcul nbCreneaux
    wrapper.nbCreneaux = 20
    flushSync()

    // La valeur dans l'objet partagé doit rester à 0
    expect(session.marge_pct).toBe(0)
    // Le DOM aussi
    const range = container.querySelector('input[type="range"]') as HTMLInputElement
    expect(range.value).toBe('0')

    unmount(comp)
  })

  it('mutation depuis l\'input range se propage au session parent (contrat $bindable)', () => {
    // Vérifie que le composant, une fois muni de `$bindable()`, propage
    // bien les changements user vers l'objet parent. Sans `$bindable()`
    // (état Svelte 5 en Q1 2025+), la mutation reste locale et le parent
    // ne voit rien — d'où les 156 warnings `ownership_invalid_mutation`
    // observés au smoke Stéphane 2026-09-03.
    const session = $state(
      SessionSchema.parse({
        id: 's',
        nom: 'test',
        lieu_id: 'l',
        date_debut: '2026-01-01',
        date_fin: '2026-01-07',
        date_butoir: '2026-01-07',
        marge_pct: 0,
      }),
    )
    const comp = mount(SessionComponent, {
      target: container,
      props: {
        get session() {
          return session
        },
        set session(v) {
          Object.assign(session, v)
        },
        nbCreneaux: 28,
        onAjouterRegle: () => {},
        onSupprimerRegle: () => {},
        onInvalider: () => {},
      },
    })
    flushSync()

    // Simule l'utilisateur qui bouge le curseur à 25%
    const range = container.querySelector('input[type="range"]') as HTMLInputElement
    range.value = '25'
    range.dispatchEvent(new Event('input', { bubbles: true }))
    flushSync()

    // La mutation user doit avoir traversé la frontière prop → objet parent.
    expect(session.marge_pct).toBe(25)

    unmount(comp)
  })
})
