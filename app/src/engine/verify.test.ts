import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import type { Assignation } from './types'
import { couverture, verifier } from './verify'

/**
 * Fixture minimale pour les tests de vérification. Deux groupes avec un
 * musicien en commun (Alice) pour tester la collision.
 */
function buildFixture() {
  const lieu = Lieu.parse({
    id: 'lieu',
    nom: 'Lieu',
    salles: [
      { id: 'A', nom: 'A', jauge: 3 },
      { id: 'B', nom: 'B', jauge: 8 },
    ],
  })
  const session = Session.parse({
    id: 's',
    nom: 'S',
    lieu_id: 'lieu',
    date_debut: '2026-08-24',
    date_fin: '2026-08-25',
    date_butoir: '2026-08-25',
    butoir_heure: '20:00',
    grille: [{ debut: '09:00', fin: '11:00', pas_minutes: 60 }],
  })
  const inscriptions = Inscriptions.parse({
    session_id: 's',
    personnes: [
      { id: 'alice', nom: 'Alice', instruments: [{ pupitre: 'chant' }] },
      { id: 'bob', nom: 'Bob', instruments: [{ pupitre: 'piano' }] },
      { id: 'carol', nom: 'Carol', instruments: [{ pupitre: 'batterie' }] },
      {
        id: 'dan',
        nom: 'Dan',
        instruments: [{ pupitre: 'chant' }],
        indispos: [{ debut: '09:00', fin: '10:00', roles: ['chant'] }],
      },
    ],
    groupes: [
      {
        id: 'g1',
        titre: 'G1',
        membres: [
          { personne_id: 'alice', pupitre: 'chant' },
          { personne_id: 'bob', pupitre: 'piano' },
        ],
      },
      {
        id: 'g2',
        titre: 'G2',
        membres: [
          { personne_id: 'alice', pupitre: 'chant' },
          { personne_id: 'carol', pupitre: 'batterie' },
        ],
      },
      {
        id: 'g3',
        titre: 'G3',
        membres: [{ personne_id: 'dan', pupitre: 'chant' }],
      },
    ],
  })
  const creneaux = genererCreneaux(session, lieu)
  return { lieu, session, inscriptions, creneaux }
}

describe('verifier', () => {
  it('ne signale rien sur une solution valide', () => {
    const { lieu, session, inscriptions, creneaux } = buildFixture()
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'B' },
      { groupe_id: 'g2', creneau_id: creneaux[1].id, salle_id: 'B' },
    ]
    expect(verifier(session, lieu, inscriptions, creneaux, assignations)).toEqual([])
  })

  it('détecte Alice bookée en double sur le même créneau', () => {
    const { lieu, session, inscriptions, creneaux } = buildFixture()
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
      { groupe_id: 'g2', creneau_id: creneaux[0].id, salle_id: 'B' },
    ]
    const pb = verifier(session, lieu, inscriptions, creneaux, assignations)
    expect(pb.some((p) => p.type === 'personne-double-bookee' && p.personne_id === 'alice')).toBe(
      true,
    )
  })

  it('détecte une salle prise en double au même créneau', () => {
    const { lieu, session, inscriptions, creneaux } = buildFixture()
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
      { groupe_id: 'g3', creneau_id: creneaux[0].id, salle_id: 'A' },
    ]
    const pb = verifier(session, lieu, inscriptions, creneaux, assignations)
    expect(pb.some((p) => p.type === 'salle-double-bookee' && p.salle_id === 'A')).toBe(true)
  })

  it('détecte une jauge dépassée', () => {
    const { lieu, session, inscriptions, creneaux } = buildFixture()
    // g1 = 2 musiciens dans salle A (jauge 3) → OK
    // Créons un groupe volumineux
    const insc = Inscriptions.parse({
      ...inscriptions,
      groupes: [
        ...inscriptions.groupes,
        {
          id: 'big',
          titre: 'Big',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'bob', pupitre: 'piano' },
            { personne_id: 'carol', pupitre: 'batterie' },
            { personne_id: 'dan', pupitre: 'chant' },
          ],
        },
      ],
    })
    const assignations: Assignation[] = [
      { groupe_id: 'big', creneau_id: creneaux[0].id, salle_id: 'A' },
    ]
    const pb = verifier(session, lieu, insc, creneaux, assignations)
    expect(pb.some((p) => p.type === 'jauge-depassee')).toBe(true)
  })

  it("détecte l'indispo par rôle (Dan chant 9h) mais pas hors rôle", () => {
    const { lieu, session, inscriptions, creneaux } = buildFixture()
    const assignations: Assignation[] = [
      { groupe_id: 'g3', creneau_id: creneaux[0].id, salle_id: 'A' },
    ]
    const pb = verifier(session, lieu, inscriptions, creneaux, assignations)
    expect(pb.some((p) => p.type === 'personne-indispo' && p.personne_id === 'dan')).toBe(true)
    // Deuxième créneau = 10h → Dan disponible
    const assignations2: Assignation[] = [
      { groupe_id: 'g3', creneau_id: creneaux[1].id, salle_id: 'A' },
    ]
    expect(verifier(session, lieu, inscriptions, creneaux, assignations2)).toEqual([])
  })

  it('détecte deux créneaux consécutifs pour un même groupe', () => {
    const { lieu, session, inscriptions, creneaux } = buildFixture()
    // creneaux[0] = 09:00-10:00, creneaux[1] = 10:00-11:00 → consécutifs
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
      { groupe_id: 'g1', creneau_id: creneaux[1].id, salle_id: 'A' },
    ]
    const pb = verifier(session, lieu, inscriptions, creneaux, assignations)
    expect(pb.some((p) => p.type === 'creneaux-consecutifs' && p.groupe_id === 'g1')).toBe(true)
  })

  it('détecte une salle utilisée hors des salles ouvertes sur le créneau', () => {
    const { lieu, session, inscriptions, creneaux } = buildFixture()
    // creneaux[0] a salles ['A', 'B'] — tentons 'C' inconnue
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'C' },
    ]
    const pb = verifier(session, lieu, inscriptions, creneaux, assignations)
    expect(pb.some((p) => p.type === 'salle-hors-creneau' && p.salle_id === 'C')).toBe(true)
  })
})

describe('couverture', () => {
  it('compte les répétitions obtenues par groupe', () => {
    const { session, inscriptions, creneaux } = buildFixture()
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
      { groupe_id: 'g1', creneau_id: creneaux[1].id, salle_id: 'B' },
    ]
    const cov = couverture(session, inscriptions, assignations)
    const g1 = cov.find((c) => c.groupe_id === 'g1')
    expect(g1?.obtenu).toBe(2)
    expect(g1?.cible).toBe(3)
    expect(g1?.min).toBe(2)
  })
})
