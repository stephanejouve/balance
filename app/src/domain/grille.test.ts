import { describe, expect, it } from 'vitest'
import { decouper, diagnostiquerGrille, genererCreneaux, joursDeSession } from './grille'
import { Lieu, Session } from './model'

describe('decouper', () => {
  it('découpe une plage en tours du pas demandé', () => {
    const tours = decouper('09:00', '10:00', 60)
    expect(tours).toEqual([{ debut: '09:00', fin: '10:00' }])
  })

  it("découpe 16:30-20:30 en 4 tours d'une heure", () => {
    const tours = decouper('16:30', '20:30', 60)
    expect(tours).toHaveLength(4)
    expect(tours[0]).toEqual({ debut: '16:30', fin: '17:30' })
    expect(tours[3]).toEqual({ debut: '19:30', fin: '20:30' })
  })

  it("découpe en pas de 30 minutes", () => {
    const tours = decouper('09:00', '10:00', 30)
    expect(tours).toEqual([
      { debut: '09:00', fin: '09:30' },
      { debut: '09:30', fin: '10:00' },
    ])
  })

  it('renvoie vide si la plage est invalide ou vide', () => {
    expect(decouper('10:00', '09:00', 60)).toEqual([])
    expect(decouper('09:00', '09:00', 60)).toEqual([])
    expect(decouper('09:00', '10:00', 0)).toEqual([])
  })

  it('ignore le reste quand la plage ne divise pas exactement', () => {
    const tours = decouper('09:00', '10:15', 60)
    expect(tours).toHaveLength(1)
    expect(tours[0]).toEqual({ debut: '09:00', fin: '10:00' })
  })
})

describe('joursDeSession', () => {
  it('énumère les jours entre debut et fin inclus', () => {
    const j = joursDeSession('2026-08-24', '2026-08-28')
    expect(j).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
    ])
  })

  it('gère un jour unique', () => {
    expect(joursDeSession('2026-08-24', '2026-08-24')).toEqual(['2026-08-24'])
  })

  it('gère un changement de mois', () => {
    const j = joursDeSession('2026-08-30', '2026-09-02')
    expect(j).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'])
  })
})

describe('genererCreneaux', () => {
  const lieu = Lieu.parse({
    id: 'demo',
    nom: 'Site de démo',
    salles: [
      { id: 'A', nom: 'Salle A', jauge: 8 },
      { id: 'B', nom: 'Salle B', jauge: 5 },
    ],
  })

  it('déploie une règle quotidienne sur les jours de la session', () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-26',
      date_butoir: '2026-08-27',
      grille: [{ debut: '09:00', fin: '10:00' }],
    })
    const c = genererCreneaux(session, lieu)
    expect(c).toHaveLength(3)
    expect(c.every((x) => x.salles.length === 2)).toBe(true)
  })

  it("découpe une plage longue en tours d'une heure", () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-24',
      date_butoir: '2026-08-25',
      grille: [{ debut: '16:30', fin: '20:30', pas_minutes: 60 }],
    })
    const c = genererCreneaux(session, lieu)
    expect(c).toHaveLength(4)
    expect(c[0].debut).toBe('16:30')
    expect(c[3].debut).toBe('19:30')
  })

  it('restreint aux salles listées quand la règle précise', () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-24',
      date_butoir: '2026-08-25',
      grille: [{ debut: '09:00', fin: '10:00', salles: ['B'] }],
    })
    const c = genererCreneaux(session, lieu)
    expect(c).toHaveLength(1)
    expect(c[0].salles).toEqual(['B'])
  })

  it('applique le butoir : coupe les créneaux au-delà de la scène (butoirs symétriques)', () => {
    // Comportement historique préservé quand les 2 butoirs coïncident : le
    // générateur produit jusqu'au butoirMax (== butoir apéro == butoir vendredi
    // dans ce cas). Depuis #103 le filtre par échéance est appliqué en aval
    // par le solveur/`verify.ts` via `butoirKeyDeGroupe`.
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-28',
      butoir_apero_date: '2026-08-26',
      butoir_apero_heure: '18:00',
      butoir_vendredi_date: '2026-08-26',
      butoir_vendredi_heure: '18:00',
      grille: [{ debut: '09:00', fin: '10:00' }, { debut: '19:00', fin: '20:00' }],
    })
    const c = genererCreneaux(session, lieu)
    // 24, 25, 26 (matin uniquement pour le 26)
    expect(c.map((x) => x.id)).toEqual([
      '2026-08-24T0900',
      '2026-08-24T1900',
      '2026-08-25T0900',
      '2026-08-25T1900',
      '2026-08-26T0900',
    ])
  })

  it('produit les créneaux jusqu\'au max des 2 butoirs (le vendredi étend la fenêtre)', () => {
    // Depuis #103 : le butoir apéro peut être antérieur au butoir vendredi.
    // Le générateur produit jusqu'au max ; le filtre par échéance côté groupe
    // reste appliqué en aval. Ici vendredi étend jusqu'au 28.
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-28',
      butoir_apero_date: '2026-08-26',
      butoir_apero_heure: '18:00',
      butoir_vendredi_date: '2026-08-28',
      butoir_vendredi_heure: '20:00',
      grille: [{ debut: '09:00', fin: '10:00' }, { debut: '19:00', fin: '20:00' }],
    })
    const c = genererCreneaux(session, lieu)
    expect(c.map((x) => x.id)).toEqual([
      '2026-08-24T0900',
      '2026-08-24T1900',
      '2026-08-25T0900',
      '2026-08-25T1900',
      '2026-08-26T0900',
      '2026-08-26T1900',
      '2026-08-27T0900',
      '2026-08-27T1900',
      '2026-08-28T0900',
      '2026-08-28T1900',
    ])
  })

  it('bloque une plage via une règle bloque=true (exception)', () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-26',
      date_butoir: '2026-08-27',
      grille: [
        { debut: '09:00', fin: '10:00' },
        { jours: ['2026-08-25'], debut: '09:00', fin: '10:00', bloque: true },
      ],
    })
    const c = genererCreneaux(session, lieu)
    expect(c.map((x) => x.date)).toEqual(['2026-08-24', '2026-08-26'])
  })

  it('ignore les salles inactives', () => {
    const lieuAvecInactif = Lieu.parse({
      id: 'demo',
      nom: 'Site',
      salles: [
        { id: 'A', nom: 'A', jauge: 8 },
        { id: 'B', nom: 'B', jauge: 5, actif: false },
      ],
    })
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-24',
      date_butoir: '2026-08-25',
      grille: [{ debut: '09:00', fin: '10:00' }],
    })
    const c = genererCreneaux(session, lieuAvecInactif)
    expect(c[0].salles).toEqual(['A'])
  })

  it('trie les créneaux chronologiquement', () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-25',
      date_butoir: '2026-08-26',
      grille: [{ debut: '13:30', fin: '14:30' }, { debut: '09:00', fin: '10:00' }],
    })
    const c = genererCreneaux(session, lieu)
    const ids = c.map((x) => x.id)
    expect(ids).toEqual([...ids].sort())
  })
})

