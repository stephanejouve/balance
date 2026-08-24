import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import type { Assignation } from './types'
import { suggererRenforts } from './renforts'

describe('suggererRenforts', () => {
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
    date_fin: '2026-08-25',
    date_butoir: '2026-08-26',
    grille: [{ debut: '09:00', fin: '11:00', pas_minutes: 60 }],
  })
  const creneaux = genererCreneaux(session, lieu)

  const inscBase = Inscriptions.parse({
    session_id: 's',
    personnes: [
      { id: 'alice', nom: 'Alice', instruments: [{ pupitre: 'chant' }] },
      { id: 'bob', nom: 'Bob', instruments: [{ pupitre: 'guitare' }] },
      { id: 'carol', nom: 'Carol', instruments: [{ pupitre: 'guitare' }] },
      { id: 'dan', nom: 'Dan', instruments: [{ pupitre: 'guitare' }] },
    ],
    groupes: [
      {
        id: 'g1',
        titre: 'G1',
        membres: [{ personne_id: 'alice', pupitre: 'chant' }],
        postes_cherches: ['guitare'],
      },
    ],
  })

  it('suggère les guitaristes libres sur les créneaux du groupe', () => {
    const ass: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
    ]
    const sug = suggererRenforts(inscBase.groupes[0], inscBase, creneaux, ass)
    expect(sug.map((s) => s.personne_id).sort()).toEqual(['bob', 'carol', 'dan'])
    expect(sug[0].creneaux_compatibles).toBe(1)
  })

  it("exclut un guitariste déjà bookée sur ce créneau par un autre groupe", () => {
    const insc2 = Inscriptions.parse({
      ...inscBase,
      groupes: [
        ...inscBase.groupes,
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'bob', pupitre: 'guitare' }] },
      ],
    })
    const ass: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
      { groupe_id: 'g2', creneau_id: creneaux[0].id, salle_id: 'A' },
    ]
    const sug = suggererRenforts(insc2.groupes[0], insc2, creneaux, ass)
    expect(sug.map((s) => s.personne_id)).not.toContain('bob')
    expect(sug.map((s) => s.personne_id)).toContain('carol')
  })

  it("renvoie vide si le groupe ne cherche personne", () => {
    const insc2 = Inscriptions.parse({
      ...inscBase,
      groupes: [{ ...inscBase.groupes[0], postes_cherches: [] }],
    })
    expect(suggererRenforts(insc2.groupes[0], insc2, creneaux, [])).toEqual([])
  })

  it("écarte les personnes indisponibles sur tous les créneaux du groupe", () => {
    const insc2 = Inscriptions.parse({
      ...inscBase,
      personnes: [
        ...inscBase.personnes.filter((p) => p.id !== 'bob'),
        {
          id: 'bob',
          nom: 'Bob',
          instruments: [{ pupitre: 'guitare' }],
          indispos: [{ debut: '09:00' }],
        },
      ],
    })
    const ass: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
    ]
    const sug = suggererRenforts(insc2.groupes[0], insc2, creneaux, ass)
    expect(sug.map((s) => s.personne_id)).not.toContain('bob')
  })
})
