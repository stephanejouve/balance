import type { Creneau } from '../domain/grille'
import type { Inscriptions } from '../domain/model'
import type { Lieu, Session } from '../domain/model'
import type { DiffRepartition } from '../domain/repartition-diff'
import { comparerRepartitions } from '../domain/repartition-diff'
import { attribuerSalles } from '../engine/allocate-rooms'
import type { IdContrainte } from '../engine/contraintes'
import { registrePersonnalise } from '../engine/contraintes'
import { diagnostiquer } from '../engine/diagnostic'
import { preparerInscriptionsPourSolveur } from '../engine/fonctions-activees'
import { enrichirIndispos } from '../engine/imposes'
import type { PlacementItem } from '../engine/solver'
import { repartir } from '../engine/solver'
import type { Assignation, GroupeSansSalle, Probleme } from '../engine/types'
import { couverture, verifier } from '../engine/verify'
import { CONTRAINTES_ACTIVES_DEFAUT } from './app-config'

/**
 * Store solveur — état réactif + pipeline de calcul.
 *
 * Extrait d'App.svelte (audit Leader P1 « God script »). B1 dans la
 * séquence Balance qui précède task #60 (découpler saisie du calcul).
 *
 * Découpage :
 * - `solveurStore` — objet `$state` singleton (Svelte 5 runes)
 * - `lancer(inputs, options)` — fonction pure : calcule une `Solution`
 *   sans toucher au store. Testable/utilisable hors runtime Svelte.
 * - `runLancer(inputs)` — wrapper store : gère `calculEnCours` et
 *   `solution` autour de l'appel `lancer()`. Contient le boilerplate
 *   qui était inline dans `App.svelte.lancer()`.
 * - `resetSolution()` / `resetFigees()` — helpers pour les 22+ sites
 *   d'App.svelte qui invalidaient le placement après édition de saisie.
 */

export type Solution = {
  assignations: Assignation[]
  problemes: Probleme[]
  couverture: Array<{ groupe_id: string; obtenu: number; cible: number; min: number }>
  diagnostics: ReturnType<typeof diagnostiquer>
  groupesPerdus: GroupeSansSalle[]
  duree_ms: number
  arret_precoce: 'complet' | 'heuristique' | 'max-essais' | 'budget' | 'stagnation'
  essais_executes: number
}

export interface SolveurInputs {
  session: Session
  lieu: Lieu
  inscriptions: Inscriptions
  creneaux: Creneau[]
}

export interface LancerOptions {
  budgetMs: number
  figeesKeys: Set<string>
  contraintesActives: Record<IdContrainte, boolean>
  solutionPrecedente: Solution | null
}

export const solveurStore = $state({
  /**
   * Budget wall-clock du solveur — par défaut 3000 ms (garde-fou anti-gel
   * Chrome, task #51). L'utilisateur peut l'étendre via le bouton
   * « relancer plus longtemps » qui passe à Infinity.
   */
  budgetMsCourant: 3000,
  solution: null as Solution | null,
  calculEnCours: false,
  /**
   * Vrai quand une modification de saisie (composition groupe, indispos,
   * imposés) est intervenue depuis le dernier calcul. La solution reste
   * affichée mais un bandeau invite explicitement à relancer.
   *
   * Task #60 PR-1 : découpler la saisie du calcul. Les éditions sur le
   * *contenu* du placement (personnes, groupes, indispos, imposés)
   * marquent obsolète sans vider ; celles sur le *cadre* (salles, session)
   * continuent à appeler `resetSolution()` — un planning référençant une
   * salle supprimée serait faux, pas juste périmé.
   */
  solutionObsolete: false,
  /** Clés `groupe_id|creneau_id` des assignations à préserver lors des recalculs. */
  figeesKeys: new Set<string>(),
  contraintesActives: { ...CONTRAINTES_ACTIVES_DEFAUT } as Record<IdContrainte, boolean>,
  /**
   * Résumé humain du changement introduit par le dernier `runLancer` par
   * rapport au placement précédent (via `comparerRepartitions`). `null`
   * quand il n'y a rien à dire : premier calcul, session complètement
   * remise à zéro (nouvelle session / import), ou nouveau placement
   * identique à l'ancien.
   *
   * Task #60 PR-2 : après un recalcul, l'utilisateur doit voir en une
   * ligne ce qui a bougé ("2 groupes réaménagés, aucune séance perdue")
   * plutôt que de comparer visuellement deux planning affichés.
   */
  dernierChangement: null as string | null,
  /**
   * Snapshot du dernier placement calculé, indépendant de `solution`.
   *
   * Nécessaire parce que `resetSolution()` (modif cadre — salles, session)
   * met `solution = null` avant que l'utilisateur relance, ce qui priverait
   * le prochain `runLancer` d'un « avant » à comparer. Cette référence
   * *survit* à `resetSolution()` et n'est purgée que par
   * `resetPlacementCapture()` (nouvelle session, import complet — cas où
   * la comparaison n'aurait aucun sens).
   *
   * Bug attrapé au smoke Stéphane 2026-09-03 PR #61 v1 : le résumé
   * n'apparaissait jamais après une modification cadre + relance.
   */
  dernierPlacementCapture: null as PlacementItem[] | null,
})

