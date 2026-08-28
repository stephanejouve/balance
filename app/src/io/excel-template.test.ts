import { describe, expect, it } from 'vitest'
import { construireTemplate } from './excel-template'
import { MAPPING_LISTE_DEFAUT, extraireListe } from './liste-adapter'
import type { MappingListe } from './liste-adapter'
import { MAPPING_PROPOSES_DEFAUT } from './proposes-adapter'
import { MAPPING_STAGIAIRES_DEFAUT, extraireStagiaires } from './stagiaires-adapter'

const MAPPINGS = {
  liste: MAPPING_LISTE_DEFAUT,
  stagiaires: MAPPING_STAGIAIRES_DEFAUT,
  proposes: MAPPING_PROPOSES_DEFAUT,
}

/** Extrait `[value, value…]` d'une ligne de cellules pour se rapprocher du
 *  format Row `unknown[]` que consomment les adaptateurs à l'import. */
function ligneValeurs(cells: Array<{ value: string | number | null }>): unknown[] {
  return cells.map((c) => c.value)
}

describe('construireTemplate — 4 onglets, en-têtes seuls sur les onglets de données', () => {
  it('produit 4 onglets dans l\'ordre : Liste / Stagiaires / Proposés / Mode d\'emploi', () => {
    const sheets = construireTemplate(MAPPINGS)
    expect(sheets.map((s) => s.sheet)).toEqual([
      'Liste',
      'Stagiaires',
      'Proposés',
      "Mode d'emploi",
    ])
  })

  it("onglet Liste : uniquement l'en-tête en gras — pas de lignes d'exemple", () => {
    const sheets = construireTemplate(MAPPINGS)
    const liste = sheets[0]!
    expect(liste.data).toHaveLength(1)
    expect(liste.data[0].every((c) => c.fontWeight === 'bold')).toBe(true)
  })

  it("onglet Stagiaires : uniquement l'en-tête — pas de lignes d'exemple", () => {
    const sheets = construireTemplate(MAPPINGS)
    const stag = sheets[1]!
    expect(stag.data).toHaveLength(1)
  })

  it("onglet Proposés : uniquement l'en-tête — pas de lignes d'exemple", () => {
    const sheets = construireTemplate(MAPPINGS)
    const prop = sheets[2]!
    expect(prop.data).toHaveLength(1)
  })

  it("onglet Mode d'emploi : conventions présentes (NON, CHERCHE, discriminant, indispos)", () => {
    const sheets = construireTemplate(MAPPINGS)
    const mode = sheets[3]!
    const texte = mode.data.map((r) => r.map((c) => c.value).join(' | ')).join('\n')
    expect(texte).toContain('NON')
    expect(texte).toContain('CHERCHE')
    expect(texte).toContain('Colette (contrebasse)')
    expect(texte).toContain('Pierre (SIG)')
    expect(texte).toContain('mercredi 09h-10h chant')
    expect(texte).toContain('convalescence')
  })
})

describe('construireTemplate — pupitres itérés depuis le mapping (pas figés)', () => {
  it('respecte l\'ordre canonique du mapping par défaut', () => {
    const sheets = construireTemplate(MAPPINGS)
    const header = sheets[0]!.data[0]!
    const pupitres = header.slice(6).map((c) => c.value)
    expect(pupitres).toEqual(['Chant', 'Piano', 'Basse', 'Batterie', 'Guitare', 'Vents'])
  })

  it('supporte un pupitre custom d\'un lieu qui ajoute « accordéon »', () => {
    const listeAvecAccordeon: MappingListe = {
      ...MAPPING_LISTE_DEFAUT,
      colonnesPupitres: {
        ...MAPPING_LISTE_DEFAUT.colonnesPupitres,
        accordeon: 'Accordéon',
      } as MappingListe['colonnesPupitres'],
    }
    const sheets = construireTemplate({ ...MAPPINGS, liste: listeAvecAccordeon })
    const header = sheets[0]!.data[0]!.map((c) => c.value)
    expect(header).toContain('Accordéon')
  })

  it("ne sort que les pupitres présents dans le mapping (2 seulement)", () => {
    const listePartiel: MappingListe = {
      colonneMorceau: 'Morceau',
      colonnesPupitres: { piano: 'Piano', vents: 'Vents' },
    }
    const sheets = construireTemplate({ ...MAPPINGS, liste: listePartiel })
    const header = sheets[0]!.data[0]!.map((c) => c.value)
    expect(header).toEqual(['Morceau', 'Piano', 'Vents'])
  })
})

describe('construireTemplate — aller-retour (générer → remplir → importer → 0 warning)', () => {
  it('Liste : template rempli programmatiquement se réimporte sans warning', () => {
    // Le vrai test qui verrouille la promesse du modèle. Si demain
    // quelqu'un renomme une colonne dans MAPPING_LISTE_DEFAUT sans
    // toucher au générateur, ce test tombe rouge — plutôt que la
    // surprise devant l'organisateur au premier import.
    const sheets = construireTemplate(MAPPINGS)
    const header = ligneValeurs(sheets[0]!.data[0]!) as string[]
    const col = (nom: string): number => header.indexOf(nom)
    const ligne1: unknown[] = header.map(() => null)
    ligne1[col('Morceau')] = 'Blue Bossa'
    ligne1[col('Style')] = 'Latin'
    ligne1[col('Resp')] = 'Alice'
    ligne1[col('Chant')] = 'Alice'
    ligne1[col('Piano')] = 'Bob'
    ligne1[col('Basse')] = 'Carol'
    ligne1[col('Batterie')] = 'Dan'
    const ligne2: unknown[] = header.map(() => null)
    ligne2[col('Morceau')] = 'So What'
    ligne2[col('Piano')] = 'Bob'
    ligne2[col('Basse')] = 'Carol'

    const rows: unknown[][] = [header, ligne1, ligne2]
    const { groupes, warnings } = extraireListe(rows, MAPPING_LISTE_DEFAUT)
    expect(warnings).toEqual([])
    expect(groupes).toHaveLength(2)
    expect(groupes[0].nom).toBe('Blue Bossa')
    expect(groupes[1].nom).toBe('So What')
  })

  it('Stagiaires : template rempli programmatiquement se réimporte sans warning', () => {
    const sheets = construireTemplate(MAPPINGS)
    const header = ligneValeurs(sheets[1]!.data[0]!) as string[]
    const col = (nom: string): number => header.indexOf(nom)
    const ligne1: unknown[] = header.map(() => null)
    ligne1[col('Nom')] = 'Alice'
    ligne1[col('Pupitre')] = 'chant'
    const ligne2: unknown[] = header.map(() => null)
    ligne2[col('Nom')] = 'Bob'
    ligne2[col('Pupitre')] = 'piano'
    ligne2[col('Pupitres additionnels')] = 'basse'

    const rows: unknown[][] = [header, ligne1, ligne2]
    const { personnes, warnings } = extraireStagiaires(rows, MAPPING_STAGIAIRES_DEFAUT)
    expect(warnings).toEqual([])
    expect(personnes).toHaveLength(2)
    expect(personnes[0].nom).toBe('Alice')
    expect(personnes[1].instruments.map((i) => i.pupitre)).toEqual(['piano', 'basse'])
  })
})
