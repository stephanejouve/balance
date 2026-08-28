import { describe, expect, it } from 'vitest'
import type { Creneau } from '../domain/grille'
import { FONCTIONS_ACTIVEES_TOUT_ACTIF } from '../domain/model'
import type { Inscriptions, Lieu } from '../domain/model'
import { attribuerSalles } from './allocate-rooms'
import type { PlacementItem } from './solver'

function lieuAvecSalles(salles: Array<{ id: string; jauge: number; actif?: boolean }>): Lieu {
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

function creneau(id: string, salles: string[], debut = '09:00', fin = '10:00'): Creneau {
  return { id, date: '2026-08-28', debut, fin, salles }
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
  }
}

const inscriptions = (groupes: Inscriptions['groupes']): Inscriptions => ({
  session_id: 's',
  personnes: [],
  groupes,
  imposes: [],
})

describe('attribuerSalles — cas nominaux', () => {
  it('attribue une salle unique quand pas de conflit', () => {
    const lieu = lieuAvecSalles([{ id: 's1', jauge: 10 }])
    const insc = inscriptions([groupe('g1', ['a', 'b'])])
    const creneaux = [creneau('c1', ['s1'])]
    const placement: PlacementItem[] = [{ groupe_id: 'g1', creneau_id: 'c1' }]

    const res = attribuerSalles(placement, lieu, insc, creneaux)
    expect(res.assignations).toEqual([{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 's1' }])
    expect(res.groupesPerdus).toEqual([])
    expect(res.warnings).toEqual([])
  })

  it('sépare deux groupes sur deux salles au même créneau', () => {
    const lieu = lieuAvecSalles([{ id: 's1', jauge: 10 }, { id: 's2', jauge: 10 }])
    const insc = inscriptions([groupe('g1', ['a']), groupe('g2', ['b'])])
    const creneaux = [creneau('c1', ['s1', 's2'])]
    const placement: PlacementItem[] = [
      { groupe_id: 'g1', creneau_id: 'c1' },
      { groupe_id: 'g2', creneau_id: 'c1' },
    ]
    const res = attribuerSalles(placement, lieu, insc, creneaux)
    expect(res.assignations).toHaveLength(2)
    const salles = new Set(res.assignations.map((a) => a.salle_id))
    expect(salles.size).toBe(2)
    expect(res.groupesPerdus).toEqual([])
  })
})

