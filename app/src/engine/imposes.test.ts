import { describe, expect, it } from 'vitest'
import { Inscriptions } from '../domain/model'
import { enrichirIndispos } from './imposes'

describe('enrichirIndispos', () => {
  it("ajoute une Indispo sur chaque membre pour chaque séance d'un imposé", () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice', instruments: [{ pupitre: 'chant' }] },
        { id: 'bob', nom: 'Bob', instruments: [{ pupitre: 'piano' }] },
        { id: 'charlie', nom: 'Charlie', instruments: [{ pupitre: 'basse' }] },
      ],
      groupes: [],
      imposes: [
        {
          id: 'lady-bird',
          morceau: 'Lady Bird',
          membres: ['alice', 'bob'],
          seances: [
            { date: '2026-08-23', debut: '14:30', fin: '16:00' },
            { date: '2026-08-25', debut: '16:30', fin: '18:00' },
          ],
        },
      ],
    })
    const enrichie = enrichirIndispos(insc)
    const alice = enrichie.personnes.find((p) => p.id === 'alice')!
    expect(alice.indispos.length).toBe(2)
    expect(alice.indispos[0].jours).toEqual(['2026-08-23'])
    expect(alice.indispos[0].debut).toBe('14:30')
    expect(alice.indispos[0].fin).toBe('16:00')
    expect(alice.indispos[0].motif).toContain('Lady Bird')
    const charlie = enrichie.personnes.find((p) => p.id === 'charlie')!
    expect(charlie.indispos.length).toBe(0)
  })

  it("préserve les indispos existantes et ne mute pas l'entrée", () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        {
          id: 'alice',
          nom: 'Alice',
          instruments: [{ pupitre: 'chant' }],
          indispos: [{ debut: '09:00', roles: ['chant'] }],
        },
      ],
      groupes: [],
      imposes: [
        {
          id: 'x',
          morceau: 'X',
          membres: ['alice'],
          seances: [{ date: '2026-08-25', debut: '14:00', fin: '15:00' }],
        },
      ],
    })
    const enrichie = enrichirIndispos(insc)
    expect(enrichie.personnes[0].indispos.length).toBe(2)
    expect(insc.personnes[0].indispos.length).toBe(1) // pas muté
  })

  it('renvoie tel quel si aucun imposé', () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [],
    })
    expect(enrichirIndispos(insc)).toBe(insc)
  })
})
