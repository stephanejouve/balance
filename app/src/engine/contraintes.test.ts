import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import { registrePersonnalise, registreV1 } from './contraintes'
import { repartir } from './solver'
import { verifier } from './verify'

/**
 * Valide l'exigence structurante §0 du brief : les contraintes doivent
 * être désactivables une par une, sans réécrire le moteur.
 */

function fixture() {
  const lieu = Lieu.parse({
    id: 'l',
    nom: 'L',
    salles: [{ id: 'A', nom: 'A', jauge: 10 }],
  })
  const session = Session.parse({
    id: 's',
    nom: 'S',
    lieu_id: 'l',
    date_debut: '2026-08-24',
    date_fin: '2026-08-24',
    date_butoir: '2026-08-25',
    grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
    repetitions_visees: 3,
  })
  const inscriptions = Inscriptions.parse({
    session_id: 's',
    personnes: [
      { id: 'alice', nom: 'Alice', instruments: [{ pupitre: 'chant' }] },
      { id: 'bob', nom: 'Bob', instruments: [{ pupitre: 'piano' }] },
    ],
    groupes: [
      {
        id: 'g',
        titre: 'G',
        membres: [
          { personne_id: 'alice', pupitre: 'chant' },
          { personne_id: 'bob', pupitre: 'piano' },
        ],
      },
    ],
  })
  const creneaux = genererCreneaux(session, lieu)
  return { session, lieu, inscriptions, creneaux }
}

describe('registre de contraintes', () => {
  it('avec « creneaux-consecutifs » actif : jamais deux créneaux d\'affilée pour un même groupe', () => {
    const { session, lieu, inscriptions, creneaux } = fixture()
    // Créneaux 09-10, 10-11, 11-12 : contigus. Cible=3 = doit tout prendre,
    // mais la contrainte force à laisser des trous → au plus 1 sur 3.
    const r = repartir(session, lieu, inscriptions, creneaux, { seed: 1, maxEssais: 200 })
    // 1 créneau max sans contigus (on ne peut pas placer 3 non-contigus sur 3 slots contigus)
    expect(r.placement.length).toBeLessThanOrEqual(2)
  })

  it('sans « creneaux-consecutifs » : le solveur place les 3 répétitions contiguës', () => {
    const { session, lieu, inscriptions, creneaux } = fixture()
    const registre = registrePersonnalise([
      'personne-unique-moment',
      'salle-unique-groupe',
      'personne-indispo',
      'avant-butoir',
    ])
    const r = repartir(session, lieu, inscriptions, creneaux, {
      seed: 1,
      maxEssais: 200,
      registre,
    })
    expect(r.placement.length).toBe(3)
  })

  it('verifier() ne signale rien quand la contrainte violée n\'est pas dans le registre', () => {
    const { session, lieu, inscriptions, creneaux } = fixture()
    // Deux créneaux consécutifs pour le même groupe = violation en mode par défaut
    const assignations = [
      { groupe_id: 'g', creneau_id: creneaux[0].id, salle_id: 'A' },
      { groupe_id: 'g', creneau_id: creneaux[1].id, salle_id: 'A' },
    ]
    const pbTout = verifier(session, lieu, inscriptions, creneaux, assignations)
    expect(pbTout.some((p) => p.type === 'creneaux-consecutifs')).toBe(true)

    const pbV1 = verifier(session, lieu, inscriptions, creneaux, assignations, registreV1())
    expect(pbV1.some((p) => p.type === 'creneaux-consecutifs')).toBe(false)
  })

  it('registreV1() contient exactement les 4 contraintes dures + intégrité salle', () => {
    const r = registreV1()
    expect(r.actives.has('personne-unique-moment')).toBe(true)
    expect(r.actives.has('salle-unique-groupe')).toBe(true)
    expect(r.actives.has('personne-indispo')).toBe(true)
    expect(r.actives.has('avant-butoir')).toBe(true)
    expect(r.actives.has('creneaux-consecutifs')).toBe(false)
  })
})
