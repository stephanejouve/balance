/**
 * #182 (lecture Junior + Leader, sonde Leader 2026-10-22) : « Capacité du
 * stage » et « Contrôle en amont » comptaient tous les créneaux du présent,
 * butoir compris. L'offre gonflée les rendait MUETS là où ils devaient
 * avertir : faux négatif sur deux blocs d'avertissement.
 *
 * Même univers que le solveur, Quotas, le diagnostic et l'en-tête :
 * créneaux strictement avant le butoir, par fenêtres emboîtées
 * (`fenetresDeButoir`).
 */
import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { parseLegacyInscriptions } from '../domain/legacy'
import { migrerInscriptions } from '../domain/migrate'
import { Inscriptions, Lieu, Session } from '../domain/model'
import fixture from '../fixtures/apero_mercredi.json'
import { analyserCapaciteStage, analyserInfaisabilite, capaciteEstEnAlerte } from './diagnostic'

const lieu = Lieu.parse({
  id: 'mf', nom: 'MF',
  salles: [
    { id: 'le-garage', nom: 'Le Garage', jauge: 10 },
    { id: 'xveme', nom: 'XVème', jauge: 10 },
    { id: 'les-clapiers', nom: 'Les Clapiers', jauge: 10 },
    { id: 'l-esperance', nom: "L'Espérance", jauge: 6 },
    { id: 'la-chenaie', nom: 'La Chênaie', jauge: 6 },
  ],
})
// La démo de l'App (session 5) : butoir apéro le 26/08 à 18:30.
const sessionDemo = (repetitions_visees: number) =>
  Session.parse({
    id: 'session-5', nom: 'Session 5', lieu_id: 'mf',
    date_debut: '2026-08-24', date_fin: '2026-08-28', date_butoir: '2026-08-26', butoir_heure: '18:30',
    grille: [
      { debut: '09:00', fin: '11:59', pas_minutes: 60 },
      { debut: '13:30', fin: '18:29', pas_minutes: 60 },
      { debut: '22:00', fin: '23:59', pas_minutes: 60 },
    ],
    repetitions_visees,
  })
const inscriptions = migrerInscriptions(parseLegacyInscriptions(fixture), 'session-5')

const creneauxA = (maintenant: string, repetitions: number) => {
  const session = sessionDemo(repetitions)
  return { session, creneaux: genererCreneaux(session, lieu, { maintenant: new Date(maintenant) }) }
}

describe('butoir passé (27/08 08:00) — les deux blocs doivent crier', () => {
  it('Capacité du stage : 0 place avant le butoir, plus 100 places du présent', () => {
    const { session, creneaux } = creneauxA('2026-08-27T08:00:00', 5)
    const cap = analyserCapaciteStage(session, inscriptions, creneaux)
    expect(cap).toEqual({
      demande_stage: 65,
      capacite_stage: 0,
      demande_depasse_capacite: true,
      butoir: { date: '2026-08-26', heure: '18:30' },
    })
    expect(capaciteEstEnAlerte(cap)).toBe(true)
  })

  it('Contrôle en amont : les 39 musiciens engagés sont sans créneau, et la cause est le calendrier (fenêtre vide)', () => {
    const { session, creneaux } = creneauxA('2026-08-27T08:00:00', 3)
    const inf = analyserInfaisabilite(session, inscriptions, creneaux)
    expect(inf).toHaveLength(39)
    for (const d of inf) {
      expect(d.type).toBe('exclusion')
      expect(d.offre).toBe(0)
      expect(d.detail.creneaux_total).toBe(0)
      expect(d.detail.butoir).toEqual({ date: '2026-08-26', heure: '18:30' })
    }
  })
})

describe('session en cours (24/08 08:00) — rien de pathologique, des signaux masqués', () => {
  it('8 répétitions visées : 4 surcharges, comptées sur les 28 créneaux avant butoir', () => {
    const { session, creneaux } = creneauxA('2026-08-24T08:00:00', 8)
    const inf = analyserInfaisabilite(session, inscriptions, creneaux)
    expect(inf.filter((d) => d.type === 'surcharge')).toHaveLength(4)
    for (const d of inf) expect(d.detail.creneaux_total).toBe(28)
  })

  it('12 répétitions visées : 156 séances pour 140 places réelles, pas 156/250', () => {
    const { session, creneaux } = creneauxA('2026-08-24T08:00:00', 12)
    const cap = analyserCapaciteStage(session, inscriptions, creneaux)
    expect(cap.demande_stage).toBe(156)
    expect(cap.capacite_stage).toBe(140)
    expect(cap.demande_depasse_capacite).toBe(true)
  })
})

describe('fenêtres emboîtées — échéances mélangées', () => {
  // 1 salle, 4 créneaux le 24 (9h-12h59) ; butoir apéro le 24 à 11:00 (2
  // créneaux avant), butoir vendredi le 25 (les 4).
  const lieu1 = Lieu.parse({ id: 'l', nom: 'L', salles: [{ id: 'A', nom: 'A', jauge: 10 }] })
  const session = Session.parse({
    id: 's', nom: 'S', lieu_id: 'l',
    date_debut: '2026-08-24', date_fin: '2026-08-24',
    butoir_apero_date: '2026-08-24', butoir_apero_heure: '11:00',
    butoir_vendredi_date: '2026-08-25', butoir_vendredi_heure: '18:00',
    grille: [{ debut: '09:00', fin: '12:59', pas_minutes: 60 }],
    repetitions_visees: 2,
  })
  const creneaux = genererCreneaux(session, lieu1, { maintenant: new Date('2026-08-24T00:00:00') })
  const insc = (echeances: Array<'apero_mercredi' | 'restitution_vendredi'>) =>
    Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A', instruments: [{ pupitre: 'chant' }] }],
      groupes: echeances.map((echeance, i) => ({ id: `g${i}`, titre: `G${i}`, echeance, membres: [{ personne_id: 'a', pupitre: 'chant' }] })),
    })

  it('la fenêtre la plus tendue est retenue : 2 apéro dans 2 créneaux passent, 2 apéro + 1 vendredi dans 4 passent aussi', () => {
    expect(creneaux).toHaveLength(4)
    expect(analyserInfaisabilite(session, insc(['apero_mercredi', 'restitution_vendredi']), creneaux)).toEqual([])
  })

  it('deux groupes apéro pour une personne : 4 demandés dans la fenêtre apéro de 2 — signalé, butoir apéro nommé', () => {
    const [d] = analyserInfaisabilite(session, insc(['apero_mercredi', 'apero_mercredi']), creneaux)
    expect(d).toMatchObject({ demande: 4, offre: 2, type: 'surcharge' })
    expect(d.detail).toMatchObject({ groupes: 2, creneaux_total: 2, butoir: { date: '2026-08-24', heure: '11:00' } })
  })

  it('Capacité du stage : la fenêtre apéro (2 places pour 4) prime sur la fenêtre vendredi (4 places pour 4)', () => {
    const cap = analyserCapaciteStage(session, insc(['apero_mercredi', 'apero_mercredi']), creneaux)
    expect(cap).toMatchObject({ demande_stage: 4, capacite_stage: 2, butoir: { date: '2026-08-24', heure: '11:00' } })
  })
})
