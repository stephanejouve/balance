import { describe, expect, it } from 'vitest'
import {
  appliquerCorrectionFinSaisie,
  corrigerSaisieFin,
  decouper,
  diagnostiquerGrille,
  finInclusive,
  genererCreneaux,
  joursDeSession,
  normaliserFinBorne,
} from './grille'
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

describe('finInclusive', () => {
  it('recule d’une minute pour une borne H:00 (pas 60)', () => {
    expect(finInclusive('12:00')).toBe('11:59')
    expect(finInclusive('10:00')).toBe('09:59')
    expect(finInclusive('01:00')).toBe('00:59')
  })

  it('recule d’une minute pour une borne H:30 (pas 30)', () => {
    expect(finInclusive('12:30')).toBe('12:29')
    expect(finInclusive('18:30')).toBe('18:29')
  })

  it('recule d’une minute pour une borne quelconque (pas arbitraire)', () => {
    expect(finInclusive('09:45')).toBe('09:44')
    expect(finInclusive('10:15')).toBe('10:14')
    expect(finInclusive('23:45')).toBe('23:44')
  })

  it('gère la borne 24:00 (fin de journée interne) → 23:59', () => {
    expect(finInclusive('24:00')).toBe('23:59')
  })

  it('gère la borne 00:00 (fin de journée saisie) → 23:59', () => {
    // Cas frontière : `00:00` traité comme fin-de-jour, pas comme début.
    // Recule vers 23:59 du même jour, pas vers un négatif.
    expect(finInclusive('00:00')).toBe('23:59')
  })

  it('compose avec normaliserFinBorne pour toute saisie utilisateur', () => {
    // La convention Stéphane (CD 6832) veut que la saisie 12:00 soit
    // convertie en 11:59. La double transformation
    // `finInclusive(normaliserFinBorne(...))` doit être l'identité sur
    // toute saisie utilisateur valide.
    for (const saisie of ['09:00', '12:00', '18:30', '23:59', '00:00']) {
      const affichee = finInclusive(normaliserFinBorne(saisie))
      // Ce que l'utilisateur écrit doit correspondre à ce que l'app
      // décide d'afficher (ou déjà écrit dans la convention Stéphane).
      const attendu =
        saisie === '00:00' ? '23:59' : saisie.endsWith(':59') ? saisie : finInclusive(saisie)
      expect(affichee).toBe(attendu)
    }
  })
})

describe('corrigerSaisieFin', () => {
  it('laisse la chaîne vide inchangée (saisie non encore commencée)', () => {
    const r = corrigerSaisieFin('')
    expect(r.valeur).toBe('')
    expect(r.original).toBeNull()
  })

  it('laisse H:59 inchangé (borne déjà finale, pas de mention)', () => {
    // Convention Stéphane : quand l'utilisateur écrit directement la
    // dernière minute occupée, aucune correction n'est appliquée et
    // aucune mention ne s'affiche.
    expect(corrigerSaisieFin('11:59')).toEqual({ valeur: '11:59', original: null })
    expect(corrigerSaisieFin('23:59')).toEqual({ valeur: '23:59', original: null })
    expect(corrigerSaisieFin('00:59')).toEqual({ valeur: '00:59', original: null })
  })

  it('corrige H:00 vers (H−1):59 avec mention', () => {
    expect(corrigerSaisieFin('12:00')).toEqual({ valeur: '11:59', original: '12:00' })
    expect(corrigerSaisieFin('09:00')).toEqual({ valeur: '08:59', original: '09:00' })
  })

  it('corrige 00:00 vers 23:59 (fin de journée saisie) avec mention', () => {
    expect(corrigerSaisieFin('00:00')).toEqual({ valeur: '23:59', original: '00:00' })
  })

  it('corrige toute borne non-finale H:MM vers H:(MM−1) avec mention', () => {
    // Cas pas 30 (`H:30`) et pas quelconque : la dernière minute
    // effectivement occupée est la minute juste avant la borne.
    expect(corrigerSaisieFin('12:30')).toEqual({ valeur: '12:29', original: '12:30' })
    expect(corrigerSaisieFin('18:15')).toEqual({ valeur: '18:14', original: '18:15' })
  })
})

describe('appliquerCorrectionFinSaisie', () => {
  it('applique la correction quand fin est H:00 et fin_saisie_original absent', () => {
    const o: { fin?: string; fin_saisie_original?: string } = { fin: '12:00' }
    appliquerCorrectionFinSaisie(o)
    expect(o.fin).toBe('11:59')
    expect(o.fin_saisie_original).toBe('12:00')
  })

  it('n’applique pas la correction si fin_saisie_original est déjà renseigné (idempotence)', () => {
    // Un JSON produit après entrée en vigueur de la convention porte
    // les deux champs de façon cohérente — le helper doit court-circuiter
    // pour ne pas re-corriger `11:59 → 11:58` ni écraser `12:00` original.
    const o: { fin?: string; fin_saisie_original?: string } = {
      fin: '11:59',
      fin_saisie_original: '12:00',
    }
    appliquerCorrectionFinSaisie(o)
    expect(o.fin).toBe('11:59')
    expect(o.fin_saisie_original).toBe('12:00')
  })

  it('court-circuite proprement quand fin est absent (Indispo optionnel)', () => {
    const o: { fin?: string; fin_saisie_original?: string } = {}
    appliquerCorrectionFinSaisie(o)
    expect(o.fin).toBeUndefined()
    expect(o.fin_saisie_original).toBeUndefined()
  })

  it('laisse une valeur naturelle H:59 inchangée', () => {
    const o: { fin?: string; fin_saisie_original?: string } = { fin: '11:59' }
    appliquerCorrectionFinSaisie(o)
    expect(o.fin).toBe('11:59')
    expect(o.fin_saisie_original).toBeUndefined()
  })
})

