import type { Creneau } from '../domain/grille'
import type { Inscriptions } from '../domain/model'
import type { Lieu, Session } from '../domain/model'
import { attribuerSalles } from '../engine/allocate-rooms'
import type { IdContrainte } from '../engine/contraintes'
import { registrePersonnalise } from '../engine/contraintes'
import { diagnostiquer } from '../engine/diagnostic'
import { preparerInscriptionsPourSolveur } from '../engine/fonctions-activees'
import { enrichirIndispos } from '../engine/imposes'
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

export async function runLancer(inputs: SolveurInputs): Promise<void> {
  solveurStore.calculEnCours = true
  await new Promise((r) => setTimeout(r, 20))
  solveurStore.solution = lancer(inputs, {
    budgetMs: solveurStore.budgetMsCourant,
    figeesKeys: solveurStore.figeesKeys,
    contraintesActives: solveurStore.contraintesActives,
    solutionPrecedente: solveurStore.solution,
  })
  solveurStore.solutionObsolete = false
  solveurStore.calculEnCours = false
}

export function resetSolution(): void {
  solveurStore.solution = null
  solveurStore.solutionObsolete = false
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
