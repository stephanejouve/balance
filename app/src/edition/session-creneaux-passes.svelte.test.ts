/** #166 : le récapitulatif de l'étape Session dit les créneaux déjà passés. */
import { flushSync, mount, unmount } from 'svelte'
import { expect, it } from 'vitest'
import { Session as SessionSchema } from '../domain/model'
import SessionComponent from './Session.svelte'

function recap(creneauxPasses: string | null) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const session = SessionSchema.parse({ id: 's', nom: 'S', lieu_id: 'l', date_debut: '2026-10-22', date_fin: '2026-10-28', date_butoir: '2026-10-28' })
  const c = mount(SessionComponent, {
    target: container,
    props: { session, nbCreneaux: 42, creneauxPasses, onAjouterRegle: () => {}, onSupprimerRegle: () => {}, onInvalider: () => {} },
  })
  flushSync()
  const t = container.querySelector('summary .hint')!.textContent!.replace(/\s+/g, ' ')
  unmount(c)
  return t
}

it('Session.svelte — « 42 créneaux générés — les 7 créneaux du 22/10/2026 sont déjà passés. »', () => {
  expect(recap('les 7 créneaux du 22/10/2026 sont déjà passés')).toContain('42 créneaux générés — les 7 créneaux du 22/10/2026 sont déjà passés.')
  expect(recap(null)).toContain('42 créneaux générés.')
})
