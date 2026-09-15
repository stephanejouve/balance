import { describe, expect, it } from 'vitest'
import {
  Groupe,
  Indispo,
  Inscriptions,
  Lieu,
  Personne,
  Refus,
  RegleCreneau,
  RestrictionHoraire,
  Seance,
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

describe('Cap durée (CD 6876+6891) — preprocess Zod fin → duree_minutes', () => {
  // Formule (CD 6891) : `duree = toFinMinutes(fin) − toMinutes(debut)`
  //   convention EXCLUSIVE — la fin d'indispo a toujours été traitée
  //   `<` (creneau.debut < ind.fin) dans `indispoBloque`. La durée
  //   représente le nombre de minutes effectivement bloquées.
  // Ex : `18:00 → 19:00` = 60 min, `22:00 → 00:00` = 119 min (00:00 =
  //   fin de journée = 1439), `debut === fin` = 0 (plage vide).

  describe('Indispo', () => {
    it('calcule duree_minutes depuis fin+debut à l’import (JSON legacy)', () => {
      // `18:00 → 19:00` = 60 min (convention exclusive : 60 minutes
      // occupées, dernière minute = 18:59)
      const parsed = Indispo.parse({ debut: '18:00', fin: '19:00' })
      expect(parsed.duree_minutes).toBe(60)
      expect(parsed.fin).toBe('19:00') // fin conservée pendant la migration
    })

    it('gère la fin de journée 00:00 → 1439 min', () => {
      // `22:00 → 00:00` : `toFinMinutes('00:00') = 1439` → 1439−1320 = 119
      const parsed = Indispo.parse({ debut: '22:00', fin: '00:00' })
      expect(parsed.duree_minutes).toBe(119)
    })

    it('gère debut === fin = 0 minute (plage vide, cohérent convention exclusive)', () => {
      const parsed = Indispo.parse({ debut: '13:30', fin: '13:30' })
      expect(parsed.duree_minutes).toBe(0)
    })

    it('respecte duree_minutes déjà fournie (canonique, pas de recalcul)', () => {
      const parsed = Indispo.parse({ debut: '18:00', fin: '19:00', duree_minutes: 45 })
      expect(parsed.duree_minutes).toBe(45)
    })

    it('ne calcule pas duree quand fin absent (indispo journée entière ou match exact)', () => {
      const parsed = Indispo.parse({ debut: '13:30' })
      expect(parsed.duree_minutes).toBeUndefined()
    })

    it('ne calcule pas duree quand debut ET fin absents (indispo journée)', () => {
      const parsed = Indispo.parse({})
      expect(parsed.duree_minutes).toBeUndefined()
    })
  })

  describe('RestrictionHoraire', () => {
    it('calcule duree_minutes à l’import pour restriction de salle', () => {
      const parsed = RestrictionHoraire.parse({
        debut: '22:00',
        fin: '00:00',
        contrainte: 'interdit',
      })
      // `22:00 → 00:00` = 119 min (00:00 = fin de journée = 1439, exclusive).
      expect(parsed.duree_minutes).toBe(119)
    })
  })

  describe('Seance (dans Impose)', () => {
    it('calcule duree_minutes à l’import pour séance imposée', () => {
      const parsed = Seance.parse({
        date: '2026-08-25',
        debut: '13:30',
        fin: '14:00',
      })
      // 30 min occupées (convention exclusive).
      expect(parsed.duree_minutes).toBe(30)
    })
  })

  describe('Non-régression : fin_saisie_original retiré des 4 schémas', () => {
    // Retrait cascadé : Indispo/Restriction/Seance en PR D (14/09),
    // RegleCreneau en PR E (15/09). Zod strip mode par défaut : un vieux
    // JSON avec `fin_saisie_original` voit ce champ ignoré silencieusement
    // (pas d'erreur, pas de préservation).
    it('Indispo accepte un JSON sans fin_saisie_original', () => {
      const parsed = Indispo.parse({ debut: '18:00' })
      expect(parsed).not.toHaveProperty('fin_saisie_original')
    })

    it('RegleCreneau ignore silencieusement un fin_saisie_original legacy', () => {
      const parsed = RegleCreneau.parse({
        debut: '13:30',
        fin: '18:29',
        pas_minutes: 60,
        fin_saisie_original: '18:30',
      })
      expect(parsed).not.toHaveProperty('fin_saisie_original')
      expect(parsed.fin).toBe('18:29')
    })
  })
})
