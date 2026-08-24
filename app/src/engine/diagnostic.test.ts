import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import { analyserInfaisabilite, diagnostiquer } from './diagnostic'

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
    grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }], // 3 créneaux
    repetitions_visees: 3,
  })
  const creneaux = genererCreneaux(session, lieu)
  return { session, lieu, creneaux }
}

describe('analyserInfaisabilite', () => {
  it('signale une personne qui aurait besoin de plus de créneaux que disponibles', () => {
    const { session, creneaux } = fixture()
    // Alice dans 2 groupes × 3 répés = 6 créneaux nécessaires, or 3 dispos
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice' },
        { id: 'bob', nom: 'Bob' },
        { id: 'carol', nom: 'Carol' },
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
            { personne_id: 'carol', pupitre: 'basse' },
          ],
        },
      ],
    })
    const diag = analyserInfaisabilite(session, insc, creneaux)
    const alice = diag.find((d) => d.personne_id === 'alice')
    expect(alice).toBeDefined()
    expect(alice!.demande).toBe(6)
    expect(alice!.offre).toBe(3)
  })

  it('ne signale rien quand tout tient', () => {
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'alice', nom: 'Alice' }],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [{ personne_id: 'alice', pupitre: 'chant' }],
        },
      ],
    })
    expect(analyserInfaisabilite(session, insc, creneaux)).toEqual([])
  })

  it('inclut les séances des imposés dans la demande', () => {
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'alice', nom: 'Alice' }],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [{ personne_id: 'alice', pupitre: 'chant' }],
        },
      ],
      imposes: [
        {
          id: 'i1',
          morceau: 'X',
          membres: ['alice'],
          seances: [
            { date: '2026-08-23', debut: '14:00', fin: '15:00' },
            { date: '2026-08-24', debut: '14:00', fin: '15:00' },
            { date: '2026-08-25', debut: '14:00', fin: '15:00' },
          ],
        },
      ],
    })
    // 1 groupe × 3 + 3 imposés = 6 nécessaires, 3 disponibles (une séance sur le jour de la
    // session bloque un créneau supplémentaire côté offre)
    const diag = analyserInfaisabilite(session, insc, creneaux)
    expect(diag[0].detail.seances_imposees).toBe(3)
  })
})

describe('diagnostiquer', () => {
  it('explique pourquoi un groupe est incomplet (partages + poids musicien)', () => {
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice' },
        { id: 'bob', nom: 'Bob' },
      ],
      groupes: [
        {
          id: 'g1',
          titre: 'Groupe 1',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'bob', pupitre: 'piano' },
          ],
        },
        {
          id: 'g2',
          titre: 'Groupe 2',
          membres: [{ personne_id: 'alice', pupitre: 'chant' }],
        },
      ],
    })
    // Placement volontairement incomplet
    const placement = [{ groupe_id: 'g1', creneau_id: creneaux[0].id }]
    const diag = diagnostiquer(session, insc, creneaux, placement)
    const g1 = diag.find((d) => d.groupe_id === 'g1')!
    expect(g1.obtenu).toBe(1)
    expect(g1.cible).toBe(3)
    expect(g1.partages.some((p) => p.groupe_id === 'g2')).toBe(true)
    expect(g1.poids_musicien?.nom).toMatch(/Alice|Bob/)
  })
})
