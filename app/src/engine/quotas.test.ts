import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import { analyseQuotas } from './quotas'

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
    date_fin: '2026-08-25',
    date_butoir: '2026-08-26',
    grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
    repetitions_visees: 3,
  })
  return { session, lieu, creneaux: genererCreneaux(session, lieu) }
}

describe('analyseQuotas', () => {
  it("compte musiciens et groupes par pupitre", () => {
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'A', instruments: [{ pupitre: 'chant' }] },
        { id: 'b', nom: 'B', instruments: [{ pupitre: 'batterie' }] },
        { id: 'c', nom: 'C', instruments: [{ pupitre: 'batterie' }] },
      ],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'chant' }, { personne_id: 'b', pupitre: 'batterie' }] },
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'a', pupitre: 'chant' }, { personne_id: 'c', pupitre: 'batterie' }] },
      ],
    })
    const q = analyseQuotas(session, insc, creneaux)
    const batterie = q.find((x) => x.pupitre === 'batterie')!
    expect(batterie.nb_musiciens).toBe(2)
    expect(batterie.nb_groupes_demandeurs).toBe(2)
    expect(batterie.demande).toBe(6) // 2 groupes × 3 répés
  })

  it("compte les postes_cherches comme demande", () => {
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [{ id: 'g1', titre: 'G1', membres: [], postes_cherches: ['guitare'] }],
    })
    const q = analyseQuotas(session, insc, creneaux)
    const guitare = q.find((x) => x.pupitre === 'guitare')
    expect(guitare?.nb_groupes_demandeurs).toBe(1)
  })

  it("simuler_delta calcule le nb de groupes serviables avec un ajout de musiciens", () => {
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'b', nom: 'B', instruments: [{ pupitre: 'batterie' }] }],
      groupes: [{ id: 'g1', titre: 'G1', membres: [{ personne_id: 'b', pupitre: 'batterie' }] }],
    })
    const q = analyseQuotas(session, insc, creneaux)
    const batterie = q.find((x) => x.pupitre === 'batterie')!
    // 1 batteur × 6 créneaux (2 jours × 3 tours) = 6 places / 3 répés = 2 groupes
    expect(batterie.simuler_delta(0)).toBe(2)
    // Avec 2 batteurs de plus (3 total) : 3 × 6 = 18 / 3 = 6 groupes
    expect(batterie.simuler_delta(2)).toBe(6)
  })

  it('trie par ratio de saturation décroissant', () => {
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'A', instruments: [{ pupitre: 'batterie' }] },
        { id: 'b', nom: 'B', instruments: [{ pupitre: 'chant' }] },
        { id: 'c', nom: 'C', instruments: [{ pupitre: 'chant' }] },
        { id: 'd', nom: 'D', instruments: [{ pupitre: 'chant' }] },
      ],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'batterie' }, { personne_id: 'b', pupitre: 'chant' }] },
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'a', pupitre: 'batterie' }, { personne_id: 'c', pupitre: 'chant' }] },
      ],
    })
    const q = analyseQuotas(session, insc, creneaux)
    // Batterie : 1 musicien pour 2 groupes = plus tendu que chant (3 pour 2)
    expect(q[0].pupitre).toBe('batterie')
  })
})
