import { describe, expect, it } from 'vitest'
import {
  Groupe,
  Inscriptions,
  Lieu,
  Personne,
  Refus,
  Session,
  libellePersonne,
  nouvelIdGroupe,
  nouvelIdImpose,
  nouvelIdPersonne,
  nouvelIdSalle,
  slug,
} from './model'

describe('Personne', () => {
  it('accepte les defaults minimaux', () => {
    const p = Personne.parse({ id: 'colette', nom: 'Prune' })
    expect(p.role).toBe('musicien')
    expect(p.instruments).toEqual([])
    expect(p.discriminant).toBe('')
    expect(p.indispos).toEqual([])
  })

  it("valide qu'un instrument porte au moins un pupitre", () => {
    const p = Personne.parse({
      id: 'c',
      nom: 'Prune',
      instruments: [{ pupitre: 'piano' }, { pupitre: 'basse', precision: 'contrebasse' }],
    })
    expect(p.instruments).toHaveLength(2)
    expect(p.instruments[1].precision).toBe('contrebasse')
  })

  it('rejette une latéralité inconnue', () => {
    expect(() =>
      Personne.parse({ id: 'g', nom: 'Gaspard', lateralite: 'ambidextre' as never }),
    ).toThrow()
  })
})

describe('libellePersonne', () => {
  it('assemble le nom et le discriminant', () => {
    expect(libellePersonne(Personne.parse({ id: 'p', nom: 'Zoltan', discriminant: '(SIG)' })))
      .toBe('Zoltan (SIG)')
    expect(libellePersonne(Personne.parse({ id: 'c', nom: 'Prune' })))
      .toBe('Prune')
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
    expect(s.butoir_apero_heure).toBe('23:59')
    expect(s.butoir_vendredi_heure).toBe('23:59')
  })
})

describe('Groupe', () => {
  it('accepte un groupe sans membre', () => {
    const g = Groupe.parse({ id: 'g1', titre: 'Sans titre' })
    expect(g.membres).toEqual([])
    expect(g.postes_cherches).toEqual([])
  })

  it("hérite du défaut echeance = 'apero_mercredi' pour les groupes persistés avant le champ", () => {
    // Cas migration : les inscriptions déjà enregistrées côté LocalStorage
    // n'ont pas de champ `echeance`. Zod .default() garantit le retour propre.
    const g = Groupe.parse({ id: 'g1', titre: 'Persisté avant échéance' })
    expect(g.echeance).toBe('apero_mercredi')
  })

  it("accepte echeance = 'restitution_vendredi' (mouvement apéro → vendredi)", () => {
    const g = Groupe.parse({
      id: 'g1',
      titre: 'Assez au point pour vendredi',
      echeance: 'restitution_vendredi',
    })
    expect(g.echeance).toBe('restitution_vendredi')
  })

  it("rejette une echeance inconnue", () => {
    expect(() =>
      Groupe.parse({ id: 'g1', titre: 'X', echeance: 'concert_samedi' as never }),
    ).toThrow()
  })
})

describe('Inscriptions', () => {
  it('accepte une session vide', () => {
    const i = Inscriptions.parse({ session_id: 's5' })
    expect(i.personnes).toEqual([])
    expect(i.groupes).toEqual([])
  })

  it('refus par défaut = [] (migration transparente anciens JSON — issue #96 §D Q1)', () => {
    // Un ancien JSON écrit avant PR 2 pool §96 n'a pas de champ `refus`.
    // Le default Zod le remplit avec `[]` sans erreur — aucune migration
    // à écrire, le pool démarre sans refus enregistré.
    const i = Inscriptions.parse({ session_id: 's5' })
    expect(i.refus).toEqual([])
  })

  it('accepte un tableau de refus valides', () => {
    const i = Inscriptions.parse({
      session_id: 's5',
      refus: [
        {
          personne_id: 'marie',
          source_groupe_id: 'caravan',
          cible_groupe_id: 'zombie',
          refuse_at: '2026-09-12T13:00:00Z',
          motif: 'Déjà refusé le mois dernier',
        },
      ],
    })
    expect(i.refus).toHaveLength(1)
    expect(i.refus[0]!.personne_id).toBe('marie')
  })
})

// ─── Schéma Refus (pool §96 D Q1) ────────────────────────────────────────
// Verrouille les invariants du schéma persistant. Les invariants métier du
// filtre pool (match strict source × cible?) sont testés dans engine/pool.test.ts.

