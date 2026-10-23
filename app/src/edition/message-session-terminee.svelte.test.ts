/**
 * #203 : l'écran « Session terminée » annonçait le bandeau « en tête de
 * page » (il est en bas), le citait même quand il n'était pas affiché
 * (`?maintenant=` fixé), et ne donnait aucune sortie vers le présent.
 */
import { flushSync, mount, unmount } from 'svelte'
import { expect, it } from 'vitest'
import { Session as SessionSchema } from '../domain/model'
import MessageSessionTerminee from './MessageSessionTerminee.svelte'
import SessionComponent from './Session.svelte'

function texte(composant: never, props: Record<string, unknown>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const c = mount(composant, { target: container, props: props as never })
  flushSync()
  const t = container.textContent!.replace(/\s+/g, ' ')
  unmount(c)
  container.remove()
  return t
}

const message = (maintenantFixe: boolean, rejouerAffiche: boolean) =>
  texte(MessageSessionTerminee as never, { maintenantFixe, rejouerAffiche })

it('au présent, bandeau affiché : les deux sorties, sans emplacement annoncé', () => {
  const t = message(false, true)
  expect(t).toContain("Session terminée — aucun créneau à placer aujourd'hui.")
  expect(t).toContain('Pour re-simuler la session à sa date d\'origine, utilisez le bandeau « Rejouer à cette date ».')
  expect(t).toContain('Pour préparer une session à venir, donnez-lui de nouvelles dates (Début, Fin et butoirs) à l\'Étape 2b · Session.')
  expect(t).not.toContain('en tête de page')
})

it('date de référence fixée, bandeau masqué : il n\'est pas cité', () => {
  const t = message(true, false)
  expect(t).toContain('Session terminée — aucun créneau à placer à la date de référence.')
  expect(t).toContain('proposé à la date de référence fixée.')
  expect(t).not.toContain('Rejouer à cette date')
  expect(t).toContain('Pour préparer une session à venir')
})

it('étape 2b : la raison « session terminée » donne la sortie vers le présent, sans emplacement', () => {
  const session = SessionSchema.parse({ id: 's', nom: 'S', lieu_id: 'l', date_debut: '2026-08-24', date_fin: '2026-08-28', date_butoir: '2026-08-28' })
  const t = texte(SessionComponent as never, {
    session, nbCreneaux: 0, creneauxPasses: null,
    diagnostic: { configurable: false, nb_creneaux: 0, defauts_regles: [], defauts_globaux: ['session-terminee'] },
    onAjouterRegle: () => {}, onSupprimerRegle: () => {}, onInvalider: () => {},
  })
  expect(t).toContain('la session est terminée (date de fin dans le passé) — changez ses dates ci-dessous pour une session à venir')
  expect(t).not.toContain('en tête de page')
})
