import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import { attribuerSalles } from './allocate-rooms'
import { repartir } from './solver'
import { verifier } from './verify'

function fixtureSimple() {
  const lieu = Lieu.parse({
    id: 'lieu',
    nom: 'Lieu',
    salles: [
      { id: 'A', nom: 'A', jauge: 10 },
      { id: 'B', nom: 'B', jauge: 6 },
    ],
  })
  const session = Session.parse({
    id: 's',
    nom: 'S',
    lieu_id: 'lieu',
    date_debut: '2026-08-24',
    date_fin: '2026-08-27',
    date_butoir: '2026-08-27',
    butoir_heure: '20:00',
    grille: [
      { debut: '09:00', fin: '12:00', pas_minutes: 60 },
      { debut: '14:00', fin: '18:00', pas_minutes: 60 },
    ],
    repetitions_visees: 3,
    repetitions_min: 2,
  })
  const inscriptions = Inscriptions.parse({
    session_id: 's',
    personnes: [
      { id: 'alice', nom: 'Alice', instruments: [{ pupitre: 'chant' }] },
      { id: 'bob', nom: 'Bob', instruments: [{ pupitre: 'piano' }] },
      { id: 'carol', nom: 'Carol', instruments: [{ pupitre: 'batterie' }] },
      { id: 'dan', nom: 'Dan', instruments: [{ pupitre: 'guitare' }] },
      { id: 'eve', nom: 'Eve', instruments: [{ pupitre: 'basse' }] },
    ],
    groupes: [
      {
        id: 'g1',
        titre: 'G1',
        membres: [
          { personne_id: 'alice', pupitre: 'chant' },
          { personne_id: 'bob', pupitre: 'piano' },
          { personne_id: 'carol', pupitre: 'batterie' },
        ],
      },
      {
        id: 'g2',
        titre: 'G2',
        membres: [
          { personne_id: 'dan', pupitre: 'guitare' },
          { personne_id: 'eve', pupitre: 'basse' },
          { personne_id: 'carol', pupitre: 'batterie' }, // conflit avec g1
        ],
      },
      {
        id: 'g3',
        titre: 'G3',
        membres: [
          { personne_id: 'alice', pupitre: 'chant' },
          { personne_id: 'dan', pupitre: 'guitare' },
        ],
      },
    ],
  })
  const creneaux = genererCreneaux(session, lieu)
  return { lieu, session, inscriptions, creneaux }
}

describe('repartir', () => {
  it('place 3 répétitions × 3 groupes sans conflit', () => {
    const { lieu, session, inscriptions, creneaux } = fixtureSimple()
    const res = repartir(session, lieu, inscriptions, creneaux, { seed: 42 })
    expect(res.groupes_complets).toBe(3)
    expect(res.places_totales).toBe(9)
  })

  it('reproductible avec le même seed', () => {
    const { lieu, session, inscriptions, creneaux } = fixtureSimple()
    const r1 = repartir(session, lieu, inscriptions, creneaux, { seed: 123 })
    const r2 = repartir(session, lieu, inscriptions, creneaux, { seed: 123 })
    expect(r1.placement).toEqual(r2.placement)
  })

  it('respecte les indispos ciblées par rôle', () => {
    const { lieu, session, inscriptions, creneaux } = fixtureSimple()
    // Alice indispo en chant de 9h à 10h : g1 et g3 ne peuvent pas y être à 9h
    const inscMod = Inscriptions.parse({
      ...inscriptions,
      personnes: inscriptions.personnes.map((p) =>
        p.id === 'alice'
          ? { ...p, indispos: [{ debut: '09:00', fin: '10:00', roles: ['chant'] }] }
          : p,
      ),
    })
    const res = repartir(session, lieu, inscMod, creneaux, { seed: 5 })
    const creneaux9h = creneaux.filter((c) => c.debut === '09:00').map((c) => c.id)
    const g1_9h = res.placement.filter(
      (p) => p.groupe_id === 'g1' && creneaux9h.includes(p.creneau_id),
    )
    const g3_9h = res.placement.filter(
      (p) => p.groupe_id === 'g3' && creneaux9h.includes(p.creneau_id),
    )
    expect(g1_9h.length).toBe(0)
    expect(g3_9h.length).toBe(0)
  })
})

describe('attribuerSalles + verifier (intégration)', () => {
  it("le pipeline complet ne produit aucun problème sur la fixture simple", () => {
    const { lieu, session, inscriptions, creneaux } = fixtureSimple()
    const { placement } = repartir(session, lieu, inscriptions, creneaux, { seed: 7 })
    const assignations = attribuerSalles(placement, lieu, inscriptions, creneaux)
    const problemes = verifier(session, lieu, inscriptions, creneaux, assignations)
    expect(problemes).toEqual([])
  })

  it("évite deux fois la même salle pour un même groupe quand c'est possible", () => {
    const { lieu, session, inscriptions, creneaux } = fixtureSimple()
    const { placement } = repartir(session, lieu, inscriptions, creneaux, { seed: 2 })
    const assignations = attribuerSalles(placement, lieu, inscriptions, creneaux)
    const parGroupe = new Map<string, string[]>()
    for (const a of assignations) {
      if (!parGroupe.has(a.groupe_id)) parGroupe.set(a.groupe_id, [])
      parGroupe.get(a.groupe_id)!.push(a.salle_id)
    }
    // 2 salles et 3 répétitions par groupe : au moins une réutilisation forcée,
    // mais pas 3 fois la même salle (test faible mais garde-fou).
    for (const salles of parGroupe.values()) {
      const compte = new Map<string, number>()
      salles.forEach((s) => compte.set(s, (compte.get(s) ?? 0) + 1))
      const max = Math.max(...compte.values())
      expect(max).toBeLessThanOrEqual(2)
    }
  })
})
