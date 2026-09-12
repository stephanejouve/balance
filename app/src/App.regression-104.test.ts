import { describe, expect, it } from 'vitest'
import { genererCreneaux } from './domain/grille'
import { Lieu, Session } from './domain/model'

// Test de non-régression du hotfix production 2026-09-12.
//
// Contexte — PR #104 (mergée cet après-midi) a renommé les champs Session
// `date_butoir`/`butoir_heure` → `butoir_apero_date`/`butoir_apero_heure` +
// `butoir_vendredi_date`/`butoir_vendredi_heure` (2 butoirs par échéance).
// La migration Zod couvre les JSON persistés en LocalStorage, mais un handler
// d'interface — `App.svelte::nouvelleSessionVide()` — écrivait encore les
// anciens noms via `Object.assign(session, {…, date_butoir, butoir_heure})`.
//
// `Object.assign` n'écrase QUE les propriétés listées dans le patch : les
// nouveaux noms `butoir_apero_date` et `butoir_vendredi_date` héritaient
// silencieusement des valeurs du parse précédent (la démo Session 5 avec
// des dates fin août). Après clic « Nouvelle session » avec un `today` en
// septembre, `butoirKeyMax` restait fin août, antérieur à `date_debut` →
// `genererCreneaux` filtrait tous les créneaux → grille vide.
//
// Ce test remonte le scénario complet parce que les tests existants
// construisent les Session via `Session.parse(...)` direct — la migration
// couvre alors les champs et rien ne signale l'erreur du handler. C'est
// PRÉCISÉMENT pour ça qu'aucun n'a attrapé la régression avant Stéphane.
//
// Ne pas supprimer sans une réécriture équivalente qui exerce le chemin
// handler → générateur bout-en-bout (arbitrage CD 2026-09-12 22:55, msg 6701).

describe("non-régression #104 : nouvelleSessionVide ne casse pas la grille", () => {
  it('génère des créneaux après remplacement des dates via Object.assign', () => {
    // 1. État initial : demo Session 5 parsée (migration Zod pose les 2 butoirs)
    const session = Session.parse({
      id: 'session-5',
      nom: 'Session 5 — Musiques Festives',
      lieu_id: 'musiques-festives',
      date_debut: '2026-08-24',
      date_fin: '2026-08-28',
      date_butoir: '2026-08-26',
      butoir_heure: '18:30',
      grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
    })
    expect(session.butoir_apero_date).toBe('2026-08-26')
    expect(session.butoir_vendredi_date).toBe('2026-08-28')

    // 2. Simule le patch écrit par `nouvelleSessionVide` avec les nouveaux
    //    noms canoniques (post-hotfix). Les dates passent en semaine courante.
    Object.assign(session, {
      id: 'nouvelle-session',
      nom: 'Nouvelle session',
      date_debut: '2026-09-12',
      date_fin: '2026-09-18',
      butoir_apero_date: '2026-09-18',
      butoir_apero_heure: '23:59',
      butoir_vendredi_date: '2026-09-18',
      butoir_vendredi_heure: '23:59',
    })
    expect(session.butoir_apero_date).toBe('2026-09-18')
    expect(session.butoir_vendredi_date).toBe('2026-09-18')

    // 3. Génération : la grille doit être non vide (invariant du hotfix).
    const lieu = Lieu.parse({
      id: 'x',
      nom: 'X',
      salles: [{ id: 's1', nom: 'S1', jauge: 5 }],
    })
    const creneaux = genererCreneaux(session, lieu)
    expect(creneaux.length).toBeGreaterThan(0)
  })

  it('démontre le bug pré-hotfix : anciens noms → grille vide', () => {
    // Contre-exemple qui verrouille l'invariant : si un futur refactor ré-écrit
    // les anciens noms `date_butoir`/`butoir_heure`, `butoir_apero_date`
    // reste aux valeurs héritées et tous les créneaux sortent du butoir.
    // Ce test échouera au moment où quelqu'un tentera de remettre le bug.
    const session = Session.parse({
      id: 'session-5',
      nom: 'Session 5 — Musiques Festives',
      lieu_id: 'musiques-festives',
      date_debut: '2026-08-24',
      date_fin: '2026-08-28',
      date_butoir: '2026-08-26',
      butoir_heure: '18:30',
      grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
    })
    Object.assign(session, {
      date_debut: '2026-09-12',
      date_fin: '2026-09-18',
      // Anciens noms — non reconnus par le schéma, ignorés à la lecture.
      // Les nouveaux champs butoir_* restent aux valeurs héritées (fin août).
      date_butoir: '2026-09-18',
      butoir_heure: '23:59',
    })
    const lieu = Lieu.parse({
      id: 'x',
      nom: 'X',
      salles: [{ id: 's1', nom: 'S1', jauge: 5 }],
    })
    const creneaux = genererCreneaux(session, lieu)
    // Grille vide — c'est le symptôme observé par Stéphane le 2026-09-12.
    expect(creneaux.length).toBe(0)
  })
})
