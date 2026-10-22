/**
 * #177 + #147 (smoke CD 2026-10-22, lecture Leader) : le diagnostic
 * « Pourquoi ça bloque » et l'en-tête comptaient tous les créneaux du
 * présent, butoir compris. Démo avec maintenant au 27/08, butoir apéro le
 * 26 à 18:30 : l'en-tête annonçait « 19 créneaux avant butoir », le bloc
 * « 19 créneaux ouverts et de la place en salle : ce n'est pas la capacité
 * qui bloque » puis les musiciens en commun — alors que Quotas disait, à
 * juste titre, « plus aucun créneau avant le butoir ».
 *
 * Même univers que le solveur (`solver.ts::estLibre`) : créneaux strictement
 * avant le butoir de l'échéance du groupe.
 */
import { describe, expect, it } from 'vitest'
import { creneauxAvantButoir, genererCreneaux } from '../domain/grille'
import { parseLegacyInscriptions } from '../domain/legacy'
import { migrerInscriptions } from '../domain/migrate'
import { Lieu, Session } from '../domain/model'
import fixture from '../fixtures/apero_mercredi.json'
import { diagnostiquer } from './diagnostic'
import { analyseQuotas } from './quotas'
import { repartir } from './solver'

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
const session = Session.parse({
  id: 'session-5', nom: 'Session 5', lieu_id: 'mf',
  date_debut: '2026-08-24', date_fin: '2026-08-28', date_butoir: '2026-08-26', butoir_heure: '18:30',
  grille: [
    { debut: '09:00', fin: '11:59', pas_minutes: 60 },
    { debut: '13:30', fin: '18:29', pas_minutes: 60 },
    { debut: '22:00', fin: '23:59', pas_minutes: 60 },
  ],
  repetitions_visees: 3,
})
const inscriptions = migrerInscriptions(parseLegacyInscriptions(fixture), 'session-5')

describe('butoir passé (maintenant 27/08) — le relevé du smoke CD', () => {
  const creneaux = genererCreneaux(session, lieu, { maintenant: new Date('2026-08-27T08:00:00') })

  it('l\'état du relevé : des créneaux restent au présent, mais aucun avant le butoir apéro', () => {
    expect(creneaux.length).toBeGreaterThan(0)
    expect(creneauxAvantButoir(session, 'apero_mercredi', creneaux)).toEqual([])
  })

  it('en-tête (#147) : le nombre annoncé « avant butoir » est 0, pas le total du présent', () => {
    // App.svelte : nbCreneauxAvantButoirApero = creneauxAvantButoir(…).length
    expect(creneauxAvantButoir(session, 'apero_mercredi', creneaux).length).toBe(0)
  })

  it('diagnostic (#177) : 0 créneau avant butoir et 0 ouvert, le butoir est porté pour l\'écran', () => {
    const { placement } = repartir(session, lieu, inscriptions, creneaux, { seed: 1, maxEssais: 5 })
    const diags = diagnostiquer(session, inscriptions, creneaux, placement)
    expect(diags.length).toBe(inscriptions.groupes.length)
    for (const d of diags) {
      expect(d.creneaux_avant_butoir).toBe(0)
      expect(d.creneaux_ouverts).toBe(0)
      expect(d.butoir).toEqual({ date: '2026-08-26', heure: '18:30' })
    }
  })

  it('les trois sites racontent la même histoire : Quotas dit aussi « plus aucun créneau avant le butoir »', () => {
    const quotas = analyseQuotas(session, inscriptions, creneaux)
    expect(quotas.every((q) => q.capacite === 0)).toBe(true)
    expect(quotas.some((q) => q.capacite_nulle === 'aucun-creneau')).toBe(true)
  })
})

describe('session en cours (maintenant 24/08 8h) — non-régression', () => {
  const creneaux = genererCreneaux(session, lieu, { maintenant: new Date('2026-08-24T08:00:00') })

  it('l\'en-tête ne compte plus les créneaux après le butoir : 28 avant butoir sur 50 au total (#147, « 50 annoncés pour 28 »)', () => {
    expect(creneaux.length).toBe(50)
    expect(creneauxAvantButoir(session, 'apero_mercredi', creneaux).length).toBe(28)
  })

  it('diagnostic : ouverts ≤ avant butoir < total, pour chaque groupe incomplet', () => {
    const { placement } = repartir(session, lieu, inscriptions, creneaux.slice(0, 6), { seed: 1, maxEssais: 3 })
    const diags = diagnostiquer(session, inscriptions, creneaux, placement)
    expect(diags.length).toBeGreaterThan(0)
    for (const d of diags) {
      expect(d.creneaux_avant_butoir).toBe(28)
      expect(d.creneaux_ouverts).toBeLessThanOrEqual(d.creneaux_avant_butoir)
    }
  })
})
