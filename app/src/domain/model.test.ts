import { describe, expect, it } from 'vitest'
import {
  Groupe,
  Inscriptions,
  Lieu,
  Personne,
  Session,
  libellePersonne,
  slug,
} from './model'

describe('Personne', () => {
  it('accepte les defaults minimaux', () => {
    const p = Personne.parse({ id: 'colette', nom: 'Colette' })
    expect(p.role).toBe('musicien')
    expect(p.instruments).toEqual([])
    expect(p.discriminant).toBe('')
    expect(p.indispos).toEqual([])
  })

  it("valide qu'un instrument porte au moins un pupitre", () => {
    const p = Personne.parse({
      id: 'c',
      nom: 'Colette',
      instruments: [{ pupitre: 'piano' }, { pupitre: 'basse', precision: 'contrebasse' }],
    })
    expect(p.instruments).toHaveLength(2)
    expect(p.instruments[1].precision).toBe('contrebasse')
  })

  it('rejette une latéralité inconnue', () => {
    expect(() =>
      Personne.parse({ id: 'g', nom: 'Gaël', lateralite: 'ambidextre' as never }),
    ).toThrow()
  })
})

describe('libellePersonne', () => {
  it('assemble le nom et le discriminant', () => {
    expect(libellePersonne(Personne.parse({ id: 'p', nom: 'Pierre', discriminant: '(SIG)' })))
      .toBe('Pierre (SIG)')
    expect(libellePersonne(Personne.parse({ id: 'c', nom: 'Colette' })))
      .toBe('Colette')
  })
})

describe('Lieu', () => {
  it('accepte un lieu minimal avec une salle', () => {
    const lieu = Lieu.parse({
      id: 'ma-maison',
      nom: 'La Maison',
      salles: [{ id: 's1', nom: 'Salon', jauge: 5 }],
    })
    expect(lieu.pupitres).toContain('chant')
    expect(lieu.salles[0].actif).toBe(true)
    expect(lieu.salles[0].restrictions).toEqual([])
  })
})

describe('Session', () => {
  it('valide les dates ISO', () => {
    expect(() =>
      Session.parse({
        id: 's5',
        nom: 'Session 5',
        lieu_id: 'lieu-x',
        date_debut: '24/08/2026',
        date_fin: '2026-08-28',
        date_butoir: '2026-08-28',
      }),
    ).toThrow()
  })

  it('applique les defaults', () => {
    const s = Session.parse({
      id: 's5',
      nom: 'Session 5',
      lieu_id: 'x',
      date_debut: '2026-08-23',
      date_fin: '2026-08-28',
      date_butoir: '2026-08-28',
    })
    expect(s.repetitions_visees).toBe(3)
    expect(s.repetitions_min).toBe(2)
    expect(s.plafond_morceaux).toBe(13)
    expect(s.butoir_heure).toBe('23:59')
  })
})

describe('Groupe', () => {
  it('accepte un groupe sans membre', () => {
    const g = Groupe.parse({ id: 'g1', titre: 'Sans titre' })
    expect(g.membres).toEqual([])
    expect(g.postes_cherches).toEqual([])
  })
})

describe('Inscriptions', () => {
  it('accepte une session vide', () => {
    const i = Inscriptions.parse({ session_id: 's5' })
    expect(i.personnes).toEqual([])
    expect(i.groupes).toEqual([])
  })
})

describe('slug', () => {
  it('normalise accents et espaces', () => {
    expect(slug('Emmanuelle (B)')).toBe('emmanuelle-b')
    expect(slug('Élisabeth')).toBe('elisabeth')
    expect(slug('02 · For Me Formidable')).toBe('02-for-me-formidable')
    expect(slug("L'Espérance")).toBe('l-esperance')
  })
})