export function lancer(inputs: SolveurInputs, options: LancerOptions): Solution {
  const t0 = performance.now()
  const ids = (Object.entries(options.contraintesActives) as [IdContrainte, boolean][])
    .filter(([, v]) => v)
    .map(([k]) => k)
  const registre = registrePersonnalise(ids)
  const figees = (options.solutionPrecedente?.assignations ?? []).filter((a) =>
    options.figeesKeys.has(`${a.groupe_id}|${a.creneau_id}`),
  )
  const inscFiltrees = preparerInscriptionsPourSolveur(inputs.inscriptions, inputs.lieu)
  const inscEnrichies = enrichirIndispos(inscFiltrees)
  const resRepartir = repartir(inputs.session, inputs.lieu, inscEnrichies, inputs.creneaux, {
    seed: 42,
    registre,
    figees,
    budgetMs: options.budgetMs,
  })
  const { placement } = resRepartir
  const { assignations, groupesPerdus } = attribuerSalles(placement, inputs.lieu, inscEnrichies, inputs.creneaux, {
    figees,
    registre,
  })
  const problemes = verifier(inputs.session, inputs.lieu, inscEnrichies, inputs.creneaux, assignations, registre)
  const cov = couverture(inputs.session, inscEnrichies, assignations)
  const diagnostics = diagnostiquer(inputs.session, inscFiltrees, inputs.creneaux, placement)
  return {
    assignations,
    problemes,
    couverture: cov,
    diagnostics,
    groupesPerdus,
    duree_ms: Math.round(performance.now() - t0),
    arret_precoce: resRepartir.arret_precoce,
    essais_executes: resRepartir.essais_executes,
  }
}

/**
 * Formate un `DiffRepartition` en une ligne humaine à afficher sous le
 * bandeau d'obsolescence. Exemples :
 *
 * - `"2 groupes réaménagés, aucune séance perdue"`
 * - `"1 groupe réaménagé, 3 séances perdues"`
 * - `"1 séance ajoutée"`  (renfort sans dégradation)
 *
 * Renvoie `null` si `diff.identiques` est vrai (rien à dire).
 *
 * "Séances perdues" = séances retirées sans compensation par un ajout dans
 * le même groupe (les déplacements purs ne comptent pas comme perte).
 */
export function formatResumeDiff(diff: DiffRepartition): string | null {
  if (diff.identiques) return null
  const parts: string[] = []

  const reamenages = diff.groupes_modifies.filter((g) => g.deplacement_pur).length
  if (reamenages > 0) {
    parts.push(`${reamenages} groupe${reamenages > 1 ? 's' : ''} réaménagé${reamenages > 1 ? 's' : ''}`)
  }

  const seancesPerdues = diff.groupes_modifies
    .filter((g) => !g.deplacement_pur)
    .reduce((s, g) => s + Math.max(0, g.creneaux_retires.length - g.creneaux_ajoutes.length), 0)
  const seancesGagnees = diff.groupes_modifies
    .filter((g) => !g.deplacement_pur)
    .reduce((s, g) => s + Math.max(0, g.creneaux_ajoutes.length - g.creneaux_retires.length), 0)

  if (seancesPerdues > 0) {
    parts.push(`${seancesPerdues} séance${seancesPerdues > 1 ? 's' : ''} perdue${seancesPerdues > 1 ? 's' : ''}`)
  } else if (reamenages > 0) {
    // Message rassurant quand seuls des réaménagements ont eu lieu.
    parts.push('aucune séance perdue')
  }
  if (seancesGagnees > 0) {
    parts.push(`${seancesGagnees} séance${seancesGagnees > 1 ? 's' : ''} ajoutée${seancesGagnees > 1 ? 's' : ''}`)
  }

  return parts.length > 0 ? parts.join(', ') : null
}

