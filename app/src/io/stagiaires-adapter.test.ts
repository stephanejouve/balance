import { describe, expect, it } from 'vitest'
import type { MappingStagiaires } from './stagiaires-adapter'
import { extraireStagiaires, parserIndispoLibre } from './stagiaires-adapter'

/** Mapping complet (utilisé quand toutes les colonnes optionnelles sont
 *  présentes dans le classeur — sinon un warning est émis par colonne
 *  configurée mais introuvable). */
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
    const { personnes, warnings } = extraireStagiaires(rows, {
      colonneNom: 'Nom',
      colonnePupitrePrincipal: 'Pupitre',
    })
    expect(warnings).toEqual([])
    expect(personnes).toHaveLength(1)
    expect(personnes[0].nom).toBe('Alice')
    expect(personnes[0].instruments).toEqual([
      { pupitre: 'chant', precision: undefined, lourd: false },
    ])
    expect(personnes[0].indispos).toEqual([])
  })

  it('extrait un discriminant depuis le nom (Emma (B))', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre'],
      ['Emma (B)', 'chant'],
    ]
    const { personnes } = extraireStagiaires(rows, { colonneNom: 'Nom', colonnePupitrePrincipal: 'Pupitre' })
    expect(personnes[0].nom).toBe('Emma')
    expect(personnes[0].discriminant).toBe('(B)')
    expect(personnes[0].id).toBe('emma-b')
  })

  it('gère la polyvalence via « Pupitres additionnels »', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre', 'Pupitres additionnels'],
      ['Prune', 'piano', 'basse, guitare'],
    ]
    const { personnes } = extraireStagiaires(rows, {
      colonneNom: 'Nom',
      colonnePupitrePrincipal: 'Pupitre',
      colonnePupitresAdditionnels: 'Pupitres additionnels',
    })
    expect(personnes[0].instruments.map((i) => i.pupitre)).toEqual(['piano', 'basse', 'guitare'])
  })

  it('reconnaît la latéralité des batteurs', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre', 'Latéralité'],
      ['Zoé', 'batterie', 'gauchère'], // pas standard
      ['Ben', 'batterie', 'gauche'],
      ['Dan', 'batterie', 'D'],
    ]
    const { personnes, warnings } = extraireStagiaires(rows, {
      colonneNom: 'Nom',
      colonnePupitrePrincipal: 'Pupitre',
      colonneLateralite: 'Latéralité',
    })
    // La latéralité vit sur l'instrument batterie (pas sur la personne).
    expect(personnes[0].instruments[0].lateralite).toBeUndefined()
    expect(warnings.some((w) => w.includes('gauchère'))).toBe(true)
    expect(personnes[1].instruments[0].lateralite).toBe('gaucher')
    expect(personnes[2].instruments[0].lateralite).toBe('droitier')
  })

  it('préserve la latéralité sur un non-batteur (fallback instrument[0], signalé par cohérence)', () => {
    // Fix Stéphane 2026-09-01 (task #47 cas L) : ne plus stripper
    // silencieusement — le signalement « latéralité sur non-batteur »
    // est produit par `domain/coherence.ts`, pas ici. L'adapter préserve
    // l'info pour que le check aval puisse l'attraper.
    const rows: unknown[][] = [
      ['Nom', 'Pupitre', 'Latéralité'],
      ['Emma', 'chant', 'droitier'],
    ]
    const { personnes } = extraireStagiaires(rows, {
      colonneNom: 'Nom',
      colonnePupitrePrincipal: 'Pupitre',
      colonneLateralite: 'Latéralité',
    })
    expect(personnes[0].instruments[0].lateralite).toBe('droitier')
  })

  it('signale les doublons de nom (même id)', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre'],
      ['Alice', 'chant'],
      ['Alice', 'piano'],
    ]
    const { personnes, warnings } = extraireStagiaires(rows, {
      colonneNom: 'Nom',
      colonnePupitrePrincipal: 'Pupitre',
    })
    expect(personnes).toHaveLength(1)
    expect(warnings.some((w) => w.includes('doublon'))).toBe(true)
  })
})

