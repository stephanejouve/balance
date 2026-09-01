import { describe, expect, it } from 'vitest'
import type { AlerteIdentite, PersonneRelecture } from '../domain/identites'
import {
  filtrerPersonnes,
  grouperAlertes,
  synthese,
  trierPersonnes,
} from './relecture-identites-vm'

function personne(nom_affichage: string, instruments: string[], nb: number): PersonneRelecture {
  return { nom_affichage, instruments, nb_engagements: nb }
}

describe('grouperAlertes — hiérarchie visuelle (Stéphane 2026-09-01)', () => {
  it('sépare decisions (homonymie + doublon) et signalements (rapprochement)', () => {
    const alertes: AlerteIdentite[] = [
      { type: 'homonymie_probable', nom: 'Pierre', instruments: ['batterie', 'guitare'], groupes: ['A', 'B'] },
      { type: 'rapprochement_propose', nom_court: 'Pierre', nom_long: 'Pierre Lemoine', groupe: null },
      { type: 'doublon_intra_groupe', nom: 'Pierre', discriminants: ['Pierre', 'Pierre Lemoine'], groupe: 'Sables' },
    ]
    const groupes = grouperAlertes(alertes)
    expect(groupes.decisions).toHaveLength(2)
    expect(groupes.decisions.map((a) => a.type)).toEqual(['homonymie_probable', 'doublon_intra_groupe'])
    expect(groupes.signalements).toHaveLength(1)
    expect(groupes.signalements[0].type).toBe('rapprochement_propose')
  })

  it('ordre préservé au sein de chaque groupe (input order)', () => {
    const alertes: AlerteIdentite[] = [
      { type: 'doublon_intra_groupe', nom: 'A', discriminants: [], groupe: 'M' },
      { type: 'homonymie_probable', nom: 'B', instruments: ['a', 'b'], groupes: ['M', 'N'] },
    ]
    const { decisions } = grouperAlertes(alertes)
    expect(decisions.map((a) => (a as { nom: string }).nom)).toEqual(['A', 'B'])
  })

  it('input vide → groupes vides', () => {
    expect(grouperAlertes([])).toEqual({ decisions: [], signalements: [] })
  })
})

describe('trierPersonnes', () => {
  const personnes = [
    personne('Zora', ['chant'], 1),
    personne('Alpha', ['piano'], 5),
    personne('Emma', ['batterie'], 3),
  ]

  it('alpha : tri par nom insensible casse', () => {
    const tries = trierPersonnes(personnes, 'alpha')
    expect(tries.map((p) => p.nom_affichage)).toEqual(['Alpha', 'Emma', 'Zora'])
  })

  it('engagements : tri par nb décroissant, alpha en fallback', () => {
    const tries = trierPersonnes(personnes, 'engagements')
    expect(tries.map((p) => p.nom_affichage)).toEqual(['Alpha', 'Emma', 'Zora'])
  })

  it('engagements avec égalités → tri alpha secondaire', () => {
    const p = [
      personne('Zora', ['chant'], 3),
      personne('Alpha', ['piano'], 3),
      personne('Emma', ['batterie'], 3),
    ]
    const tries = trierPersonnes(p, 'engagements')
    expect(tries.map((x) => x.nom_affichage)).toEqual(['Alpha', 'Emma', 'Zora'])
  })

  it('ne mute pas l\'array d\'entrée', () => {
    const original = [...personnes]
    trierPersonnes(personnes, 'alpha')
    expect(personnes).toEqual(original)
  })
})

describe('filtrerPersonnes', () => {
  const personnes = [
    personne('Pierre (L)', ['batterie'], 2),
    personne('Pierre-Yves L.', ['chant'], 4),
    personne('Emma', ['piano'], 3),
    personne('BRUNO V.', ['batterie'], 1),
  ]

  it('recherche vide → toutes les personnes', () => {
    expect(filtrerPersonnes(personnes, '')).toEqual(personnes)
    expect(filtrerPersonnes(personnes, '   ')).toEqual(personnes)
  })

  it('substring insensible casse (« PIERRE » matche « Pierre-Yves L. »)', () => {
    const r = filtrerPersonnes(personnes, 'PIERRE')
    expect(r.map((p) => p.nom_affichage)).toEqual(['Pierre (L)', 'Pierre-Yves L.'])
  })

  it('normalisation espaces (« bruno v » matche « BRUNO V. »)', () => {
    const r = filtrerPersonnes(personnes, 'bruno v')
    expect(r.map((p) => p.nom_affichage)).toEqual(['BRUNO V.'])
  })

  it('aucun résultat → array vide', () => {
    expect(filtrerPersonnes(personnes, 'introuvable')).toEqual([])
  })
})

describe('synthese', () => {
  it('compteurs séparés decisions / signalements / personnes', () => {
    const s = synthese({
      alertes_identite: [
        { type: 'homonymie_probable', nom: 'Pierre', instruments: ['a', 'b'], groupes: ['X'] },
        { type: 'doublon_intra_groupe', nom: 'Pierre', discriminants: [], groupe: 'X' },
        { type: 'rapprochement_propose', nom_court: 'A', nom_long: 'A B', groupe: null },
        { type: 'rapprochement_propose', nom_court: 'Solène', nom_long: 'Solene', groupe: null },
      ],
      personnes_relecture: [
        personne('Alpha', ['chant'], 1),
        personne('Beta', ['piano'], 2),
      ],
    })
    expect(s).toEqual({ nb_decisions: 2, nb_signalements: 2, nb_personnes: 2 })
  })

  it('0 alertes → écran franchissable en 1 clic (compteurs à 0)', () => {
    const s = synthese({
      alertes_identite: [],
      personnes_relecture: [personne('Solo', [], 0)],
    })
    expect(s).toEqual({ nb_decisions: 0, nb_signalements: 0, nb_personnes: 1 })
  })
})

describe('garde-fou d\'affichage (Stéphane 2026-09-01)', () => {
  it('trierPersonnes préserve la forme brute du nom_affichage', () => {
    const p = [
      personne('BRUNO V.', ['batterie'], 1),
      personne('Sofia  T.', ['chant'], 2),  // double espace conservé
    ]
    const tries = trierPersonnes(p, 'alpha')
    expect(tries[0].nom_affichage).toBe('BRUNO V.')      // pas 'bruno v.'
    expect(tries[1].nom_affichage).toBe('Sofia  T.')     // double espace conservé
  })

  it('filtrerPersonnes préserve la forme brute', () => {
    const p = [personne('BRUNO V.', ['batterie'], 1)]
    const r = filtrerPersonnes(p, 'bruno')
    expect(r[0].nom_affichage).toBe('BRUNO V.')
  })
})
