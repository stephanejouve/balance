import { describe, expect, it } from 'vitest'
import type { MappingStagiaires } from './stagiaires-adapter'
import { extraireStagiaires, parserIndispoLibre } from './stagiaires-adapter'

const MAPPING: MappingStagiaires = {
  colonneNom: 'Nom',
  colonnePupitrePrincipal: 'Pupitre',
  colonnePupitresAdditionnels: 'Pupitres additionnels',
  colonneInstrument: 'Instrument',
  colonneLateralite: 'Latéralité',
  colonneIndispos: 'Indispos',
}

describe('extraireStagiaires', () => {
  it('extrait un stagiaire monopupitre', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre'],
      ['Alice', 'chant'],
    ]
    const { personnes, warnings } = extraireStagiaires(rows, MAPPING)
    expect(warnings).toEqual([])
    expect(personnes).toHaveLength(1)
    expect(personnes[0].nom).toBe('Alice')
    expect(personnes[0].instruments).toEqual([{ pupitre: 'chant', precision: undefined }])
    expect(personnes[0].indispos).toEqual([])
  })

  it('extrait un discriminant depuis le nom (Emma (B))', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre'],
      ['Emma (B)', 'chant'],
    ]
    const { personnes } = extraireStagiaires(rows, MAPPING)
    expect(personnes[0].nom).toBe('Emma')
    expect(personnes[0].discriminant).toBe('(B)')
    expect(personnes[0].id).toBe('emma-b')
  })

  it('gère la polyvalence via « Pupitres additionnels »', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre', 'Pupitres additionnels'],
      ['Prune', 'piano', 'basse, guitare'],
    ]
    const { personnes } = extraireStagiaires(rows, MAPPING)
    expect(personnes[0].instruments.map((i) => i.pupitre)).toEqual(['piano', 'basse', 'guitare'])
  })

  it('reconnaît la latéralité des batteurs', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre', 'Latéralité'],
      ['Zoé', 'batterie', 'gauchère'], // pas standard
      ['Ben', 'batterie', 'gauche'],
      ['Dan', 'batterie', 'D'],
    ]
    const { personnes, warnings } = extraireStagiaires(rows, MAPPING)
    expect(personnes[0].lateralite).toBeUndefined()
    expect(warnings.some((w) => w.includes('gauchère'))).toBe(true)
    expect(personnes[1].lateralite).toBe('gaucher')
    expect(personnes[2].lateralite).toBe('droitier')
  })

  it('signale les doublons de nom (même id)', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre'],
      ['Alice', 'chant'],
      ['Alice', 'piano'],
    ]
    const { personnes, warnings } = extraireStagiaires(rows, MAPPING)
    expect(personnes).toHaveLength(1)
    expect(warnings.some((w) => w.includes('doublon'))).toBe(true)
  })
})

describe('parserIndispoLibre', () => {
  it('extrait un jour de la semaine', () => {
    const ind = parserIndispoLibre('mercredi après-midi')!
    expect(ind.jours).toEqual(['mercredi'])
    expect(ind.motif).toBe('mercredi après-midi')
  })

  it('extrait une plage horaire au format 9h-10h', () => {
    const ind = parserIndispoLibre('9h-10h chant')!
    expect(ind.debut).toBe('09:00')
    expect(ind.fin).toBe('10:00')
    expect(ind.roles).toEqual(['chant'])
  })

  it('extrait une plage horaire au format HH:MM-HH:MM', () => {
    const ind = parserIndispoLibre('mardi 14:30 - 16:00')!
    expect(ind.jours).toEqual(['mardi'])
    expect(ind.debut).toBe('14:30')
    expect(ind.fin).toBe('16:00')
  })

  it("garde le texte brut dans motif quand rien n'est reconnu", () => {
    const ind = parserIndispoLibre('convalescence')!
    expect(ind.jours).toEqual([])
    expect(ind.debut).toBeUndefined()
    expect(ind.fin).toBeUndefined()
    expect(ind.motif).toBe('convalescence')
  })

  it('renvoie null pour un texte vide', () => {
    expect(parserIndispoLibre('')).toBeNull()
    expect(parserIndispoLibre('   ')).toBeNull()
  })
})
