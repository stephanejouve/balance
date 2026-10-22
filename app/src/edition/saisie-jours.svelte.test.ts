/**
 * Lot dates #173 — dans les éditeurs, une date JJ/MM/AAAA tapée est
 * acceptée (stockée en ISO, réaffichée telle quelle), et un jour illisible
 * se voit LÀ OÙ il est saisi, règle par règle.
 */
import { flushSync, mount, unmount } from 'svelte'
import { expect, it } from 'vitest'
import { Session as SessionSchema, type Personne } from '../domain/model'
import Indispos from './Indispos.svelte'
import SessionComponent from './Session.svelte'

function taper(input: HTMLInputElement, v: string) {
  input.value = v
  input.dispatchEvent(new Event('input', { bubbles: true }))
  flushSync()
}

it('1D : « 25/08/2026 » stocké en ISO, réaffiché en JJ/MM/AAAA ; « lundo » signalé, avec la règle ignorée', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const personnes = $state([
    { id: 'p', nom: 'Léa', discriminant: '', instruments: [], role: 'musicien', indispos: [{ jours: [], roles: [], motif: '' }] } as Personne,
  ])
  const c = mount(Indispos, {
    target: container,
    props: { personnesAvecIndispo: personnes, personnesSansIndispo: [], nbIndispoTotal: 1, onAjouterIndispo: () => {}, onSupprimerIndispo: () => {}, onInvalider: () => {} },
  })
  flushSync()
  const champ = () => container.querySelector<HTMLInputElement>('input[placeholder="mardi, 25/08/2026"]')!
  taper(champ(), '25/08/2026')
  expect(personnes[0].indispos[0].jours).toEqual(['2026-08-25'])
  expect(champ().value).toBe('25/08/2026')
  expect(container.querySelector('[role="note"]')?.textContent ?? '').not.toMatch(/non reconnu/)

  taper(champ(), 'lundo')
  expect(container.querySelector('.indispo-ignoree')!.textContent).toMatch(/Ignorée dans le calcul\. Jour non reconnu \(« lundo »\)/)

  taper(champ(), '25/08/2026, lundo')
  expect(container.querySelector('.indispo-ignoree')!.textContent).toMatch(/^Jour non reconnu, ignoré : « lundo »/)
  unmount(c)
})

it('2B : règle avec un jour illisible ou hors session — signalé sur la règle, même si la grille produit des créneaux', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const session = $state(
    SessionSchema.parse({
      id: 's', nom: 'S', lieu_id: 'l', date_debut: '2026-08-24', date_fin: '2026-08-28', date_butoir: '2026-08-28',
      grille: [{ debut: '09:00', fin: '11:59', pas_minutes: 60 }, { debut: '14:00', fin: '17:59', pas_minutes: 60 }],
    }),
  )
  const c = mount(SessionComponent, {
    target: container,
    props: { session, nbCreneaux: 20, onAjouterRegle: () => {}, onSupprimerRegle: () => {}, onInvalider: () => {} },
  })
  flushSync()
  const champs = container.querySelectorAll<HTMLInputElement>('input[placeholder="tous les jours"]')
  taper(champs[0], '25/08/2026')
  expect(session.grille[0].jours).toEqual(['2026-08-25'])
  expect(container.querySelector('.jour-ignore')).toBeNull()

  taper(champs[0], '25/13/2026, 30/09/2026')
  const note = container.querySelector('.jour-ignore')!.textContent!.replace(/\s+/g, ' ')
  expect(note).toContain('Non reconnu, ignoré : « 25/13/2026 »')
  expect(note).toContain('Hors des dates de la session, ignoré : 30/09/2026')
  unmount(c)
})