describe('Refus (pool §96)', () => {
  it('accepte un refus « transfert » avec cible_groupe_id', () => {
    const r = Refus.parse({
      personne_id: 'marie',
      source_groupe_id: 'caravan',
      cible_groupe_id: 'zombie',
      refuse_at: '2026-09-12T13:00:00Z',
    })
    expect(r.personne_id).toBe('marie')
    expect(r.cible_groupe_id).toBe('zombie')
  })

  it('accepte un refus « retrait sans réaffectation » sans cible_groupe_id', () => {
    // Cas Feeling Good : Marie refuse d'être retirée du morceau (retrait pur,
    // sans destination proposée). Le schéma doit accepter l'absence de cible.
    const r = Refus.parse({
      personne_id: 'marie',
      source_groupe_id: 'feeling-good',
      refuse_at: '2026-09-12T13:00:00Z',
    })
    expect(r.cible_groupe_id).toBeUndefined()
  })

  it('accepte un motif libre facultatif', () => {
    const r = Refus.parse({
      personne_id: 'marie',
      source_groupe_id: 'caravan',
      refuse_at: '2026-09-12T13:00:00Z',
      motif: 'Trop de morceaux avec cette personne, elle sature',
    })
    expect(r.motif).toBe('Trop de morceaux avec cette personne, elle sature')
  })

  it('rejette un refus sans personne_id', () => {
    expect(() =>
      Refus.parse({
        source_groupe_id: 'caravan',
        refuse_at: '2026-09-12T13:00:00Z',
      }),
    ).toThrow()
  })

  it('rejette un refus sans source_groupe_id', () => {
    expect(() =>
      Refus.parse({
        personne_id: 'marie',
        refuse_at: '2026-09-12T13:00:00Z',
      }),
    ).toThrow()
  })

  it('rejette un refus sans refuse_at', () => {
    expect(() =>
      Refus.parse({
        personne_id: 'marie',
        source_groupe_id: 'caravan',
      }),
    ).toThrow()
  })

  it('rejette un refuse_at hors format ISO 8601 (nit N1 review Leader PR #107)', () => {
    // `z.string().datetime()` protège le format déclaré dans le docstring.
    // Un string court comme `2026-09-12` (date seule) ou `hier` ne passe pas.
    expect(() =>
      Refus.parse({
        personne_id: 'marie',
        source_groupe_id: 'caravan',
        refuse_at: 'hier',
      }),
    ).toThrow()
    expect(() =>
      Refus.parse({
        personne_id: 'marie',
        source_groupe_id: 'caravan',
        refuse_at: '2026-09-12', // date seule, sans time
      }),
    ).toThrow()
  })

  it('rejette un cible_groupe_id vide (min 1)', () => {
    // La chaîne vide `""` ne doit pas passer pour cible_groupe_id — invariant
    // qui distingue « pas de cible » (undefined) de « cible mal formée ».
    expect(() =>
      Refus.parse({
        personne_id: 'marie',
        source_groupe_id: 'caravan',
        cible_groupe_id: '',
        refuse_at: '2026-09-12T13:00:00Z',
      }),
    ).toThrow()
  })
})

describe('slug', () => {
  it('normalise accents et espaces', () => {
    expect(slug('Emma (B)')).toBe('emma-b')
    expect(slug('Anaïs')).toBe('anais')
    expect(slug('02 · For Me Formidable')).toBe('02-for-me-formidable')
    expect(slug("L'Espérance")).toBe('l-esperance')
  })
})

describe('nouvelIdPersonne / Groupe / Salle / Impose (Sujet A id stable)', () => {
  it('génère des ids uniques à chaque appel', () => {
    expect(nouvelIdPersonne()).not.toBe(nouvelIdPersonne())
    expect(nouvelIdGroupe()).not.toBe(nouvelIdGroupe())
  })

  it('préfixe humain reconnaissable par type', () => {
    expect(nouvelIdPersonne()).toMatch(/^personne-/)
    expect(nouvelIdGroupe()).toMatch(/^groupe-/)
    expect(nouvelIdSalle()).toMatch(/^salle-/)
    expect(nouvelIdImpose()).toMatch(/^impose-/)
  })

  it('unicité garantie sur 1000 appels consécutifs (pas de collision)', () => {
    const ids = new Set<string>()
    for (let i = 0; i < 1000; i++) ids.add(nouvelIdPersonne())
    expect(ids.size).toBe(1000)
  })

  it("id opaque non dérivé d'un nom — le renommage ne peut pas casser les références", () => {
    // Le motif Sujet A : les fonctions ne prennent aucun paramètre nom,
    // donc l'id ne peut pas être dérivé d'un nom qui pourrait changer.
    const id1 = nouvelIdPersonne()
    const id2 = nouvelIdPersonne()
    // Suffix après le préfixe non-vide et distinct
    expect(id1.split('-').slice(1).join('-')).not.toBe('')
    expect(id2.split('-').slice(1).join('-')).not.toBe('')
  })
})
