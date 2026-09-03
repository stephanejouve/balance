/**
 * Tests du store solveur — task #60 PR-2 (`dernierChangement`,
 * `formatResumeDiff`, `snapshotPlacement`) + rattrapage des 3 tests
 * `marquerObsolete` recommandés par Leader lors de la review PR #57.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { DiffRepartition } from '../domain/repartition-diff'
import type { Assignation, GroupeSansSalle, Probleme } from '../engine/types'
import { comparerRepartitions } from '../domain/repartition-diff'
import {
  determinePlacementAvant,
  formatResumeDiff,
  marquerObsolete,
  resetFigees,
  resetPlacementCapture,
  resetSolution,
  snapshotPlacement,
  solveurStore,
  type Solution,
} from './solveur-store.svelte'

// ─── Helpers de reset entre tests ─────────────────────────────────────────

const fauxSolution = (assignations: Assignation[]): Solution => ({
  assignations,
  problemes: [] as Probleme[],
  couverture: [],
  diagnostics: [],
  groupesPerdus: [] as GroupeSansSalle[],
  duree_ms: 12,
  arret_precoce: 'complet',
  essais_executes: 1,
})

beforeEach(() => {
  // Remise à zéro complète du singleton avant chaque test
  resetSolution()
  resetPlacementCapture()
  resetFigees()
  solveurStore.calculEnCours = false
  solveurStore.budgetMsCourant = 3000
})

// ─── formatResumeDiff — pure, exhaustive ──────────────────────────────────

describe('formatResumeDiff', () => {
  const baseDiff: DiffRepartition = {
    identiques: false,
    delta_places: 0,
    delta_groupes_complets: 0,
    nb_groupes_modifies: 0,
    nb_seances_ajoutees: 0,
    nb_seances_retirees: 0,
    nb_changements_salle: 0,
    groupes_modifies: [],
  }

  it('renvoie null si identiques', () => {
    expect(formatResumeDiff({ ...baseDiff, identiques: true })).toBeNull()
  })

  it('réaménagement pur d\'un groupe → « 1 groupe réaménagé, aucune séance perdue »', () => {
    const diff: DiffRepartition = {
      ...baseDiff,
      groupes_modifies: [
        {
          groupe_id: 'g1',
          creneaux_ajoutes: ['c3'],
          creneaux_retires: ['c1'],
          deplacement_pur: true,
          changements_salle: [],
        },
      ],
    }
    expect(formatResumeDiff(diff)).toBe('1 groupe réaménagé, aucune séance perdue')
  })

  it('deux réaménagements → pluriel', () => {
    const diff: DiffRepartition = {
      ...baseDiff,
      groupes_modifies: [
        { groupe_id: 'g1', creneaux_ajoutes: ['c3'], creneaux_retires: ['c1'], deplacement_pur: true, changements_salle: [] },
        { groupe_id: 'g2', creneaux_ajoutes: ['c4'], creneaux_retires: ['c2'], deplacement_pur: true, changements_salle: [] },
      ],
    }
    expect(formatResumeDiff(diff)).toBe('2 groupes réaménagés, aucune séance perdue')
  })

  it('perte séance sans réaménagement → « N séances perdues » (pas de suffixe « aucune »)', () => {
    const diff: DiffRepartition = {
      ...baseDiff,
      groupes_modifies: [
        { groupe_id: 'g1', creneaux_ajoutes: [], creneaux_retires: ['c1', 'c2'], deplacement_pur: false, changements_salle: [] },
      ],
    }
    expect(formatResumeDiff(diff)).toBe('2 séances perdues')
  })

  it('mix réaménagement + perte → deux morceaux, pas de « aucune séance perdue »', () => {
    const diff: DiffRepartition = {
      ...baseDiff,
      groupes_modifies: [
        { groupe_id: 'g1', creneaux_ajoutes: ['c3'], creneaux_retires: ['c1'], deplacement_pur: true, changements_salle: [] },
        { groupe_id: 'g2', creneaux_ajoutes: [], creneaux_retires: ['c2'], deplacement_pur: false, changements_salle: [] },
      ],
    }
    expect(formatResumeDiff(diff)).toBe('1 groupe réaménagé, 1 séance perdue')
  })

  it('gain de séance sans perte → « N séances ajoutées »', () => {
    const diff: DiffRepartition = {
      ...baseDiff,
      groupes_modifies: [
        { groupe_id: 'g1', creneaux_ajoutes: ['c1', 'c2'], creneaux_retires: [], deplacement_pur: false, changements_salle: [] },
      ],
    }
    expect(formatResumeDiff(diff)).toBe('2 séances ajoutées')
  })

  // ─── Extension changements de salle (spec Stéphane 2026-09-03) ──────────

  it('changements salle seuls (désactivation d\'une salle) → « aucun horaire modifié »', () => {
    // Cas central du smoke : désactivation d'une salle occupée, tout le
    // monde garde son créneau, mais N séances migrent ailleurs. Sans le
    // suffixe « aucun horaire modifié », l'utilisateur pourrait croire
    // que des horaires ont bougé (« 4 changements de salle » seul).
    const diff: DiffRepartition = {
      ...baseDiff,
      nb_changements_salle: 4,
      groupes_modifies: [
        {
          groupe_id: 'g1',
          creneaux_ajoutes: [],
          creneaux_retires: [],
          deplacement_pur: false,
          changements_salle: [
            { creneau_id: 'c1', salle_avant: 'sa', salle_apres: 'sb' },
            { creneau_id: 'c2', salle_avant: 'sa', salle_apres: 'sb' },
            { creneau_id: 'c3', salle_avant: 'sa', salle_apres: 'sb' },
            { creneau_id: 'c4', salle_avant: 'sa', salle_apres: 'sb' },
          ],
        },
      ],
    }
    expect(formatResumeDiff(diff)).toBe(
      '4 changements de salle, aucun horaire modifié, aucune séance perdue',
    )
  })

  it('mix réaménagement + changements salle → « N groupes réaménagés, N changements de salle, aucune séance perdue »', () => {
    // Cas verbatim du brief Stéphane : « 6 groupes réaménagés, 4 changements
    // de salle, aucune séance perdue ».
    const diff: DiffRepartition = {
      ...baseDiff,
      nb_changements_salle: 4,
      groupes_modifies: [
        { groupe_id: 'g1', creneaux_ajoutes: ['c3'], creneaux_retires: ['c1'], deplacement_pur: true, changements_salle: [] },
        { groupe_id: 'g2', creneaux_ajoutes: ['c4'], creneaux_retires: ['c2'], deplacement_pur: true, changements_salle: [] },
        { groupe_id: 'g3', creneaux_ajoutes: ['c5'], creneaux_retires: ['c1'], deplacement_pur: true, changements_salle: [] },
        { groupe_id: 'g4', creneaux_ajoutes: ['c6'], creneaux_retires: ['c2'], deplacement_pur: true, changements_salle: [] },
        { groupe_id: 'g5', creneaux_ajoutes: ['c7'], creneaux_retires: ['c3'], deplacement_pur: true, changements_salle: [] },
        {
          groupe_id: 'g6',
          creneaux_ajoutes: ['c8'],
          creneaux_retires: ['c4'],
          deplacement_pur: true,
          changements_salle: [
            { creneau_id: 'c1', salle_avant: 'sa', salle_apres: 'sb' },
            { creneau_id: 'c2', salle_avant: 'sa', salle_apres: 'sb' },
            { creneau_id: 'c3', salle_avant: 'sa', salle_apres: 'sb' },
            { creneau_id: 'c4', salle_avant: 'sa', salle_apres: 'sb' },
          ],
        },
      ],
    }
    expect(formatResumeDiff(diff)).toBe(
      '6 groupes réaménagés, 4 changements de salle, aucune séance perdue',
    )
  })

  it('1 changement salle → singulier « changement »', () => {
    const diff: DiffRepartition = {
      ...baseDiff,
      nb_changements_salle: 1,
      groupes_modifies: [
        {
          groupe_id: 'g1',
          creneaux_ajoutes: [],
          creneaux_retires: [],
          deplacement_pur: false,
          changements_salle: [{ creneau_id: 'c1', salle_avant: 'sa', salle_apres: 'sb' }],
        },
      ],
    }
    expect(formatResumeDiff(diff)).toBe(
      '1 changement de salle, aucun horaire modifié, aucune séance perdue',
    )
  })
})

// ─── snapshotPlacement — garde-fou capture (piège Stéphane 2026-09-02) ────

describe('snapshotPlacement (garde-fou capture par valeur)', () => {
  it('un snapshot est indépendant de la solution source', () => {
    // Vigilance Stéphane : si le pipeline mutait un item de solution en
    // place plutôt que de réassigner, un snapshot pris par référence
    // deviendrait le "après" au lieu de rester le "avant" — et
    // `comparerRepartitions(avant, apres)` renverrait toujours
    // `identiques: true`. Test verrouille l'indépendance.
    const sol = fauxSolution([{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 'S1' }])
    const snap = snapshotPlacement(sol)

    // On mute la source APRÈS le snapshot ; la capture doit rester intacte.
    sol.assignations[0].creneau_id = 'MUTÉ'

    expect(snap[0].creneau_id).toBe('c1')
    expect(snap[0]).not.toBe(sol.assignations[0])
  })

  it('deux recalculs sur placements différents → diff non vide (bug typique piégé)', () => {
    // Reproduit le cas de test que Stéphane a demandé : après 2 « recalculs »
    // (ici simulés en construisant deux placements différents),
    // `comparerRepartitions` sur les snapshots doit rendre `identiques: false`.
    // Si un jour on remplace `snapshotPlacement` par une capture par
    // référence + un pipeline qui mute la solution existante, ce test
    // tomberait rouge (au lieu d'échouer silencieusement en prod).
    const sol1 = fauxSolution([{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 'S1' }])
    const snapAvant = snapshotPlacement(sol1)

    // 2ème "calcul" : nouveau placement, groupe reste identique mais créneau change
    const sol2 = fauxSolution([{ groupe_id: 'g1', creneau_id: 'c2', salle_id: 'S1' }])
    const snapApres = snapshotPlacement(sol2)

    const diff = comparerRepartitions(snapAvant, snapApres)
    expect(diff.identiques).toBe(false)
    expect(formatResumeDiff(diff)).not.toBeNull()
  })

  it('solution === null → snapshot vide', () => {
    expect(snapshotPlacement(null)).toEqual([])
  })
})

// ─── marquerObsolete — rattrapage nit review Leader PR #57 ────────────────

describe('marquerObsolete', () => {
  it('garde-fou : no-op si aucune solution affichée (solution === null)', () => {
    expect(solveurStore.solution).toBeNull()
    marquerObsolete()
    expect(solveurStore.solutionObsolete).toBe(false)
  })

  it('set le flag à true quand une solution existe', () => {
    solveurStore.solution = fauxSolution([{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 'S1' }])
    expect(solveurStore.solutionObsolete).toBe(false)
    marquerObsolete()
    expect(solveurStore.solutionObsolete).toBe(true)
  })

  it('resetSolution() efface aussi le flag et le dernierChangement', () => {
    solveurStore.solution = fauxSolution([{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 'S1' }])
    solveurStore.solutionObsolete = true
    solveurStore.dernierChangement = '1 groupe réaménagé, aucune séance perdue'
    resetSolution()
    expect(solveurStore.solution).toBeNull()
    expect(solveurStore.solutionObsolete).toBe(false)
    expect(solveurStore.dernierChangement).toBeNull()
  })
})

// ─── determinePlacementAvant + dernierPlacementCapture ────────────────────
// (bug smoke Stéphane 2026-09-03 : modif cadre → resetSolution → relance
//  → dernierChangement restait null car placementAvant = [] après reset)

describe('determinePlacementAvant (fallback dernierPlacementCapture)', () => {
  it('solution existante → snapshot depuis solution', () => {
    solveurStore.solution = fauxSolution([
      { groupe_id: 'g1', creneau_id: 'c1', salle_id: 'S' },
      { groupe_id: 'g2', creneau_id: 'c2', salle_id: 'S' },
    ])
    const avant = determinePlacementAvant()
    expect(avant).toHaveLength(2)
    expect(avant.map((p) => p.creneau_id).sort()).toEqual(['c1', 'c2'])
  })

  it('solution null + dernierPlacementCapture peuplé → capture réutilisée', () => {
    // Simule le scénario Stéphane : 1er calcul a set dernierPlacementCapture,
    // puis resetSolution() a mis solution=null, mais capture survit.
    solveurStore.solution = null
    solveurStore.dernierPlacementCapture = [
      { groupe_id: 'g1', creneau_id: 'c1', salle_id: 'S' },
      { groupe_id: 'g2', creneau_id: 'c2', salle_id: 'S' },
    ]
    const avant = determinePlacementAvant()
    expect(avant).toHaveLength(2)
    expect(avant.map((p) => p.creneau_id).sort()).toEqual(['c1', 'c2'])
  })

  it('solution null ET dernierPlacementCapture null → [] (1er calcul jamais fait)', () => {
    solveurStore.solution = null
    solveurStore.dernierPlacementCapture = null
    expect(determinePlacementAvant()).toEqual([])
  })
})

describe('dernierPlacementCapture survit à resetSolution (bug smoke Stéphane)', () => {
  it('resetSolution() NE nullifie PAS dernierPlacementCapture', () => {
    solveurStore.solution = fauxSolution([{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 'S' }])
    solveurStore.dernierPlacementCapture = [{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 'S' }]
    resetSolution()
    expect(solveurStore.solution).toBeNull()
    expect(solveurStore.dernierPlacementCapture).toEqual([
      { groupe_id: 'g1', creneau_id: 'c1', salle_id: 'S' },
    ])
    // Corollaire : le prochain runLancer peut comparer via
    // determinePlacementAvant, même si l'utilisateur a ajouté une règle
    // (modif cadre → resetSolution) entre les deux calculs.
    expect(determinePlacementAvant()).toHaveLength(1)
  })

  it('resetPlacementCapture() nullifie explicitement (purge session)', () => {
    solveurStore.dernierPlacementCapture = [{ groupe_id: 'g1', creneau_id: 'c1', salle_id: 'S' }]
    solveurStore.dernierChangement = '1 groupe réaménagé, aucune séance perdue'
    resetPlacementCapture()
    expect(solveurStore.dernierPlacementCapture).toBeNull()
    expect(solveurStore.dernierChangement).toBeNull()
  })
})