// ─── diagnostiquerGrille (issues #110 + #111) ──────────────────────────────
//
// Contrat vérifié :
//  1. Quand la génération produit au moins 1 créneau → configurable=true,
//     listes vides. Rien à afficher côté UI.
//  2. Quand la génération produit 0 créneau → configurable=false, les
//     défauts sont catégorisés (jamais phrase pré-fabriquée, l'UI compose).
//
// Chaque catégorie de défaut a un test dédié qui reproduit le symptôme.

describe('diagnostiquerGrille (issues #110 + #111)', () => {
  const lieuOk = Lieu.parse({
    id: 'demo',
    nom: 'Site de démo',
    salles: [
      { id: 'A', nom: 'Salle A', jauge: 8 },
      { id: 'B', nom: 'Salle B', jauge: 5 },
    ],
  })

  function sessionOk(overrides: Partial<Parameters<typeof Session.parse>[0]> = {}) {
    return Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-26',
      date_butoir: '2026-08-27',
      grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
      ...overrides,
    })
  }

  it('configurable=true et listes vides quand la génération produit ≥ 1 créneau', () => {
    const diag = diagnostiquerGrille(sessionOk(), lieuOk)
    expect(diag.configurable).toBe(true)
    expect(diag.nb_creneaux).toBeGreaterThan(0)
    expect(diag.defauts_regles).toEqual([])
    expect(diag.defauts_globaux).toEqual([])
  })

  it('signale aucune-regle-creatrice quand seules des règles de blocage existent', () => {
    const s = sessionOk({
      grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60, bloque: true }],
    })
    const diag = diagnostiquerGrille(s, lieuOk)
    expect(diag.configurable).toBe(false)
    expect(diag.defauts_globaux).toContain('aucune-regle-creatrice')
    expect(diag.defauts_regles).toEqual([])
  })

  it('signale jours-invalides quand aucun jour de la règle ne matche la session', () => {
    const s = sessionOk({
      // Session du 24 au 26 août 2026 (lundi-mercredi). La règle cible des
      // dates hors session — aucune ne correspond à un jour existant.
      grille: [
        { jours: ['2026-09-01', '2026-09-02'], debut: '09:00', fin: '10:00', pas_minutes: 60 },
      ],
    })
    const diag = diagnostiquerGrille(s, lieuOk)
    expect(diag.configurable).toBe(false)
    expect(diag.defauts_regles).toHaveLength(1)
    expect(diag.defauts_regles[0]!.categorie).toBe('jours-invalides')
    expect(diag.defauts_regles[0]!.regleIndex).toBe(0)
  })

  it('signale plage-vide quand debut >= fin', () => {
    const s = sessionOk({
      grille: [{ debut: '10:00', fin: '09:00', pas_minutes: 60 }],
    })
    const diag = diagnostiquerGrille(s, lieuOk)
    expect(diag.configurable).toBe(false)
    expect(diag.defauts_regles).toHaveLength(1)
    expect(diag.defauts_regles[0]!.categorie).toBe('plage-vide')
    expect(diag.defauts_regles[0]!.debut).toBe('10:00')
    expect(diag.defauts_regles[0]!.fin).toBe('09:00')
  })

  it('signale pas-trop-grand quand pas_minutes > durée de la plage', () => {
    const s = sessionOk({
      // Plage 09:00-09:30 (30 min) avec pas de 60 min → aucun tour possible.
      grille: [{ debut: '09:00', fin: '09:30', pas_minutes: 60 }],
    })
    const diag = diagnostiquerGrille(s, lieuOk)
    expect(diag.configurable).toBe(false)
    expect(diag.defauts_regles).toHaveLength(1)
    expect(diag.defauts_regles[0]!.categorie).toBe('pas-trop-grand')
  })

  it('signale tout-bloqué quand une règle de blocage couvre entièrement les créneaux émis', () => {
    const s = sessionOk({
      grille: [
        { debut: '09:00', fin: '10:00', pas_minutes: 60 },
        { debut: '09:00', fin: '10:00', pas_minutes: 60, bloque: true },
      ],
    })
    const diag = diagnostiquerGrille(s, lieuOk)
    expect(diag.configurable).toBe(false)
    expect(diag.defauts_regles).toHaveLength(1)
    expect(diag.defauts_regles[0]!.categorie).toBe('tout-bloqué')
    expect(diag.defauts_regles[0]!.regleIndex).toBe(0)
  })

  it('signale tout-bloqué quand tous les créneaux tombent au-delà du butoir', () => {
    // Butoirs à 2026-08-24 23:59 pour les 2 (fin très tôt) : les créneaux
    // émis à partir du 25 tombent au-delà et disparaissent tous.
    const s = sessionOk({
      date_debut: '2026-08-25',
      date_fin: '2026-08-26',
      grille: [{ debut: '09:00', fin: '10:00', pas_minutes: 60 }],
    })
    const sPatched = Session.parse({
      ...s,
      butoir_apero_date: '2026-08-24',
      butoir_apero_heure: '23:59',
      butoir_vendredi_date: '2026-08-24',
      butoir_vendredi_heure: '23:59',
    })
    const diag = diagnostiquerGrille(sPatched, lieuOk)
    expect(diag.configurable).toBe(false)
    expect(diag.defauts_regles).toHaveLength(1)
    expect(diag.defauts_regles[0]!.categorie).toBe('tout-bloqué')
  })

  it('remonte simultanément défauts globaux et défauts par règle (nit C review Leader PR #112)', () => {
    // Cas mixte : session sans jour (date_debut > date_fin → jours=[]) ET
    // une règle créatrice avec des jours explicites qui ne pourront rien
    // matcher (session vide). Le contrat couvre les 2 axes en même temps —
    // pas mutuellement exclusifs. `session-sans-jour` remonte comme global,
    // `jours-invalides` remonte pour la règle qui avait des jours listés.
    const s = sessionOk({
      date_debut: '2026-08-28',
      date_fin: '2026-08-24', // inversé → joursDeSession retourne []
      grille: [
        { jours: ['2026-08-24'], debut: '09:00', fin: '10:00', pas_minutes: 60 },
      ],
    })
    const diag = diagnostiquerGrille(s, lieuOk)
    expect(diag.configurable).toBe(false)
    expect(diag.defauts_globaux).toContain('session-sans-jour')
    expect(diag.defauts_regles).toHaveLength(1)
    expect(diag.defauts_regles[0]!.categorie).toBe('jours-invalides')
  })

  it('remonte plusieurs défauts par règle indexés dans l ordre saisi', () => {
    const s = sessionOk({
      grille: [
        { debut: '10:00', fin: '09:00', pas_minutes: 60 }, // #0 plage-vide
        { debut: '09:00', fin: '12:00', pas_minutes: 60, bloque: true }, // #1 bloque, ignoré
        { debut: '09:00', fin: '09:15', pas_minutes: 60 }, // #2 pas-trop-grand
      ],
    })
    const diag = diagnostiquerGrille(s, lieuOk)
    expect(diag.configurable).toBe(false)
    const indexes = diag.defauts_regles.map((d) => d.regleIndex)
    expect(indexes).toEqual([0, 2])
    const cats = diag.defauts_regles.map((d) => d.categorie)
    expect(cats).toEqual(['plage-vide', 'pas-trop-grand'])
  })
})
