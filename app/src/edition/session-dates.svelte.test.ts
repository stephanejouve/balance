/**
 * Récapitulatif de l'étape Session : dates au format JJ/MM/AAAA, pas en
 * ISO (demande Stéphane 2026-10-22 : « 2026-10-22 → 2026-10-28, butoirs
 * apéro 2026-10-28 23:59 » n'est pas intelligible pour l'organisateur).
 */
import { flushSync, mount, unmount } from 'svelte'
import { expect, it } from 'vitest'
import { Session as SessionSchema } from '../domain/model'
import SessionComponent from './Session.svelte'

it('Session.svelte — le récapitulatif affiche les dates en JJ/MM/AAAA', () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const session = SessionSchema.parse({
    id: 's', nom: 'Nouvelle session', lieu_id: 'l',
    date_debut: '2026-10-22', date_fin: '2026-10-28', date_butoir: '2026-10-28',
  })
  const comp = mount(SessionComponent, {
    target: container,
    props: { session, nbCreneaux: 42, onAjouterRegle: () => {}, onSupprimerRegle: () => {}, onInvalider: () => {} },
  })
  flushSync()
  const hint = container.querySelector('summary .hint')!.textContent!
  expect(hint).toContain('22/10/2026 → 28/10/2026')
  expect(hint).toMatch(/butoirs apéro 28\/10\/2026 \S+ \/ vendredi 28\/10\/2026/)
  expect(hint).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  unmount(comp)
})
