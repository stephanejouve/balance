import { describe, expect, it } from 'vitest'
import type { Inscriptions, Personne } from '../domain/model'
import { classePourPupitre, comptageGroupes } from './libres-tri'

function personne(id: string, nom: string, pupitres: string[]): Personne {
  return {
    id,
    nom,
    discriminant: '',
    role: 'musicien',
    instruments: pupitres.map((p) => ({ pupitre: p, lourd: false })),
    indispos: [],
  }
}

function inscriptions(): Inscriptions {
  return {
    session_id: 's',
    personnes: [
      personne('emma', 'Emma', ['chant']),
      personne('lea', 'Léa', ['chant']),
      personne('marc', 'Marc', ['chant']),
      personne('julia', 'Julia', ['chant']),
      personne('theo', 'Théo', ['basse']),
    ],
    groupes: [
      {
        id: 'g1',
        titre: 'X',
        auteur: '',
        responsable_id: 'r',
        style: '',
        tonalite: '',
        membres: [
          { personne_id: 'marc', pupitre: 'chant' },
          { personne_id: 'julia', pupitre: 'chant' },
        ],
        postes_cherches: [],
        repetitions_deja_faites: 0,
        echeance: 'apero_mercredi',
      },
      {
        id: 'g2',
        titre: 'Y',
        auteur: '',
        responsable_id: 'r',
        style: '',
        tonalite: '',
        membres: [{ personne_id: 'julia', pupitre: 'chant' }],
        postes_cherches: [],
        repetitions_deja_faites: 0,
        echeance: 'apero_mercredi',
      },
    ],
    imposes: [],
  }
}

describe('comptageGroupes', () => {
  it("compte le nombre d'engagements en groupes par personne", () => {
    const c = comptageGroupes(inscriptions())
    expect(c.get('marc')).toBe(1)
    expect(c.get('julia')).toBe(2)
    expect(c.get('emma')).toBeUndefined()
  })
})

describe('classePourPupitre', () => {
  it("retourne tous les stagiaires du pupitre triés par engagement croissant", () => {
    const c = classePourPupitre('chant', inscriptions())
    expect(c.map((c) => c.personne.id)).toEqual(['emma', 'lea', 'marc', 'julia'])
  })

  it('inclut les engagés (pas de filtre libres-only)', () => {
    const c = classePourPupitre('chant', inscriptions())
    expect(c.find((c) => c.personne.id === 'julia')?.nb_groupes).toBe(2)
  })

  it('trie alphabétiquement par nom pour engagement égal', () => {
    const c = classePourPupitre('chant', inscriptions())
    expect(c.slice(0, 2).map((c) => c.personne.nom)).toEqual(['Emma', 'Léa'])
  })

  it('personnes multi-pupitres apparaissent dans chaque pupitre correspondant', () => {
    const ins = inscriptions()
    ins.personnes.push(personne('sarah', 'Sarah', ['chant', 'guitare']))
    expect(classePourPupitre('chant', ins).map((c) => c.personne.id)).toContain('sarah')
    expect(classePourPupitre('guitare', ins).map((c) => c.personne.id)).toContain('sarah')
  })

  it('pupitre sans stagiaires → liste vide', () => {
    expect(classePourPupitre('vents', inscriptions())).toEqual([])
  })

  it("tie-break sur id garantit un ordre déterministe pour homonymes", () => {
    const ins = inscriptions()
    // 2 personnes même nom + même engagement → tie-break sur id
    ins.personnes = [
      personne('emma-2', 'Emma', ['chant']),
      personne('emma-1', 'Emma', ['chant']),
    ]
    const c = classePourPupitre('chant', ins)
    expect(c.map((c) => c.personne.id)).toEqual(['emma-1', 'emma-2'])
  })
})
