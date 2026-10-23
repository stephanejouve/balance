/**
 * #202 : les compteurs que nos fixtures n'avaient jamais poussés à 0 ni à 1.
 * Relevé du smoke de #199 : l'en-tête disait « 0 créneau », le récapitulatif
 * 2B « 0 créneaux générés » sur le même écran.
 */
import { flushSync, mount, unmount } from 'svelte'
import { expect, it } from 'vitest'
import { Session as SessionSchema } from '../domain/model'
import { extraireListe, MAPPING_LISTE_DEFAUT } from '../io/liste-adapter'
import BilanRepartition from '../vues/BilanRepartition.svelte'
import SessionComponent from './Session.svelte'

function texte(composant: never, props: Record<string, unknown>, selecteur?: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const c = mount(composant, { target: container, props: props as never })
  flushSync()
  const el = selecteur ? container.querySelector(selecteur)! : container
  const t = el.textContent!.replace(/\s+/g, ' ')
  unmount(c)
  container.remove()
  return t
}

function recapSession(nbCreneaux: number) {
  const session = SessionSchema.parse({ id: 's', nom: 'S', lieu_id: 'l', date_debut: '2026-10-22', date_fin: '2026-10-28', date_butoir: '2026-10-28' })
  return texte(SessionComponent as never, {
    session, nbCreneaux, creneauxPasses: null,
    onAjouterRegle: () => {}, onSupprimerRegle: () => {}, onInvalider: () => {},
  }, 'summary .hint')
}

it('récapitulatif 2B : « 0 créneau généré », « 1 créneau généré », « 50 créneaux générés »', () => {
  expect(recapSession(0)).toContain('0 créneau généré.')
  expect(recapSession(1)).toContain('1 créneau généré.')
  expect(recapSession(50)).toContain('50 créneaux générés.')
})

const bilan = {
  groupesComplets: 0, groupesTotal: 1, repetitionsPosees: 0, dureeMs: 3, essais: 1,
  problemes: 0, musiciensAuDelaSeuil: 0, seuilChargeJour: 4,
}

it('bloc de tête de l\'étape 3 : un seul groupe, zéro puis une répétition', () => {
  expect(texte(BilanRepartition as never, bilan)).toContain('0/1 groupe complet')
  expect(texte(BilanRepartition as never, bilan)).toContain('0 répétition posée')
  expect(texte(BilanRepartition as never, { ...bilan, groupesComplets: 1, repetitionsPosees: 1 })).toContain('1 répétition posée')
  expect(texte(BilanRepartition as never, { ...bilan, groupesTotal: 13, repetitionsPosees: 39 })).toContain('39 répétitions posées')
})

it('classeur vide : « 0 ligne », « 1 ligne »', () => {
  expect(extraireListe([], MAPPING_LISTE_DEFAUT).warnings[0]).toContain('(0 ligne,')
  expect(extraireListe([['Morceau']], { ...MAPPING_LISTE_DEFAUT, ligneEnTete: 1 }).warnings[0]).toContain('(1 ligne,')
})
