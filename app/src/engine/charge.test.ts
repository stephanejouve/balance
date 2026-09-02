import { describe, expect, it } from 'vitest'
import type { Creneau } from '../domain/grille'
import type { Inscriptions } from '../domain/model'
import { chargeParMusicien } from './charge'
import type { Assignation } from './types'

function insc(overrides: Partial<Inscriptions> = {}): Inscriptions {
  return {
    session_id: 's',
    personnes: [],
    groupes: [],
    imposes: [],
    ...overrides,
  }
}

function groupe(id: string, membres: string[]): Inscriptions['groupes'][number] {
  return {
    id,
    titre: id,
    auteur: '',
    style: '',
    tonalite: '',
    responsable_id: '',
    membres: membres.map((pid) => ({ personne_id: pid, pupitre: 'piano' })),
    postes_cherches: [],
    repetitions_deja_faites: 0,
  echeance: 'apero_mercredi',}
}

function creneau(id: string, date: string, debut = '09:00'): Creneau {
  return { id, date, debut, fin: '10:00', salles: ['s1'] }
}

describe('chargeParMusicien', () => {
  it('compte les répétitions par personne et par jour', () => {
    const insc1 = insc({ groupes: [groupe('g1', ['alice', 'bob'])] })
    const creneaux = [creneau('c1', '2026-08-28')]
    const assignations: Assignation[] = [{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 's1' }]

    const charge = chargeParMusicien(insc1, creneaux, assignations)
    expect(charge.get('alice')).toEqual({
      personne_id: 'alice',
      total: 1,
      max_jour: 1,
      par_jour: [{ date: '2026-08-28', n: 1 }],
    })
    expect(charge.get('bob')?.total).toBe(1)
  })

  it("cumule les répétitions du même jour dans max_jour", () => {
    const insc1 = insc({
      groupes: [groupe('g1', ['alice']), groupe('g2', ['alice'])],
    })
    const creneaux = [creneau('c1', '2026-08-28', '09:00'), creneau('c2', '2026-08-28', '14:00')]
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: 'c1', salle_id: 's1' },
      { groupe_id: 'g2', creneau_id: 'c2', salle_id: 's1' },
    ]

    const charge = chargeParMusicien(insc1, creneaux, assignations)
    expect(charge.get('alice')?.total).toBe(2)
    expect(charge.get('alice')?.max_jour).toBe(2)
  })

  it("répartit par jour dans par_jour, trié chronologiquement", () => {
    const insc1 = insc({ groupes: [groupe('g1', ['alice'])] })
    const creneaux = [
      creneau('c1', '2026-08-28'),
      creneau('c2', '2026-08-29'),
      creneau('c3', '2026-08-30'),
    ]
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: 'c2', salle_id: 's1' },
      { groupe_id: 'g1', creneau_id: 'c1', salle_id: 's1' },
      { groupe_id: 'g1', creneau_id: 'c3', salle_id: 's1' },
    ]
    const charge = chargeParMusicien(insc1, creneaux, assignations)
    expect(charge.get('alice')?.par_jour.map((d) => d.date)).toEqual([
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
    ])
  })

  it('inclut les séances des morceaux imposés dans la charge', () => {
    const insc1 = insc({
      groupes: [groupe('g1', ['alice'])],
      imposes: [
        {
          id: 'imp1',
          morceau: 'Concert vendredi',
          membres: ['alice'],
          seances: [
            { date: '2026-08-28', debut: '10:00', fin: '11:00' },
            { date: '2026-08-29', debut: '14:00', fin: '15:00' },
          ],
        },
      ],
    })
    const creneaux = [creneau('c1', '2026-08-28')]
    const assignations: Assignation[] = [{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 's1' }]

    const charge = chargeParMusicien(insc1, creneaux, assignations)
    // Alice : 1 répé groupe (08-28) + 2 séances imposées → 3 total
    // 08-28 : 2 (groupe + imposé), 08-29 : 1 (imposé seul)
    expect(charge.get('alice')?.total).toBe(3)
    expect(charge.get('alice')?.max_jour).toBe(2)
  })

  it('ignore les assignations pointant sur un créneau ou groupe inconnu', () => {
    const insc1 = insc({ groupes: [groupe('g1', ['alice'])] })
    const creneaux = [creneau('c1', '2026-08-28')]
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: 'c1', salle_id: 's1' },
      { groupe_id: 'inconnu', creneau_id: 'c1', salle_id: 's1' }, // groupe inconnu → ignoré
      { groupe_id: 'g1', creneau_id: 'inconnu', salle_id: 's1' }, // créneau inconnu → ignoré
    ]
    const charge = chargeParMusicien(insc1, creneaux, assignations)
    expect(charge.get('alice')?.total).toBe(1)
  })

  it("renvoie une map vide quand aucun musicien n'est engagé", () => {
    const insc1 = insc()
    const charge = chargeParMusicien(insc1, [], [])
    expect(charge.size).toBe(0)
  })

  it('dédoublonne les membres présents plusieurs fois dans le même groupe', () => {
    // Un musicien listé 2× dans le même groupe (2 pupitres) ne compte qu'1 fois
    const g: Inscriptions['groupes'][number] = {
      ...groupe('g1', []),
      membres: [
        { personne_id: 'prune', pupitre: 'piano' },
        { personne_id: 'prune', pupitre: 'basse' },
      ],
    }
    const insc1 = insc({ groupes: [g] })
    const creneaux = [creneau('c1', '2026-08-28')]
    const assignations: Assignation[] = [{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 's1' }]
    const charge = chargeParMusicien(insc1, creneaux, assignations)
    expect(charge.get('prune')?.total).toBe(1)
  })
})
