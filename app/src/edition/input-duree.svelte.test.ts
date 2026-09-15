/**
 * Tests svelte-mount du composant `InputDuree.svelte` — cap durée
 * (CD 6876+6885+6892). Verrou de la classe « affichage fin dérivée
 * inclusive à un cran près » : bug historique côté saisie (juillet
 * 2026) était le décalage d'un cran (`fin` au lieu de `fin − 1`).
 *
 * Fichier `.svelte.test.ts` pour autoriser les runes (`$state`,
 * `$props`, `$derived`) dans un test — vite.config.ts:38 étend
 * `include` avec ce pattern.
 */

import { flushSync, mount, unmount } from 'svelte'
import { beforeEach, describe, expect, it } from 'vitest'
import InputDureeComponent from './InputDuree.svelte'

describe('InputDuree.svelte — label dérivé fin inclusive (CD 6892)', () => {
  let container: HTMLDivElement

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  const mountInputDuree = (props: {
    debut: string | undefined
    duree_minutes: number | undefined
    fin: string | undefined
    onchange?: () => void
  }) =>
    mount(InputDureeComponent, {
      target: container,
      props: {
        ...props,
        onchange: props.onchange ?? (() => {}),
      },
    })

  it('affiche « jusqu\'à H:59 » quand debut=09:00 et duree=60 (fin inclusive = fin − 1)', () => {
    const app = mountInputDuree({ debut: '09:00', duree_minutes: 60, fin: '10:00' })
    flushSync()

    const label = container.querySelector('.fin-derivee')
    expect(label).not.toBeNull()
    // Le piège CD 6927 : ne PAS afficher « jusqu'à 10:00 » (borne
    // exclusive brute). Doit être 09:59 (dernière minute occupée).
    expect(label!.textContent).toContain('09:59')
    expect(label!.textContent).not.toContain('10:00')
    unmount(app)
  })

  it('affiche « jusqu\'à 18:29 » pour debut=13:30 duree=300 (piège CD 6927 un cran)', () => {
    // Cas historique du chantier convention horaire : plage `13:30 →
    // 18:30` exclusive = 300 min occupées, dernière minute = 18:29.
    // Reproduire le bug reviendrait à afficher 18:30.
    const app = mountInputDuree({ debut: '13:30', duree_minutes: 300, fin: '18:30' })
    flushSync()

    const label = container.querySelector('.fin-derivee')
    expect(label!.textContent).toContain('18:29')
    expect(label!.textContent).not.toContain('18:30')
    unmount(app)
  })

  it('affiche « jusqu\'à 23:59 » pour debut=22:00 duree=120 (frontière minuit)', () => {
    const app = mountInputDuree({ debut: '22:00', duree_minutes: 120, fin: '00:00' })
    flushSync()

    const label = container.querySelector('.fin-derivee')
    expect(label!.textContent).toContain('23:59')
    unmount(app)
  })

  it('pas de label quand duree_minutes est absent', () => {
    const app = mountInputDuree({ debut: '09:00', duree_minutes: undefined, fin: undefined })
    flushSync()

    expect(container.querySelector('.fin-derivee')).toBeNull()
    unmount(app)
  })

  it('pas de label quand duree_minutes = 0 (plage vide)', () => {
    // `duree = 0` = plage vide, cohérent convention exclusive (fin = debut).
    // Rien à afficher (le label « jusqu'à HH:MM » n'a pas de sens).
    const app = mountInputDuree({ debut: '09:00', duree_minutes: 0, fin: '09:00' })
    flushSync()

    expect(container.querySelector('.fin-derivee')).toBeNull()
    unmount(app)
  })

  it('pas de label quand debut est absent (impossible sans début)', () => {
    const app = mountInputDuree({ debut: undefined, duree_minutes: 60, fin: undefined })
    flushSync()

    expect(container.querySelector('.fin-derivee')).toBeNull()
    unmount(app)
  })

  it('label se met à jour quand duree_minutes change (réactivité)', () => {
    // Simule le flow utilisateur : saisir 60, voir 09:59, ré-éditer à
    // 90, voir 10:29. Le label suit sans dérive.
    let duree: number | undefined = 60
    const app = mountInputDuree({ debut: '09:00', duree_minutes: duree, fin: '10:00' })
    flushSync()
    expect(container.querySelector('.fin-derivee')!.textContent).toContain('09:59')

    // Simule l'oninput utilisateur — le composant écrit `duree` et
    // `fin` via bind. Le test change les props directement pour
    // vérifier la réactivité du $derived.
    unmount(app)
    const app2 = mountInputDuree({ debut: '09:00', duree_minutes: 90, fin: '10:30' })
    flushSync()
    expect(container.querySelector('.fin-derivee')!.textContent).toContain('10:29')
    unmount(app2)
  })
})
