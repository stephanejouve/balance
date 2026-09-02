import { describe, expect, it } from 'vitest'
import type { Creneau } from '../domain/grille'
import { FONCTIONS_ACTIVEES_TOUT_ACTIF } from '../domain/model'
import type { Groupe, Inscriptions, Lieu } from '../domain/model'
import { ciblesValides, testerDeplacement } from './manuel'
import type { Assignation } from './types'

function lieu(salles: Array<{ id: string; jauge: number; actif?: boolean }>): Lieu {
  return {
    id: 'l',
    nom: 'L',
    salles: salles.map((s) => ({
      id: s.id,
      nom: s.id,
      jauge: s.jauge,
      equipement: [],
      restrictions: [],
      actif: s.actif ?? true,
    })),
    pupitres: ['piano', 'basse', 'chant', 'guitare', 'batterie', 'vents'],
    fonctionsActivees: FONCTIONS_ACTIVEES_TOUT_ACTIF,
  }
}

function creneau(id: string, salles: string[], date = '2026-08-28', debut = '09:00'): Creneau {
  return { id, date, debut, fin: '10:00', salles }
}

function groupe(id: string, membres: string[]): Groupe {
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

const insc = (overrides: Partial<Inscriptions> = {}): Inscriptions => ({
  session_id: 's',
  personnes: [],
  groupes: [],
  imposes: [],
  ...overrides,
})

const butoir = { date: '2026-08-30', heure: '20:00' }

describe('testerDeplacement — raisons de refus', () => {
  const g1 = groupe('g1', ['alice'])
  const l = lieu([{ id: 's1', jauge: 10 }, { id: 's2', jauge: 10 }])
  const inscA = insc({ personnes: [{ id: 'alice', nom: 'Alice', discriminant: '', instruments: [], role: 'musicien', indispos: [] }], groupes: [g1] })
  const originale: Assignation = { groupe_id: 'g1', creneau_id: 'c0', salle_id: 's1' }

  it('accepte un déplacement valide (renvoie null)', () => {
    const c = creneau('c1', ['s1', 's2'])
    expect(testerDeplacement(originale, c, 's1', g1, l, inscA, [], butoir)).toBeNull()
  })

  it('refuse si la salle est inactive', () => {
    const l2 = lieu([{ id: 's1', jauge: 10, actif: false }])
    const c = creneau('c1', ['s1'])
    expect(testerDeplacement(originale, c, 's1', g1, l2, inscA, [], butoir)).toBe('salle-inactive')
  })

  it('refuse si la salle n\'est pas ouverte au créneau', () => {
    const c = creneau('c1', ['s2']) // s1 pas dans les salles ouvertes
    expect(testerDeplacement(originale, c, 's1', g1, l, inscA, [], butoir)).toBe('salle-inactive')
  })

  it('refuse si l\'effectif dépasse la jauge', () => {
    const gBig = groupe('gBig', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'])
    const inscBig = insc({ groupes: [gBig] })
    const c = creneau('c1', ['s1'])
    expect(testerDeplacement(originale, c, 's1', gBig, l, inscBig, [], butoir)).toBe('jauge-depassee')
  })

  it('refuse si le créneau est au-delà du butoir', () => {
    const c = creneau('c1', ['s1'], '2026-08-30', '21:00') // après butoir 20:00
    expect(testerDeplacement(originale, c, 's1', g1, l, inscA, [], butoir)).toBe('creneau-butoir')
  })

  it('refuse si une autre assignation prend déjà cette salle sur ce créneau', () => {
    const c = creneau('c1', ['s1', 's2'])
    const autres: Assignation[] = [{ groupe_id: 'gAutre', creneau_id: 'c1', salle_id: 's1' }]
    expect(testerDeplacement(originale, c, 's1', g1, l, inscA, autres, butoir)).toBe('salle-prise')
  })

  it('refuse si un membre est déjà booké dans un autre groupe au même créneau', () => {
    const g2 = groupe('g2', ['alice']) // partage Alice avec g1
    const inscBoth = insc({
      personnes: [{ id: 'alice', nom: 'Alice', discriminant: '', instruments: [], role: 'musicien', indispos: [] }],
      groupes: [g1, g2],
    })
    const c = creneau('c1', ['s1', 's2'])
    const autres: Assignation[] = [{ groupe_id: 'g2', creneau_id: 'c1', salle_id: 's2' }]
    expect(testerDeplacement(originale, c, 's1', g1, l, inscBoth, autres, butoir)).toBe(
      'membre-double-booke',
    )
  })

  it('refuse si un membre est indisponible sur ce créneau', () => {
    const inscIndispo = insc({
      personnes: [
        {
          id: 'alice',
          nom: 'Alice',
          discriminant: '',
          instruments: [],
          role: 'musicien',
          indispos: [{ jours: [], debut: '09:00', fin: '10:00', roles: [], motif: '' }],
        },
      ],
      groupes: [g1],
    })
    const c = creneau('c1', ['s1'], '2026-08-28', '09:00')
    expect(testerDeplacement(originale, c, 's1', g1, l, inscIndispo, [], butoir)).toBe('membre-indispo')
  })

  it('refuse si la salle est restreinte (interdit) au créneau', () => {
    const l2: Lieu = {
      ...l,
      salles: [
        {
          id: 's1',
          nom: 's1',
          jauge: 10,
          equipement: [],
          restrictions: [
            { jours: [], debut: '09:00', fin: '10:00', contrainte: 'interdit', motif: 'dortoirs' },
          ],
          actif: true,
        },
      ],
    }
    const c = creneau('c1', ['s1'], '2026-08-28', '09:00')
    expect(testerDeplacement(originale, c, 's1', g1, l2, inscA, [], butoir)).toBe('salle-restreinte')
  })
})

describe('ciblesValides', () => {
  const g1 = groupe('g1', ['alice'])
  const l = lieu([{ id: 's1', jauge: 10 }, { id: 's2', jauge: 10 }])
  const inscA = insc({
    personnes: [{ id: 'alice', nom: 'Alice', discriminant: '', instruments: [], role: 'musicien', indispos: [] }],
    groupes: [g1],
  })
  const originale: Assignation = { groupe_id: 'g1', creneau_id: 'c1', salle_id: 's1' }

  it('renvoie toutes les combinaisons valides sauf la position originale', () => {
    const creneaux = [creneau('c1', ['s1', 's2']), creneau('c2', ['s1', 's2'], '2026-08-28', '14:00')]
    const cibles = ciblesValides(originale, g1, l, inscA, creneaux, [], butoir)
    // 4 combinaisons théoriques (2 créneaux × 2 salles) — 1 originale = 3 valides
    expect(cibles).toHaveLength(3)
    // Vérifier que la position originale n'est pas dans la liste
    expect(cibles.some((c) => c.creneau.id === 'c1' && c.salle_id === 's1')).toBe(false)
  })

  it("exclut les cibles refusées (salle prise + jauge)", () => {
    const gBig = groupe('g1', ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']) // 11 musiciens
    const inscBig = insc({ groupes: [gBig] })
    const creneaux = [creneau('c1', ['s1', 's2']), creneau('c2', ['s1', 's2'], '2026-08-28', '14:00')]
    const autres: Assignation[] = [{ groupe_id: 'gAutre', creneau_id: 'c2', salle_id: 's1' }]
    const cibles = ciblesValides(originale, gBig, l, inscBig, creneaux, autres, butoir)
    // Toutes les salles trop petites (jauge 10 < 11) → 0 cibles valides
    expect(cibles).toHaveLength(0)
  })

  it("renvoie un tableau vide quand il n'y a aucun créneau", () => {
    const cibles = ciblesValides(originale, g1, l, inscA, [], [], butoir)
    expect(cibles).toEqual([])
  })
})
