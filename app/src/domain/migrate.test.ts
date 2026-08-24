import { describe, expect, it } from 'vitest'
import { parseLegacyInscriptions } from './legacy'
import { migrerInscriptions, pupitreDe } from './migrate'
import fixtureRaw from '../fixtures/apero_mercredi.json'

describe('pupitreDe', () => {
  it('classe les instruments courants', () => {
    expect(pupitreDe('chant')).toEqual({ pupitre: 'chant' })
    expect(pupitreDe('piano')).toEqual({ pupitre: 'piano' })
    expect(pupitreDe('basse')).toEqual({ pupitre: 'basse' })
    expect(pupitreDe('batterie')).toEqual({ pupitre: 'batterie' })
    expect(pupitreDe('guitare')).toEqual({ pupitre: 'guitare' })
    expect(pupitreDe('vents')).toEqual({ pupitre: 'vents' })
  })

  it('classe les instruments avec précision', () => {
    expect(pupitreDe('contrebasse')).toEqual({ pupitre: 'basse', precision: 'contrebasse' })
    expect(pupitreDe('clarinette basse')).toEqual({
      pupitre: 'vents',
      precision: 'clarinette basse',
    })
    expect(pupitreDe('sax sop')).toEqual({ pupitre: 'vents', precision: 'sax sop' })
    expect(pupitreDe('flûte')).toEqual({ pupitre: 'vents', precision: 'flûte' })
  })
})

describe('migrerInscriptions', () => {
  const legacy = parseLegacyInscriptions(fixtureRaw)
  const canonique = migrerInscriptions(legacy, 'session-5')

  it('ramène tous les groupes', () => {
    expect(canonique.groupes).toHaveLength(13)
    expect(canonique.groupes[0].titre).toContain('Sur La Place')
  })

  it("préserve le discriminant d'Emmanuelle (B) et Beate (B)", () => {
    const emma = canonique.personnes.find((p) => p.nom === 'Emmanuelle' && p.discriminant === '(B)')
    const beate = canonique.personnes.find((p) => p.nom === 'Beate' && p.discriminant === '(B)')
    expect(emma).toBeDefined()
    expect(beate).toBeDefined()
    expect(emma!.id).toBe('emmanuelle-b')
    expect(beate!.id).toBe('beate-b')
  })

  it('distingue Pierre (SIG) et Pierre (L) comme deux personnes', () => {
    const sig = canonique.personnes.find((p) => p.discriminant === '(SIG)')
    const l = canonique.personnes.find((p) => p.discriminant === '(L)')
    expect(sig?.nom).toBe('Pierre')
    expect(l?.nom).toBe('Pierre')
    expect(sig?.id).not.toBe(l?.id)
  })

  it('regroupe Colette en une seule personne polyvalente (piano + basse)', () => {
    const colette = canonique.personnes.find((p) => p.nom === 'Colette' && !p.discriminant)
    expect(colette).toBeDefined()
    const pupitres = new Set(colette!.instruments.map((i) => i.pupitre))
    expect(pupitres).toContain('piano')
    expect(pupitres).toContain('basse')
  })

  it('regroupe Sylvain avec chant + guitare (polyvalence cross-groupes)', () => {
    const sylvain = canonique.personnes.find((p) => p.nom === 'Sylvain')
    expect(sylvain).toBeDefined()
    const pupitres = new Set(sylvain!.instruments.map((i) => i.pupitre))
    expect(pupitres).toContain('chant')
    expect(pupitres).toContain('guitare')
  })

  it("dépose les indispos legacy sur les personnes concernées avec le rôle 'chant'", () => {
    const jocelyne = canonique.personnes.find((p) => p.nom === 'Jocelyne')
    expect(jocelyne).toBeDefined()
    expect(jocelyne!.indispos.length).toBeGreaterThan(0)
    const ind = jocelyne!.indispos[0]
    expect(ind.debut).toBe('09:00')
    expect(ind.roles).toEqual(['chant'])
  })

  it('extrait les postes cherchés du champ « cherche »', () => {
    // groupe 01 · Sur La Place : "guitare (cherche guitare sèche)"
    const surLaPlace = canonique.groupes.find((g) => g.titre.startsWith('Sur La Place'))
    expect(surLaPlace?.postes_cherches).toEqual(['guitare'])
    // groupe 05 · Oye Como Va : "guitare, vents"
    const oye = canonique.groupes.find((g) => g.titre.startsWith('Oye Como Va'))
    expect(oye?.postes_cherches).toEqual(expect.arrayContaining(['guitare', 'vents']))
  })

  it('conserve Pierre-yves 2× dans Boys Don\'t Cry (chant + guitare, même personne)', () => {
    const boys = canonique.groupes.find((g) => g.titre.toLowerCase().includes('boys'))
    expect(boys).toBeDefined()
    const py = boys!.membres.filter((m) => m.personne_id === 'pierre-yves')
    // le prototype dédoublonne par personne dans le solveur, mais côté modèle
    // on conserve les deux mentions pour préserver l'info instrument.
    expect(py.length).toBe(2)
    const pupitres = new Set(py.map((m) => m.pupitre))
    expect(pupitres).toContain('chant')
    expect(pupitres).toContain('guitare')
  })

  it('substitue Autre batteur pour Gaël dans Love (patch P0 conservé)', () => {
    const love = canonique.groupes.find((g) => g.titre.startsWith('Love'))
    expect(love).toBeDefined()
    const batteur = love!.membres.find((m) => m.pupitre === 'batterie')
    expect(batteur?.personne_id).toBe('autre-batteur')
  })
})
