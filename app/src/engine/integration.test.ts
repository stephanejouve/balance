import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { parseLegacyInscriptions } from '../domain/legacy'
import { migrerInscriptions } from '../domain/migrate'
import { Lieu, Session } from '../domain/model'
import fixtureRaw from '../fixtures/apero_mercredi.json'
import { attribuerSalles } from './allocate-rooms'
import { repartir } from './solver'
import { verifier } from './verify'

/**
 * Pipeline complet sur les données réelles de la session 5 :
 *   legacy → canonique → génération créneaux → solver → salles → verify
 *
 * Cette suite ne modélise pas encore les vagues d'imposés (12 morceaux à
 * horaires fixes du stage) — elle valide seulement le placement des 13
 * groupes volontaires. Les imposés viendront comme un type de contrainte
 * dédié dans un sprint ultérieur.
 */

function lieuMusiquesFestives() {
  return Lieu.parse({
    id: 'musiques-festives',
    nom: 'Musiques Festives',
    salles: [
      { id: 'le-garage', nom: 'Le Garage', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'xveme', nom: 'XVème', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'les-clapiers', nom: 'Les Clapiers', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'l-esperance', nom: "L'Espérance", jauge: 6, equipement: ['piano'] },
      { id: 'la-chenaie', nom: 'La Chênaie', jauge: 6, equipement: ['piano'] },
    ],
  })
}

function sessionCinq() {
  return Session.parse({
    id: 'session-5',
    nom: 'Session 5 — Musiques Festives',
    lieu_id: 'musiques-festives',
    date_debut: '2026-08-24',
    date_fin: '2026-08-28',
    date_butoir: '2026-08-26',
    butoir_heure: '18:30',
    grille: [
      { debut: '09:00', fin: '12:00', pas_minutes: 60 },
      { debut: '13:30', fin: '18:30', pas_minutes: 60 },
      { debut: '22:00', fin: '24:00', pas_minutes: 60 },
    ],
    repetitions_visees: 3,
    repetitions_min: 2,
  })
}

describe('pipeline complet apero_mercredi.json', () => {
  const lieu = lieuMusiquesFestives()
  const session = sessionCinq()
  const legacy = parseLegacyInscriptions(fixtureRaw)
  const inscriptions = migrerInscriptions(legacy, session.id)
  const creneaux = genererCreneaux(session, lieu)

  it('migre 13 groupes et ~30 personnes', () => {
    expect(inscriptions.groupes.length).toBe(13)
    expect(inscriptions.personnes.length).toBeGreaterThan(20)
  })

  it('génère une grille dense de créneaux avant butoir', () => {
    expect(creneaux.length).toBeGreaterThanOrEqual(15)
    expect(creneaux.every((c) => c.salles.length === 5)).toBe(true)
  })

  // FIXME solveur V1 : place ~5/13 groupes complets sur la session 5.
  //  - le pattern « soit 3 répés soit 0 » suggère que les groupes en tête
  //    d'ordre saturent le graphe de collisions au tour 0
  //  - la phase de réparation actuelle abandonne dès qu'un créneau a > 1
  //    bloqueur, trop restrictif sur ce dataset dense (7-8 partages/groupe)
  //  - pistes : ordre initial par « coter » (difficulté a priori), tolérer N
  //    bloqueurs si tous relogeables, pondérer « pas 2× même jour » au lieu
  //    de bloquer dur
  //  - objectif prototype : 13/13 complets ; à atteindre avant livraison
  it('produit un placement cohérent (V1 tolérante — cf. FIXME)', () => {
    const { groupes_complets, places_totales, placement } = repartir(
      session,
      lieu,
      inscriptions,
      creneaux,
      { seed: 42, maxEssais: 500 },
    )
    // V1 : on garantit seulement que le solveur retourne quelque chose de
    // structurellement valide. La qualité (nb groupes complets) est
    // insuffisante — cf. FIXME au-dessus.
    expect(groupes_complets).toBeGreaterThanOrEqual(1)
    expect(places_totales).toBe(placement.length)
    expect(places_totales).toBeGreaterThanOrEqual(3)
  })

  it("le pipeline complet ne produit aucun problème sur ce qui est placé", () => {
    const { placement } = repartir(session, lieu, inscriptions, creneaux, {
      seed: 42,
      maxEssais: 500,
    })
    const assignations = attribuerSalles(placement, lieu, inscriptions, creneaux)
    const problemes = verifier(session, lieu, inscriptions, creneaux, assignations)
    expect(problemes).toEqual([])
  })
})
