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

/** 2 jours × 3 tours ; butoir apéro le 1er jour au soir, vendredi le 2e. */
function fixtureButoir() {
  const lieu = Lieu.parse({ id: 'l', nom: 'L', salles: [{ id: 'A', nom: 'A', jauge: 10 }] })
  const session = Session.parse({
    id: 's',
    nom: 'S',
    lieu_id: 'l',
    date_debut: '2026-08-24',
    date_fin: '2026-08-25',
    butoir_apero_date: '2026-08-24',
    grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
    repetitions_visees: 3,
  })
  return { session, creneaux: genererCreneaux(session, lieu) }
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

  it('capacité limitée aux créneaux avant le butoir de l\'échéance (#92)', () => {
    // Avant #92 : capacité = 1 × 6 créneaux de session = 6, ratio 0,5.
    // Le butoir apéro n'en laisse que 3 → saturation réelle 100 %.
    const { session, creneaux } = fixtureButoir()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'b', nom: 'B', instruments: [{ pupitre: 'batterie' }] }],
      groupes: [{ id: 'g1', titre: 'G1', membres: [{ personne_id: 'b', pupitre: 'batterie' }] }],
    })
    const batterie = analyseQuotas(session, insc, creneaux).find((x) => x.pupitre === 'batterie')!
    expect(batterie.demande).toBe(3)
    expect(batterie.capacite).toBe(3)
    expect(batterie.ratio).toBe(1)
  })

  it('capacité hors créneaux bloqués par les indispos du musicien (#92)', () => {
    const { session, creneaux } = fixtureButoir()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        {
          id: 'b',
          nom: 'B',
          instruments: [{ pupitre: 'batterie' }],
          indispos: [{ jours: ['2026-08-24'], debut: '09:00', duree_minutes: 60 }],
        },
      ],
      groupes: [{ id: 'g1', titre: 'G1', membres: [{ personne_id: 'b', pupitre: 'batterie' }] }],
    })
    const batterie = analyseQuotas(session, insc, creneaux).find((x) => x.pupitre === 'batterie')!
    // 3 créneaux avant butoir apéro, 1 bloqué par l'indispo de 9h
    expect(batterie.capacite).toBe(2)
    expect(batterie.ratio).toBe(1.5)
  })

  it('échéances mélangées : retient la fenêtre de butoir la plus tendue (#92)', () => {
    const { session, creneaux } = fixtureButoir()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'b', nom: 'B', instruments: [{ pupitre: 'batterie' }] }],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'b', pupitre: 'batterie' }] },
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'b', pupitre: 'batterie' }] },
        { id: 'g3', titre: 'G3', echeance: 'restitution_vendredi', membres: [{ personne_id: 'b', pupitre: 'batterie' }] },
      ],
    })
    const batterie = analyseQuotas(session, insc, creneaux).find((x) => x.pupitre === 'batterie')!
    // Fenêtre apéro : 2 groupes × 3 = 6 pour 3 créneaux → 2 (retenue).
    // Fenêtre vendredi : 3 groupes × 3 = 9 pour 6 créneaux → 1,5.
    // Avant #92 : 9 / 6 = 1,5 — la tension sur l'apéro était masquée.
    expect(batterie.nb_groupes_demandeurs).toBe(3)
    expect(batterie.demande).toBe(6)
    expect(batterie.capacite).toBe(3)
    expect(batterie.ratio).toBe(2)
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
