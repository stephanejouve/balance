import { describe, expect, it } from 'vitest'
import type { EtapeConcert } from '../engine/concert'
import type { Groupe, Personne } from '../domain/model'
import {
  calculerConducteurMinuté,
  calculerRepartitionStyles,
  couleurStyle,
  lateraliteBatteur,
  statsConducteur,
} from './app-conducteur'

const groupe = (id: string, membres: Groupe['membres'], style = ''): Groupe => ({
  id,
  titre: id,
  auteur: '',
  style,
  tonalite: '',
  responsable_id: '',
  membres,
  postes_cherches: [],
  repetitions_deja_faites: 0,
})

const personne = (id: string, lateralite?: Personne['lateralite']): Personne => ({
  id,
  nom: id,
  discriminant: '',
  instruments: [],
  role: 'musicien',
  indispos: [],
  lateralite,
})

const etape = (groupe_id: string, style = ''): EtapeConcert => ({
  groupe_id,
  titre: groupe_id,
  style,
  musiciens_partages_avec_precedent: 0,
  musiciens_qui_montent: [],
  musiciens_qui_descendent: [],
})

describe('lateraliteBatteur', () => {
  it('renvoie la latéralité du batteur du groupe', () => {
    const g = groupe('g', [{ personne_id: 'dan', pupitre: 'batterie' }])
    const groupesParId = new Map([['g', g]])
    const personnesParId = new Map([['dan', personne('dan', 'droitier')]])
    expect(lateraliteBatteur('g', groupesParId, personnesParId)).toBe('droitier')
  })

  it("renvoie null si le groupe n'a pas de batteur", () => {
    const g = groupe('g', [{ personne_id: 'alice', pupitre: 'chant' }])
    const groupesParId = new Map([['g', g]])
    const personnesParId = new Map([['alice', personne('alice')]])
    expect(lateraliteBatteur('g', groupesParId, personnesParId)).toBeNull()
  })

  it("renvoie null si la latéralité du batteur est inconnue", () => {
    const g = groupe('g', [{ personne_id: 'dan', pupitre: 'batterie' }])
    const groupesParId = new Map([['g', g]])
    const personnesParId = new Map([['dan', personne('dan')]]) // pas de latéralité
    expect(lateraliteBatteur('g', groupesParId, personnesParId)).toBeNull()
  })

  it("renvoie null pour un groupe inconnu", () => {
    expect(lateraliteBatteur('inconnu', new Map(), new Map())).toBeNull()
  })
})

describe('calculerConducteurMinuté', () => {
  const params = { debut: '18:30', dureeMorceau: 6, dureeChange: 3, dureeKit: 7 }

  it('minutage sans batteur : durées de morceau + change réguliers', () => {
    const ordre: EtapeConcert[] = [etape('g1'), etape('g2'), etape('g3')]
    const groupesParId = new Map<string, Groupe>()
    const personnesParId = new Map<string, Personne>()
    const res = calculerConducteurMinuté(ordre, params, groupesParId, personnesParId)
    // 3 étapes : g1 à 18:30 (change 0), g2 à 18:39 (18:36 + 3), g3 à 18:48
    expect(res.etapes[0].heure_debut).toBe('18:30')
    expect(res.etapes[0].change_min).toBe(0)
    expect(res.etapes[1].heure_debut).toBe('18:39')
    expect(res.etapes[1].change_min).toBe(3)
    expect(res.etapes[2].heure_debut).toBe('18:48')
    // Durée totale = 3 × 6 (morceaux) + 2 × 3 (changes) = 24 min
    expect(res.duree_totale_min).toBe(24)
    expect(res.nb_inversions).toBe(0)
  })

  it("détecte une inversion de kit entre 2 batteurs de latéralités opposées", () => {
    const g1 = groupe('g1', [{ personne_id: 'dan', pupitre: 'batterie' }])
    const g2 = groupe('g2', [{ personne_id: 'zoé', pupitre: 'batterie' }])
    const groupesParId = new Map([['g1', g1], ['g2', g2]])
    const personnesParId = new Map([
      ['dan', personne('dan', 'droitier')],
      ['zoé', personne('zoé', 'gaucher')],
    ])
    const ordre = [etape('g1'), etape('g2')]
    const res = calculerConducteurMinuté(ordre, params, groupesParId, personnesParId)
    expect(res.nb_inversions).toBe(1)
    expect(res.etapes[1].inversion_kit).toBe(true)
    // Le change min prend max(dureeChange=3, dureeKit=7) = 7 min
    expect(res.etapes[1].change_min).toBe(7)
  })

  it("pas d'inversion entre 2 batteurs de même latéralité", () => {
    const g1 = groupe('g1', [{ personne_id: 'dan', pupitre: 'batterie' }])
    const g2 = groupe('g2', [{ personne_id: 'ben', pupitre: 'batterie' }])
    const groupesParId = new Map([['g1', g1], ['g2', g2]])
    const personnesParId = new Map([
      ['dan', personne('dan', 'droitier')],
      ['ben', personne('ben', 'droitier')],
    ])
    const ordre = [etape('g1'), etape('g2')]
    const res = calculerConducteurMinuté(ordre, params, groupesParId, personnesParId)
    expect(res.nb_inversions).toBe(0)
    expect(res.etapes[1].inversion_kit).toBe(false)
  })
})

