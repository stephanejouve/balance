import { describe, expect, it } from 'vitest'
import type { MappingListe } from './liste-adapter'
import type { MappingProposes } from './proposes-adapter'
import type { MappingStagiaires } from './stagiaires-adapter'
import { construireTemplate } from './excel-template'

const mappingListe: MappingListe = {
  colonneMorceau: 'Morceau',
  colonneAuteur: 'Auteur',
  colonneStyle: 'Style',
  colonneTona: 'Tona',
  colonneResp: 'Resp',
  colonneCherche: 'Cherche',
  colonnesPupitres: {
    chant: 'Chant',
    piano: 'Piano',
    basse: 'Basse',
    batterie: 'Batterie',
    guitare: 'Guitare',
    vents: 'Vents',
  },
}

const mappingStagiaires: MappingStagiaires = {
  colonneNom: 'Nom',
  colonnePupitrePrincipal: 'Pupitre',
  colonnePupitresAdditionnels: 'Pupitres additionnels',
  colonneInstrument: 'Instrument',
  colonneLateralite: 'Latéralité',
  colonneIndispos: 'Indispos',
}

const mappingProposes: MappingProposes = {
  colonneMorceau: 'Morceau',
  colonneMembres: 'Membres',
  colonneDate: 'Date',
  colonneDebut: 'Début',
  colonneFin: 'Fin',
  colonneSalle: 'Salle',
}

describe('construireTemplate', () => {
  it('produit 3 onglets Liste / Stagiaires / Proposés', () => {
    const sheets = construireTemplate({
      liste: mappingListe,
      stagiaires: mappingStagiaires,
      proposes: mappingProposes,
    })
    expect(sheets.map((s) => s.sheet)).toEqual(['Liste', 'Stagiaires', 'Proposés'])
  })

  it('onglet Liste : en-tête en gras + 12 colonnes ordinaires + 6 pupitres', () => {
    const sheets = construireTemplate({
      liste: mappingListe,
      stagiaires: mappingStagiaires,
      proposes: mappingProposes,
    })
    const liste = sheets[0]!
    const header = liste.data[0]!
    // 6 colonnes ordinaires + 6 pupitres = 12 colonnes attendues
    expect(header).toHaveLength(12)
    expect(header[0]).toEqual({ value: 'Morceau', fontWeight: 'bold' })
    expect(header[6]).toEqual({ value: 'Chant', fontWeight: 'bold' })
    expect(header[11]).toEqual({ value: 'Vents', fontWeight: 'bold' })
  })

  it('onglet Liste : au moins une ligne d\'exemple concret (Love)', () => {
    const sheets = construireTemplate({
      liste: mappingListe,
      stagiaires: mappingStagiaires,
      proposes: mappingProposes,
    })
    const liste = sheets[0]!
    expect(liste.data.length).toBeGreaterThanOrEqual(3) // header + 2 exemples
    const ligne1 = liste.data[1]!
    // 1re cellule = Morceau (Love)
    expect(ligne1[0]?.value).toBe('Love')
    // En-tête n'est pas en gras sur les données
    expect(ligne1[0]?.fontWeight).toBeUndefined()
  })

  it("onglet Stagiaires : en-tête + 6 colonnes + exemples avec discriminant", () => {
    const sheets = construireTemplate({
      liste: mappingListe,
      stagiaires: mappingStagiaires,
      proposes: mappingProposes,
    })
    const stag = sheets[1]!
    const header = stag.data[0]!
    expect(header).toHaveLength(6)
    expect(header[0]?.value).toBe('Nom')
    // Vérifie qu'un exemple montre le discriminant `(B)` (cas nominal du README)
    const noms = stag.data.slice(1).map((r) => r[0]?.value)
    expect(noms.some((n) => typeof n === 'string' && n.includes('(B)'))).toBe(true)
  })

  it("onglet Proposés : en-tête 6 col + Blowin sur 2 séances (fusion morceau)", () => {
    const sheets = construireTemplate({
      liste: mappingListe,
      stagiaires: mappingStagiaires,
      proposes: mappingProposes,
    })
    const prop = sheets[2]!
    const header = prop.data[0]!
    expect(header).toHaveLength(6)
    // Deux lignes avec le même titre montrent la sémantique de fusion à l'import
    const morceaux = prop.data.slice(1).map((r) => r[0]?.value)
    const blowin = morceaux.filter((m) => m === 'Blowin in the wind').length
    expect(blowin).toBe(2)
  })

  it('respecte un mapping partiel (sans colonneAuteur, sans colonneSalle)', () => {
    const listePartiel: MappingListe = {
      colonneMorceau: 'Morceau',
      colonnesPupitres: { chant: 'Chant', piano: 'Piano' },
    }
    const proposesPartiel: MappingProposes = {
      colonneMorceau: 'Morceau',
      colonneMembres: 'Membres',
      colonneDate: 'Date',
      colonneDebut: 'Début',
      colonneFin: 'Fin',
      // pas de colonneSalle
    }
    const sheets = construireTemplate({
      liste: listePartiel,
      stagiaires: mappingStagiaires,
      proposes: proposesPartiel,
    })
    // Liste : 1 morceau + 2 pupitres = 3 colonnes
    expect(sheets[0]!.data[0]).toHaveLength(3)
    // Proposés : 5 colonnes obligatoires seulement
    expect(sheets[2]!.data[0]).toHaveLength(5)
  })
})
