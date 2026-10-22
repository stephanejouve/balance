/**
 * #165 (CD 2026-10-22) : une session neuve arrive avec une grille ; l'étape
 * 2b dit que c'est une PROPOSITION par défaut, pas une donnée du lieu —
 * tant qu'elle est inchangée, et plus du tout dès qu'on la modifie.
 */
import { flushSync, mount, unmount } from 'svelte'
import { expect, it } from 'vitest'
import { GRILLE_PROPOSEE } from '../domain/grille'
import { Session as SessionSchema } from '../domain/model'
import SessionComponent from './Session.svelte'

function rendre(grille: Array<{ debut: string; fin: string; pas_minutes: number; jours?: string[] }>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const session = $state(SessionSchema.parse({ id: 's', nom: 'S', lieu_id: 'l', date_debut: '2026-10-22', date_fin: '2026-10-28', date_butoir: '2026-10-28', grille }))
  const c = mount(SessionComponent, {
    target: container,
    props: { session, nbCreneaux: 49, onAjouterRegle: () => {}, onSupprimerRegle: () => {}, onInvalider: () => {} },
  })
  flushSync()
  return { container, c, session }
}
const PHRASE = 'Grille proposée par défaut, 9h-12h et 14h-18h'

it('grille d\'une session neuve : la phrase dit que c\'est une proposition', () => {
  const { container, c } = rendre(GRILLE_PROPOSEE.map((r) => ({ ...r })))
  expect(container.textContent).toContain(PHRASE)
  unmount(c)
})

it('dès qu\'on modifie la grille, la phrase disparaît (elle ne décrit plus ce qui est là)', () => {
  const { container, c } = rendre([{ ...GRILLE_PROPOSEE[0] }, { debut: '14:00', fin: '18:59', pas_minutes: 60 }])
  expect(container.textContent).not.toContain(PHRASE)
  unmount(c)
})

it('grille de la démo (3 règles) : pas de phrase', () => {
  const { container, c } = rendre([
    { debut: '09:00', fin: '11:59', pas_minutes: 60 },
    { debut: '13:30', fin: '18:29', pas_minutes: 60 },
    { debut: '22:00', fin: '23:59', pas_minutes: 60 },
  ])
  expect(container.textContent).not.toContain(PHRASE)
  unmount(c)
})
