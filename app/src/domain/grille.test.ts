import { describe, expect, it } from 'vitest'
import {
  decouper,
  diagnostiquerGrille,
  finInclusive,
  genererCreneaux,
  joursDeSession,
  optionsFinGrille,
  parseDureeSaisie,
  toFinMinutes,
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

  it('signale « session-terminée » quand date_fin < maintenantIso et court-circuite les règles', () => {
    // CD msg 6839 (2026-09-14) : le jeu de stress importé le 14 septembre
    // avec dates aoûtées faisait dire au diagnostic « voir Étape 2b pour
    // règles pathologiques » alors qu'aucune ne l'était. La cause était
    // le filtre `maintenant` du générateur, pas la grille.
    const s = sessionOk({
      date_debut: '2026-08-24',
      date_fin: '2026-08-28',
      butoir_apero_date: '2026-08-26',
      butoir_apero_heure: '18:00',
      butoir_vendredi_date: '2026-08-28',
      butoir_vendredi_heure: '20:00',
      grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
    })
    const diag = diagnostiquerGrille(s, lieuOk, { maintenantIso: '2026-09-14' })
    expect(diag.configurable).toBe(false)
    expect(diag.defauts_globaux).toEqual(['session-terminee'])
    // Court-circuit : la grille est saine, aucune règle n'est pathologique.
    expect(diag.defauts_regles).toEqual([])
  })

  it('n signale pas « session-terminée » quand date_fin >= maintenantIso', () => {
    // Session en cours (date_fin === maintenantIso) : rejouable en temps
    // réel, aucune raison de rapporter session-terminée. Comportement
    // aligné sur `propositionRejouer`.
    const s = sessionOk({
      date_debut: '2026-09-10',
      date_fin: '2026-09-14',
      butoir_apero_date: '2026-09-12',
      butoir_apero_heure: '18:00',
      butoir_vendredi_date: '2026-09-14',
      butoir_vendredi_heure: '20:00',
      grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
    })
    const diag = diagnostiquerGrille(s, lieuOk, { maintenantIso: '2026-09-14' })
    // La grille est saine, `genererCreneaux` produit des créneaux.
    expect(diag.configurable).toBe(true)
    expect(diag.defauts_globaux).toEqual([])
  })

  it('signale « session-terminée » avant de nommer les règles pathologiques', () => {
    // Priorité : quand la session est terminée, l'utilisateur ne doit pas
    // voir « votre règle #2 a un pas trop grand » — c'est un artefact du
    // moment du regard, pas un défaut à corriger.
    const s = sessionOk({
      date_debut: '2026-08-24',
      date_fin: '2026-08-28',
      butoir_apero_date: '2026-08-26',
      butoir_apero_heure: '18:00',
      butoir_vendredi_date: '2026-08-28',
      butoir_vendredi_heure: '20:00',
      grille: [
        { debut: '10:00', fin: '09:00', pas_minutes: 60 }, // plage-vide, ignoré
        { debut: '09:00', fin: '12:00', pas_minutes: 60 }, // sain
      ],
    })
    const diag = diagnostiquerGrille(s, lieuOk, { maintenantIso: '2026-09-14' })
    expect(diag.defauts_globaux).toEqual(['session-terminee'])
    expect(diag.defauts_regles).toEqual([])
  })

  it('reste rétro-compatible : sans maintenantIso le check session-terminée est court-circuité', () => {
    // Les appels existants (tests unitaires, sanity Zod) ne passent pas
    // maintenantIso. Le comportement doit être identique à avant la PR.
    const s = sessionOk({
      date_debut: '2026-08-24',
      date_fin: '2026-08-28',
      butoir_apero_date: '2026-08-26',
      butoir_apero_heure: '18:00',
      butoir_vendredi_date: '2026-08-28',
      butoir_vendredi_heure: '20:00',
      grille: [{ debut: '10:00', fin: '09:00', pas_minutes: 60 }],
    })
    const diag = diagnostiquerGrille(s, lieuOk)
    // Sans maintenantIso, on retombe sur le diagnostic classique
    // (règle plage-vide), pas session-terminée.
    expect(diag.defauts_globaux).toEqual([])
    expect(diag.defauts_regles.map((d) => d.categorie)).toEqual(['plage-vide'])
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

})

describe('toFinMinutes (helper convention inclusive — CD 6856)', () => {
  it('traduit HH:MM en total de minutes', () => {
    expect(toFinMinutes('09:00')).toBe(540)
    expect(toFinMinutes('11:59')).toBe(719)
    expect(toFinMinutes('18:30')).toBe(1110)
    expect(toFinMinutes('23:59')).toBe(1439)
  })

  it('traite 00:00 comme fin de journée (23:59 = 1439 min)', () => {
    // Cas legacy `fin: '00:00'` = 22:00→minuit. Impossible d'exprimer
    // en modulo positif sur le même jour, donc replié sur la dernière
    // minute du jour.
    expect(toFinMinutes('00:00')).toBe(1439)
  })
})

describe('optionsFinGrille — fins inclusives alignées sur le pas (PR E)', () => {
  it('début 13:30 pas 60 : 10 options de 14:29 à 23:29', () => {
    // (1440 − 810) / 60 = 10.5 → K=10 tours possibles avant minuit.
    // Dernière option = 13:30 + 10×60 − 1 = 23:29 (dernière minute occupée).
    const opts = optionsFinGrille('13:30', 60)
    expect(opts).toHaveLength(10)
    expect(opts[0]).toBe('14:29')
    expect(opts[9]).toBe('23:29')
  })

  it('début 18:00 pas 60 : va jusqu\'à 23:59 (dernier tour boucle sur fin de journée)', () => {
    // (1440 − 1080) / 60 = 6 → K=6. Dernier tour finit à 23:59.
    const opts = optionsFinGrille('18:00', 60)
    expect(opts).toEqual(['18:59', '19:59', '20:59', '21:59', '22:59', '23:59'])
  })

  it('début 09:00 pas 30 : options tombent tous les :29 et :59', () => {
    const opts = optionsFinGrille('09:00', 30)
    expect(opts.slice(0, 4)).toEqual(['09:29', '09:59', '10:29', '10:59'])
    expect(opts[opts.length - 1]).toBe('23:59')
  })

  it('début 09:00 pas 45 : premier tour finit à 09:44', () => {
    const opts = optionsFinGrille('09:00', 45)
    expect(opts[0]).toBe('09:44')
    expect(opts[1]).toBe('10:29')
  })

  it('début vide/undefined : tableau vide (le <select> reste sans option)', () => {
    expect(optionsFinGrille(undefined, 60)).toEqual([])
    expect(optionsFinGrille('', 60)).toEqual([])
  })

  it('début mal formé : tableau vide', () => {
    expect(optionsFinGrille('pas-une-heure', 60)).toEqual([])
  })

  it('pas ≤ 0 : tableau vide (formulaire dans un état intermédiaire)', () => {
    expect(optionsFinGrille('09:00', 0)).toEqual([])
    expect(optionsFinGrille('09:00', -30)).toEqual([])
  })
})

describe('decouper — convention fin inclusive (CD 6856)', () => {
  // **Invariant du chantier (CD 6856)** : le compte de créneaux doit être
  // IDENTIQUE avant et après conversion de la saisie. `13:30 → 18:30` et
  // `13:30 → 18:29` désignent la même plage, donc les mêmes 5 créneaux.

  it('13:30 → 18:30 pas 60 donne 5 tours', () => {
    const tours = decouper('13:30', '18:30', 60)
    expect(tours).toHaveLength(5)
    expect(tours[0]).toEqual({ debut: '13:30', fin: '14:30' })
    expect(tours[4]).toEqual({ debut: '17:30', fin: '18:30' })
  })

  it('13:30 → 18:29 pas 60 donne 5 tours aussi (invariant de conversion)', () => {
    // Cas critique CD 6856 : après conversion `18:30 → 18:29`, le compte
    // ne doit pas baisser. Bug main #129 : donnait 4 tours au lieu de 5.
    const tours = decouper('13:30', '18:29', 60)
    expect(tours).toHaveLength(5)
    expect(tours[0]).toEqual({ debut: '13:30', fin: '14:30' })
    expect(tours[4]).toEqual({ debut: '17:30', fin: '18:30' })
  })

  it('SNCF 13:37 → 18:37 pas 60 donne 5 tours', () => {
    const tours = decouper('13:37', '18:37', 60)
    expect(tours).toHaveLength(5)
    expect(tours[0]).toEqual({ debut: '13:37', fin: '14:37' })
    expect(tours[4]).toEqual({ debut: '17:37', fin: '18:37' })
  })

  it('SNCF 13:37 → 18:36 pas 60 donne 5 tours aussi', () => {
    // Ni :59 ni :29 — seul le multiple relatif du pas garantit la
    // symétrie avec et sans conversion.
    const tours = decouper('13:37', '18:36', 60)
    expect(tours).toHaveLength(5)
    expect(tours[0]).toEqual({ debut: '13:37', fin: '14:37' })
  })

  it('09:00 → 12:00 pas 60 donne 3 tours', () => {
    const tours = decouper('09:00', '12:00', 60)
    expect(tours).toHaveLength(3)
    expect(tours[2]).toEqual({ debut: '11:00', fin: '12:00' })
  })

  it('09:00 → 11:59 pas 60 donne 3 tours (symétrie inclusive)', () => {
    const tours = decouper('09:00', '11:59', 60)
    expect(tours).toHaveLength(3)
  })

  it('22:00 → 23:59 pas 60 donne 2 tours (démo Session 5)', () => {
    // Régression du chantier #82 : la démo passait de 0 (fin vide) à 1
    // (fin='23:59' sans support) puis à 2 après le correctif inclusif.
    const tours = decouper('22:00', '23:59', 60)
    expect(tours).toHaveLength(2)
    expect(tours[0]).toEqual({ debut: '22:00', fin: '23:00' })
    expect(tours[1]).toEqual({ debut: '23:00', fin: '24:00' })
  })

  it('22:00 → 00:00 pas 60 donne 2 tours (legacy fin de journée)', () => {
    // Cas JSON legacy : `fin: '00:00'` traité comme fin de journée
    // (23:59 = 1439 min) via `toFinMinutes`. Compte identique à
    // `fin: '23:59'`.
    const tours = decouper('22:00', '00:00', 60)
    expect(tours).toHaveLength(2)
  })

  it('09:00 → 11:59 pas 30 donne 6 tours (dernier 11:30-12:00)', () => {
    const tours = decouper('09:00', '11:59', 30)
    expect(tours).toHaveLength(6)
    expect(tours[5]).toEqual({ debut: '11:30', fin: '12:00' })
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

describe('parseDureeSaisie — accepte minutes/heures/mixte (CD 6950)', () => {
  it('minutes brutes : « 120 » → 120', () => {
    expect(parseDureeSaisie('120')).toBe(120)
    expect(parseDureeSaisie('90')).toBe(90)
    expect(parseDureeSaisie('1')).toBe(1)
  })

  it('heures rondes : « 2h » → 120, « 1h » → 60', () => {
    expect(parseDureeSaisie('2h')).toBe(120)
    expect(parseDureeSaisie('1h')).toBe(60)
    expect(parseDureeSaisie('3h')).toBe(180)
  })

  it('heures + minutes : « 1h30 » → 90, « 2h15 » → 135', () => {
    expect(parseDureeSaisie('1h30')).toBe(90)
    expect(parseDureeSaisie('2h15')).toBe(135)
    expect(parseDureeSaisie('0h45')).toBe(45)
  })

  it('unité min explicite : « 90 min » → 90', () => {
    expect(parseDureeSaisie('90 min')).toBe(90)
    expect(parseDureeSaisie('120min')).toBe(120)
  })

  it('tolère les espaces autour et la casse', () => {
    expect(parseDureeSaisie('  2h  ')).toBe(120)
    expect(parseDureeSaisie('2H')).toBe(120)
    expect(parseDureeSaisie('1H30')).toBe(90)
  })

  it('renvoie undefined sur saisie vide', () => {
    expect(parseDureeSaisie('')).toBeUndefined()
    expect(parseDureeSaisie('   ')).toBeUndefined()
  })

  it('renvoie undefined sur format non reconnu — ne devine pas', () => {
    // Le caller décide (input reste tel quel côté user, à corriger).
    expect(parseDureeSaisie('abc')).toBeUndefined()
    expect(parseDureeSaisie('2xyz')).toBeUndefined()
    expect(parseDureeSaisie('h30')).toBeUndefined()
    expect(parseDureeSaisie('1:30')).toBeUndefined()
  })

  it('rejette « 1h75 » (minutes > 60 dans le suffixe heures)', () => {
    // « 1h75 » n'a pas de sens en durée mixte. Le caller doit refuser
    // plutôt que d'interpréter comme 1h + 75min = 135.
    expect(parseDureeSaisie('1h75')).toBeUndefined()
  })

  it('cas frontière : « 0 » = 0 min (plage vide), « 0h » = 0', () => {
    // Cohérent avec la sémantique preprocess Zod : `debut === fin` = 0.
    expect(parseDureeSaisie('0')).toBe(0)
    expect(parseDureeSaisie('0h')).toBe(0)
  })
})