describe('normaliserFinBorne', () => {
  it('convertit minuit fin de journée : 00:00 → 24:00', () => {
    expect(normaliserFinBorne('00:00')).toBe('24:00')
  })

  it('convertit H:59 en (H+1):00 pour toute heure', () => {
    expect(normaliserFinBorne('23:59')).toBe('24:00')
    expect(normaliserFinBorne('11:59')).toBe('12:00')
    expect(normaliserFinBorne('00:59')).toBe('01:00')
    expect(normaliserFinBorne('08:59')).toBe('09:00')
  })

  it('laisse les autres valeurs inchangées', () => {
    expect(normaliserFinBorne('10:00')).toBe('10:00')
    expect(normaliserFinBorne('09:30')).toBe('09:30')
    expect(normaliserFinBorne('12:00')).toBe('12:00')
    expect(normaliserFinBorne('23:00')).toBe('23:00')
  })
})

describe('decouper — convention borne fin (#82)', () => {
  // Garde-fou négatif : sans normalisation de la borne de fin,
  // decouper('22:00', '23:59', 60) donnerait 1 seul tour (Math.floor(119/60)).
  // Le fait que genererCreneaux passe par normaliserFinBorne rend la démo
  // Session 5 nocturne cohérente avec la saisie utilisateur.
  it('decouper brut : 22:00 → 23:59 pas 60 donne 1 tour (borne exclusive)', () => {
    // Ce cas documente le comportement de decouper appelé DIRECTEMENT.
    // La correction du défaut passe par normaliserFinBorne EN AMONT (cf test
    // ci-dessous « démo Session 5 nocturne » qui vérifie 2 tours après
    // normalisation).
    const tours = decouper('22:00', '23:59', 60)
    expect(tours).toHaveLength(1)
  })

  it('après normaliserFinBorne : 22:00 → 23:59 pas 60 donne 2 tours', () => {
    const tours = decouper('22:00', normaliserFinBorne('23:59'), 60)
    expect(tours).toHaveLength(2)
    expect(tours[0]).toEqual({ debut: '22:00', fin: '23:00' })
    expect(tours[1]).toEqual({ debut: '23:00', fin: '24:00' })
  })

  it('après normaliserFinBorne : 09:00 → 11:59 pas 30 donne 6 tours (dernier 11:30)', () => {
    const tours = decouper('09:00', normaliserFinBorne('11:59'), 30)
    expect(tours).toHaveLength(6)
    expect(tours[0]).toEqual({ debut: '09:00', fin: '09:30' })
    expect(tours[5]).toEqual({ debut: '11:30', fin: '12:00' })
  })

  it('après normaliserFinBorne : 09:00 → 12:00 pas 60 donne 3 tours (comportement inchangé)', () => {
    const tours = decouper('09:00', normaliserFinBorne('12:00'), 60)
    expect(tours).toHaveLength(3)
    expect(tours[2]).toEqual({ debut: '11:00', fin: '12:00' })
  })
})

describe('genererCreneaux — démo Session 5 nocturne (#82 CD 6790)', () => {
  const lieuDemo = Lieu.parse({
    id: 'demo',
    nom: 'Site de démo',
    salles: [{ id: 'A', nom: 'Salle A', jauge: 8 }],
  })

  it('règle 22:00 → 23:59 pas 60 émet 2 créneaux par jour', () => {
    // Contexte : CD msg 6790 (2026-09-13) — la grille démo Session 5 portait
    // une règle « tous les jours, 22:00, fin VIDE, pas 60 » qui produisait
    // 0 créneau (comptée créatrice mais inopérante). Stéphane a rempli le
    // champ vide avec 23:59 : 46 → 53 créneaux, soit 1/jour × 7 jours.
    // La correction (normaliserFinBorne étendu) porte ce total à 60,
    // soit 2/jour × 7 jours — la minute manquante ne coûte plus un créneau.
    const session = Session.parse({
      id: 's',
      nom: 'Démo Session 5',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-30',
      date_butoir: '2026-08-31',
      grille: [{ debut: '22:00', fin: '23:59', pas_minutes: 60 }],
    })
    const c = genererCreneaux(session, lieuDemo)
    expect(c).toHaveLength(14) // 2 créneaux × 7 jours
    const dansPremierJour = c.filter((x) => x.date === '2026-08-24')
    expect(dansPremierJour.map((x) => x.debut)).toEqual(['22:00', '23:00'])
  })

  it('règle bloqueuse 22:00 → 23:59 bloque bien 22:00 ET 23:00 (symétrie créatrices/bloqueuses)', () => {
    // CD 6819 : « une règle bloquant 22:00 vers 23:59 bloquera bien 22:00 ET
    // 23:00 — cohérent, pas un effet de bord ». Vérifie que la normalisation
    // s'applique symétriquement.
    const session = Session.parse({
      id: 's',
      nom: 'Test blocage',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-24',
      date_butoir: '2026-08-25',
      grille: [
        { debut: '20:00', fin: '23:59', pas_minutes: 60 },
        { debut: '22:00', fin: '23:59', pas_minutes: 60, bloque: true },
      ],
    })
    const c = genererCreneaux(session, lieuDemo)
    // Créatrice 20:00→23:59 pas 60 = 4 tours (20, 21, 22, 23). Bloqueuse
    // 22:00→23:59 retire 22 et 23. Reste 20 et 21.
    expect(c.map((x) => x.debut).sort()).toEqual(['20:00', '21:00'])
  })
})