describe('statsConducteur', () => {
  it('compte les mouvements entre étapes consécutives', () => {
    const g1 = groupe('g1', [
      { personne_id: 'alice', pupitre: 'chant' },
      { personne_id: 'bob', pupitre: 'piano' },
    ])
    const g2 = groupe('g2', [
      { personne_id: 'bob', pupitre: 'piano' }, // reste
      { personne_id: 'carol', pupitre: 'basse' }, // monte
    ])
    const groupesParId = new Map([['g1', g1], ['g2', g2]])
    // g1→g2 : alice descend, carol monte = 2 mouvements
    // Avant g1 (précédents vide) : alice + bob montent = 2 mouvements
    const stats = statsConducteur([etape('g1'), etape('g2')], groupesParId)
    expect(stats.mouvements).toBe(4)
  })

  it('renvoie 0 pour un ordre vide', () => {
    expect(statsConducteur([], new Map()).mouvements).toBe(0)
  })
})

describe('calculerRepartitionStyles', () => {
  it('regroupe par style avec pourcentages', () => {
    const ordre = [etape('g1', 'Jazz'), etape('g2', 'Rock'), etape('g3', 'Jazz')]
    const res = calculerRepartitionStyles(ordre)
    expect(res.parts).toHaveLength(2)
    expect(res.parts[0]).toEqual({ style: 'Jazz', n: 2, pct: 67 })
    expect(res.parts[1]).toEqual({ style: 'Rock', n: 1, pct: 33 })
  })

  it("détecte les runs consécutifs ≥ 3 du même style", () => {
    const ordre = [
      etape('g1', 'Jazz'),
      etape('g2', 'Jazz'),
      etape('g3', 'Jazz'), // run de 3
      etape('g4', 'Rock'),
      etape('g5', 'Jazz'),
    ]
    const res = calculerRepartitionStyles(ordre)
    expect(res.runs).toHaveLength(1)
    expect(res.runs[0]).toEqual({ style: 'Jazz', debut: 0, fin: 2 })
  })

  it('groupe les morceaux sans style sous « (sans style) »', () => {
    const ordre = [etape('g1'), etape('g2', 'Jazz')]
    const res = calculerRepartitionStyles(ordre)
    expect(res.parts.some((p) => p.style === '(sans style)')).toBe(true)
  })
})

describe('couleurStyle', () => {
  it('renvoie une couleur HSL stable pour un style donné', () => {
    const c1 = couleurStyle('Jazz')
    const c2 = couleurStyle('Jazz')
    expect(c1).toBe(c2)
    expect(c1).toMatch(/^hsl\(/)
  })

  it('renvoie une couleur neutre pour un style vide', () => {
    expect(couleurStyle('')).toBe('#e8e5da')
  })
})