describe('attribuerSalles — cas de groupe perdu (fix bug audit Leader)', () => {
  it('signale un groupe perdu quand toutes les salles restantes sont trop petites', () => {
    // 2 gros groupes (10 musiciens chacun), 2 salles : 1 grande (jauge 12),
    // 1 petite (jauge 6). Après tri, le 1er groupe prend la grande, le 2e ne
    // rentre pas dans la petite → perdu.
    const lieu = lieuAvecSalles([
      { id: 'grande', jauge: 12 },
      { id: 'petite', jauge: 6 },
    ])
    const dix = (prefix: string) => [...Array(10)].map((_, i) => `${prefix}${i}`)
    const insc = inscriptions([groupe('g1', dix('a')), groupe('g2', dix('b'))])
    const creneaux = [creneau('c1', ['grande', 'petite'])]
    const placement: PlacementItem[] = [
      { groupe_id: 'g1', creneau_id: 'c1' },
      { groupe_id: 'g2', creneau_id: 'c1' },
    ]
    const res = attribuerSalles(placement, lieu, insc, creneaux)

    // Un groupe est perdu (celui qui passe en second)
    expect(res.groupesPerdus).toHaveLength(1)
    expect(res.groupesPerdus[0].effectif).toBe(10)
    expect(res.groupesPerdus[0].raison).toContain('trop petite')
    expect(res.warnings).toHaveLength(1)
    expect(res.warnings[0]).toContain('Groupe non logé')
  })

  it('signale un groupe perdu quand toutes les salles sont déjà prises', () => {
    // 3 groupes sur 2 salles au même créneau : le 3e n'a plus de salle
    const lieu = lieuAvecSalles([{ id: 's1', jauge: 10 }, { id: 's2', jauge: 10 }])
    const insc = inscriptions([
      groupe('g1', ['a']),
      groupe('g2', ['b']),
      groupe('g3', ['c']),
    ])
    const creneaux = [creneau('c1', ['s1', 's2'])]
    const placement: PlacementItem[] = [
      { groupe_id: 'g1', creneau_id: 'c1' },
      { groupe_id: 'g2', creneau_id: 'c1' },
      { groupe_id: 'g3', creneau_id: 'c1' },
    ]
    const res = attribuerSalles(placement, lieu, insc, creneaux)

    expect(res.assignations).toHaveLength(2)
    expect(res.groupesPerdus).toHaveLength(1)
    expect(res.groupesPerdus[0].creneau_id).toBe('c1')
    expect(res.groupesPerdus[0].raison).toContain('aucune salle disponible')
  })

  it('ne signale rien quand toutes les attributions passent', () => {
    const lieu = lieuAvecSalles([{ id: 's1', jauge: 10 }])
    const insc = inscriptions([groupe('g1', ['a'])])
    const creneaux = [creneau('c1', ['s1'])]
    const placement: PlacementItem[] = [{ groupe_id: 'g1', creneau_id: 'c1' }]

    const res = attribuerSalles(placement, lieu, insc, creneaux)
    expect(res.groupesPerdus).toEqual([])
    expect(res.warnings).toEqual([])
  })

  it('utilise le titre du groupe dans le message de raison', () => {
    const lieu = lieuAvecSalles([{ id: 's1', jauge: 10 }])
    const insc = inscriptions([groupe('g1', ['a']), groupe('g2', ['b'])])
    insc.groupes[0].titre = 'Blowin in the wind'
    insc.groupes[1].titre = 'Autumn Leaves'
    const creneaux = [creneau('c1', ['s1'])]
    const placement: PlacementItem[] = [
      { groupe_id: 'g1', creneau_id: 'c1' },
      { groupe_id: 'g2', creneau_id: 'c1' },
    ]

    const res = attribuerSalles(placement, lieu, insc, creneaux)
    expect(res.groupesPerdus).toHaveLength(1)
    // Le groupe perdu est celui qui passe en 2e — vérifie que son titre est cité
    expect(res.groupesPerdus[0].raison).toMatch(/Blowin|Autumn/)
  })
})

describe('attribuerSalles — enchaînement et rotation', () => {
  it('garde un groupe dans la même salle sur des créneaux consécutifs', () => {
    const lieu = lieuAvecSalles([{ id: 's1', jauge: 10 }, { id: 's2', jauge: 10 }])
    const insc = inscriptions([groupe('g1', ['a'])])
    const creneaux = [
      creneau('c1', ['s1', 's2'], '09:00', '10:00'),
      creneau('c2', ['s1', 's2'], '10:00', '11:00'),
    ]
    const placement: PlacementItem[] = [
      { groupe_id: 'g1', creneau_id: 'c1' },
      { groupe_id: 'g1', creneau_id: 'c2' },
    ]
    const res = attribuerSalles(placement, lieu, insc, creneaux)
    expect(res.assignations).toHaveLength(2)
    // Enchaînement : même salle
    expect(res.assignations[0].salle_id).toBe(res.assignations[1].salle_id)
  })

  it('respecte les figées et enlève leur salle du pool disponible', () => {
    const lieu = lieuAvecSalles([{ id: 's1', jauge: 10 }, { id: 's2', jauge: 10 }])
    const insc = inscriptions([groupe('g1', ['a']), groupe('g2', ['b'])])
    const creneaux = [creneau('c1', ['s1', 's2'])]
    const placement: PlacementItem[] = [
      { groupe_id: 'g1', creneau_id: 'c1' },
      { groupe_id: 'g2', creneau_id: 'c1' },
    ]
    const res = attribuerSalles(placement, lieu, insc, creneaux, {
      figees: [{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 's1' }],
    })
    // g1 garde s1 (figée), g2 prend s2 (seule salle restante)
    expect(res.assignations.find((a) => a.groupe_id === 'g1')?.salle_id).toBe('s1')
    expect(res.assignations.find((a) => a.groupe_id === 'g2')?.salle_id).toBe('s2')
    expect(res.groupesPerdus).toEqual([])
  })
})