/**
 * Capture un snapshot **indépendant** des références vivantes de la
 * solution : chaque `PlacementItem` est reconstruit champ par champ, pas
 * ré-utilisé. Vigilance Stéphane 2026-09-02 : si on capturait la référence
 * `solveurStore.solution.assignations` puis qu'un maillon du pipeline
 * mutait un objet en place (au lieu de réassigner), le "avant" deviendrait
 * le "après" sans prévenir → `comparerRepartitions` renverrait
 * `identiques: true` en permanence sans qu'aucun test ne l'attrape.
 */
export function snapshotPlacement(sol: Solution | null): PlacementItem[] {
  if (sol === null) return []
  return sol.assignations.map((a) => ({ groupe_id: a.groupe_id, creneau_id: a.creneau_id }))
}

/**
 * Détermine le placement à comparer au prochain recalcul.
 *
 * Priorité : la solution courante si elle existe (cas classique — 2 calculs
 * consécutifs sans modif entre). Sinon, le `dernierPlacementCapture`
 * mémorisé, qui survit à `resetSolution()` (cas modif cadre + relance —
 * bug smoke Stéphane 2026-09-03). Si les deux sont vides → tableau vide
 * (1er calcul, aucune comparaison possible).
 */
export function determinePlacementAvant(): PlacementItem[] {
  if (solveurStore.solution !== null) return snapshotPlacement(solveurStore.solution)
  return solveurStore.dernierPlacementCapture ?? []
}

export async function runLancer(inputs: SolveurInputs): Promise<void> {
  solveurStore.calculEnCours = true
  await new Promise((r) => setTimeout(r, 20))
  // Snapshot AVANT lancer — priorité solution courante, sinon
  // dernierPlacementCapture (préservé au travers de resetSolution).
  const placementAvant = determinePlacementAvant()
  const nouvelleSolution = lancer(inputs, {
    budgetMs: solveurStore.budgetMsCourant,
    figeesKeys: solveurStore.figeesKeys,
    contraintesActives: solveurStore.contraintesActives,
    solutionPrecedente: solveurStore.solution,
  })
  solveurStore.solution = nouvelleSolution
  const placementApres = snapshotPlacement(nouvelleSolution)
  // Résumé du changement : uniquement si on avait un placement précédent
  // (pas de comparaison possible sur un premier calcul).
  //
  // Cas identiques : on affiche quand même un message explicite —
  // « aucun changement » distingue « rien n'a bougé » de « la fonction ne
  // marche pas » (feedback Stéphane 2026-09-03 : sans ce message, chaque
  // relance sans modif redéclenche le doute et impose un smoke).
  if (placementAvant.length > 0) {
    const diff = comparerRepartitions(placementAvant, placementApres)
    solveurStore.dernierChangement =
      formatResumeDiff(diff) ?? 'Aucun changement par rapport au calcul précédent'
  } else {
    solveurStore.dernierChangement = null
  }
  // Mémorise ce placement pour permettre la comparaison au prochain
  // runLancer, même si resetSolution() est appelé entre temps (modif cadre
  // nullifie solution mais laisse dernierPlacementCapture intact).
  solveurStore.dernierPlacementCapture = placementApres
  solveurStore.solutionObsolete = false
  solveurStore.calculEnCours = false
}

export function resetSolution(): void {
  solveurStore.solution = null
  solveurStore.solutionObsolete = false
  solveurStore.dernierChangement = null
  // Volontairement, on NE touche PAS à `dernierPlacementCapture` : cette
  // référence sert à comparer la prochaine relance avec l'état d'avant la
  // modification cadre. Purge complète via `resetPlacementCapture()`.
}

/**
 * Purge la référence de placement précédente. À appeler quand la session
 * est complètement remise à zéro (nouvelle session vide, import, fixture
 * démo) — la comparaison avec l'ancien placement n'a alors aucun sens.
 */
export function resetPlacementCapture(): void {
  solveurStore.dernierPlacementCapture = null
  solveurStore.dernierChangement = null
}

/**
 * Marque le placement comme périmé sans le vider. Utilisé par les éditions
 * sur le *contenu* (personnes, groupes, indispos, imposés) — l'utilisateur
 * peut enchaîner plusieurs modifs avant de vouloir relancer. Le bandeau
 * signale l'obsolescence, le bouton « Lancer » agit.
 *
 * No-op si aucune solution n'est affichée (rien à marquer périmé).
 */
export function marquerObsolete(): void {
  if (solveurStore.solution !== null) {
    solveurStore.solutionObsolete = true
  }
}

export function resetFigees(): void {
  solveurStore.figeesKeys = new Set()
}