describe('extraireStagiaires — validation (nouveau)', () => {
  it("warn quand une colonne optionnelle configurée est absente de l'en-tête", () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre'], // pas de « Latéralité » ni « Indispos »
      ['Alice', 'chant'],
    ]
    const { warnings } = extraireStagiaires(rows, MAPPING)
    expect(warnings.some((w) => w.includes('Latéralité') && w.includes('introuvable'))).toBe(true)
    expect(warnings.some((w) => w.includes('Indispos') && w.includes('introuvable'))).toBe(true)
    // Colonnes présentes → pas de warning
    expect(warnings.some((w) => w.includes('« Pupitre »') && w.includes('introuvable'))).toBe(false)
  })

  it('warn quand un pupitre n\'est pas dans PUPITRES_DEFAULTS (typo)', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre'],
      ['Alice', 'guitar'], // typo — attendu 'guitare'
    ]
    const { personnes, warnings } = extraireStagiaires(rows, {
      colonneNom: 'Nom',
      colonnePupitrePrincipal: 'Pupitre',
    })
    expect(warnings.some((w) => w.includes('guitar') && w.includes('non reconnu'))).toBe(true)
    // La personne est toujours créée — la validation est un warning, pas un blocage
    expect(personnes).toHaveLength(1)
  })

  it('accepte les pupitres customs via `pupitresValides`', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre'],
      ['Alice', 'accordeon'],
    ]
    const { warnings } = extraireStagiaires(
      rows,
      { colonneNom: 'Nom', colonnePupitrePrincipal: 'Pupitre' },
      ['chant', 'piano', 'basse', 'batterie', 'guitare', 'vents', 'accordeon'],
    )
    expect(warnings.some((w) => w.includes('non reconnu'))).toBe(false)
  })

  it('warn stagiaire sans aucun pupitre déclaré', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre'],
      ['Alice', ''],
    ]
    const { personnes, warnings } = extraireStagiaires(rows, {
      colonneNom: 'Nom',
      colonnePupitrePrincipal: 'Pupitre',
    })
    expect(warnings.some((w) => w.includes('aucun pupitre'))).toBe(true)
    // La personne est créée sans instrument — le solveur ne pourra pas la placer
    expect(personnes[0].instruments).toEqual([])
  })

  it('marque `lourd: false` par défaut sur chaque instrument créé', () => {
    const rows: unknown[][] = [
      ['Nom', 'Pupitre', 'Pupitres additionnels'],
      ['Prune', 'piano', 'basse'],
    ]
    const { personnes } = extraireStagiaires(rows, {
      colonneNom: 'Nom',
      colonnePupitrePrincipal: 'Pupitre',
      colonnePupitresAdditionnels: 'Pupitres additionnels',
    })
    expect(personnes[0].instruments.every((i) => i.lourd === false)).toBe(true)
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

// ─── Warning « indisponibilité non interprétable » (bug smoke #1) ─────────

describe('extraireStagiaires — warning indispo non interprétable', () => {
  it('émet un warning explicite quand une indispo n\'a ni jour ni horaire ni rôle', () => {
    const rows = [
      ['Nom', 'Pupitre', 'Latéralité', 'Indispos'],
      ['Olivier (B)', 'basse', '', 'convalescence'],
    ]
    const { personnes, warnings } = extraireStagiaires(rows, MAPPING)
    // La personne est bien créée avec son indispo (conservée pour affichage)
    expect(personnes[0].indispos).toHaveLength(1)
    expect(personnes[0].indispos[0].motif).toBe('convalescence')
    // Warning explicite « ignorée dans le calcul » (arbitrage Stéphane
    // 2026-09-02 : dire ce qui a été fait, pas seulement ce qui manque).
    const w = warnings.find((x) => x.includes('non interprétable'))
    expect(w).toBeDefined()
    expect(w).toContain('ignorée dans le calcul')
    expect(w).toContain('convalescence')
    expect(w).toContain('à vérifier manuellement')
  })

  it('n\'émet PAS de warning quand l\'indispo est interprétable (« absent lundi »)', () => {
    // Nuance critique Stéphane : jours seuls, sans horaire = interprétable.
    const rows = [
      ['Nom', 'Pupitre', 'Latéralité', 'Indispos'],
      ['Alice', 'chant', '', 'lundi'],
    ]
    const { warnings } = extraireStagiaires(rows, MAPPING)
    expect(warnings.some((w) => w.includes('non interprétable'))).toBe(false)
  })
})
