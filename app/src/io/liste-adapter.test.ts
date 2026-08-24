import { describe, expect, it } from 'vitest'
import type { MappingListe } from './liste-adapter'
import { extraireListe } from './liste-adapter'

const MAPPING_DEFAUT: MappingListe = {
  colonneMorceau: 'Morceau',
  colonneAuteur: 'Auteur',
  colonneStyle: 'Style',
  colonneTona: 'Tona',
  colonneResp: 'Resp',
  colonnesPupitres: {
    chant: 'Chant',
    piano: 'Piano',
    basse: 'Basse',
    batterie: 'Batterie',
    guitare: 'Guitare',
    vents: 'Vents',
  },
}

describe('extraireListe', () => {
  it('extrait 2 morceaux avec membres et postes cherchés', () => {
    const rows: unknown[][] = [
      ['Morceau', 'Auteur', 'Style', 'Tona', 'Resp', 'Chant', 'Piano', 'Basse', 'Batterie', 'Guitare', 'Vents'],
      ['Love', 'Nat King Cole', 'Jazz', '', 'Emma', 'Emma (B), Beate (B)', 'Colette', 'Agnès', 'Autre batteur', 'Daniel', 'Pascal'],
      ['Oye Como Va', 'Tito Puente', 'Latin', 'A-', 'Sergio', 'Jocelyne', 'Sergio', 'Christophe', 'Pierre (SIG)', 'CHERCHE', 'CHERCHE'],
    ]
    const { groupes, warnings } = extraireListe(rows, MAPPING_DEFAUT)
    expect(warnings).toEqual([])
    expect(groupes).toHaveLength(2)
    expect(groupes[0].nom).toBe('Love')
    expect(groupes[0].m1).toBe('Love / Nat King Cole')
    expect(groupes[0].resp).toBe('Emma')
    expect(groupes[0].membres).toContain('Emma (B) (chant)')
    expect(groupes[0].membres).toContain('Colette (piano)')
    expect(groupes[0].cherche).toBe('')
    expect(groupes[1].cherche.split(', ').sort()).toEqual(['guitare', 'vents'])
  })

  it("ignore les cellules `NON` (pas de pupitre)", () => {
    const rows: unknown[][] = [
      ['Morceau', 'Chant', 'Piano'],
      ['Duo', 'Alice', 'NON'],
    ]
    const { groupes } = extraireListe(rows, {
      colonneMorceau: 'Morceau',
      colonnesPupitres: { chant: 'Chant', piano: 'Piano' },
    })
    expect(groupes[0].membres).toEqual(['Alice (chant)'])
  })

  it("préserve une précision d'instrument entre parenthèses (Colette (contrebasse))", () => {
    const rows: unknown[][] = [
      ['Morceau', 'Basse'],
      ['Jazz', 'Colette (contrebasse)'],
    ]
    const { groupes } = extraireListe(rows, {
      colonneMorceau: 'Morceau',
      colonnesPupitres: { basse: 'Basse' },
    })
    expect(groupes[0].membres).toEqual(['Colette (contrebasse)'])
  })

  it('ignore les lignes sans titre', () => {
    const rows: unknown[][] = [
      ['Morceau', 'Chant'],
      ['A', 'Alice'],
      ['', 'Bob'],
      ['B', 'Bob'],
    ]
    const { groupes } = extraireListe(rows, {
      colonneMorceau: 'Morceau',
      colonnesPupitres: { chant: 'Chant' },
    })
    expect(groupes.map((g) => g.nom)).toEqual(['A', 'B'])
  })

  it('avertit quand une colonne pupitre est absente', () => {
    const rows: unknown[][] = [
      ['Morceau', 'Chant'],
      ['A', 'Alice'],
    ]
    const { groupes, warnings } = extraireListe(rows, {
      colonneMorceau: 'Morceau',
      colonnesPupitres: { chant: 'Chant', piano: 'Piano (absent)' },
    })
    expect(groupes).toHaveLength(1)
    expect(warnings.some((w) => w.includes('Piano (absent)'))).toBe(true)
  })

  it("échoue proprement quand la colonne morceau n'existe pas", () => {
    const rows: unknown[][] = [
      ['Autre', 'Chant'],
      ['A', 'Alice'],
    ]
    const { groupes, warnings } = extraireListe(rows, {
      colonneMorceau: 'Morceau',
      colonnesPupitres: { chant: 'Chant' },
    })
    expect(groupes).toEqual([])
    expect(warnings.some((w) => w.includes('Morceau'))).toBe(true)
  })

  it('tolère plusieurs séparateurs (virgule / point-virgule / retour ligne)', () => {
    const rows: unknown[][] = [
      ['Morceau', 'Chant'],
      ['A', 'Alice, Bob; Carol\nDan'],
    ]
    const { groupes } = extraireListe(rows, {
      colonneMorceau: 'Morceau',
      colonnesPupitres: { chant: 'Chant' },
    })
    expect(groupes[0].membres).toEqual(['Alice (chant)', 'Bob (chant)', 'Carol (chant)', 'Dan (chant)'])
  })
})
