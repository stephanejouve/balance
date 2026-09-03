import { describe, expect, it } from 'vitest'
import type { Personne } from '../domain/model'
import {
  MAPPING_PROPOSES_DEFAUT,
  extraireProposes,
  normaliserDate,
  normaliserHeure,
} from './proposes-adapter'

const personnes = (ids: string[]): Personne[] =>
  ids.map((id) => ({
    id,
    nom: id,
    discriminant: '',
    instruments: [],
    role: 'musicien' as const,
    indispos: [],
  }))

describe('normaliserDate', () => {
  it('accepte ISO tel quel', () => {
    expect(normaliserDate('2026-08-28')).toBe('2026-08-28')
  })
  it('convertit JJ/MM/AAAA', () => {
    expect(normaliserDate('28/08/2026')).toBe('2026-08-28')
  })
  it('convertit JJ-MM-AAAA', () => {
    expect(normaliserDate('28-08-2026')).toBe('2026-08-28')
  })
})

describe('normaliserHeure', () => {
  it('accepte HH:MM tel quel', () => {
    expect(normaliserHeure('09:30')).toBe('09:30')
  })
  it('convertit 9h30', () => {
    expect(normaliserHeure('9h30')).toBe('09:30')
  })
  it('convertit 9h → 09:00', () => {
    expect(normaliserHeure('9h')).toBe('09:00')
  })
})

describe('extraireProposes', () => {
  it('fusionne les lignes de même titre en 1 Impose avec N séances', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin', 'Salle'],
      ['Blowin', 'karl, emma', '2026-08-28', '09:00', '10:00', 'XV'],
      ['Blowin', 'karl, emma', '2026-08-29', '14:00', '15:00', ''],
      ['Autumn', 'karl', '2026-08-28', '10:00', '11:00', ''],
    ]
    const { imposes, warnings } = extraireProposes(
      rows,
      MAPPING_PROPOSES_DEFAUT,
      personnes(['karl', 'emma']),
    )
    expect(warnings).toEqual([])
    expect(imposes).toHaveLength(2)
    expect(imposes[0].morceau).toBe('Blowin')
    expect(imposes[0].membres).toEqual(['karl', 'emma'])
    expect(imposes[0].seances).toHaveLength(2)
    expect(imposes[0].seances[0]).toEqual({
      date: '2026-08-28',
      debut: '09:00',
      fin: '10:00',
      salle_id: 'XV',
    })
    expect(imposes[1].morceau).toBe('Autumn')
    expect(imposes[1].seances).toHaveLength(1)
  })

  it('warn membre inconnu et l\'ignore (référentiel non vide → orphan probable)', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
      ['Blowin', 'karl, inconnu', '2026-08-28', '09:00', '10:00'],
    ]
    const { imposes, warnings } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    expect(imposes[0].membres).toEqual(['karl'])
    // Nouveau message : quand un référentiel est fourni, l'absence signale
    // une erreur d'orthographe côté saisie (pas une carence d'import).
    expect(warnings.some((w) => w.includes('non trouvé dans le référentiel'))).toBe(true)
    // Anti-régression audit Stéphane 2026-09-03 : plus jamais le guidage
    // trompeur « importe d'abord l'onglet Liste ou Stagiaires ».
    expect(warnings.some((w) => w.includes("importe d'abord"))).toBe(false)
  })

  it('warn différencié quand aucun référentiel (classeur Proposés seul)', () => {
    // Cas produit par l'import PDF de Leader : Stagiaires/Liste vides, seul
    // Proposés est peuplé. Les membres du PDF sont réellement à créer côté
    // Stagiaires — le warning doit le dire, pas suggérer une erreur de manip.
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
      ['Autumn Leaves', 'Denis (A)', '2026-08-28', '09:00', '10:00'],
    ]
    const { imposes, warnings } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, [])
    expect(imposes[0].membres).toEqual([]) // le membre est skip
    expect(warnings.some((w) => w.includes('à créer ou à compléter côté Stagiaires'))).toBe(true)
    expect(warnings.some((w) => w.includes("importe d'abord"))).toBe(false)
  })

  it('renvoie warning si colonne obligatoire manquante', () => {
    const rows = [
      ['Morceau', 'Date', 'Début', 'Fin'], // pas de « Membres »
      ['Blowin', '2026-08-28', '09:00', '10:00'],
    ]
    const { imposes, warnings } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, [])
    expect(imposes).toEqual([])
    expect(warnings[0]).toContain('Membres')
  })

  it('ignore les lignes avec date/heure incomplète', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
      ['Blowin', 'karl', '', '09:00', '10:00'],
    ]
    const { imposes, warnings } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    expect(imposes).toEqual([])
    expect(warnings.some((w) => w.includes('incomplet'))).toBe(true)
  })

  it('gère le format horaire « 9h » et date FR « 28/08/2026 »', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
      ['Blowin', 'karl', '28/08/2026', '9h', '10h30'],
    ]
    const { imposes } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    expect(imposes[0].seances[0]).toEqual({
      date: '2026-08-28',
      debut: '09:00',
      fin: '10:30',
    })
  })
})
