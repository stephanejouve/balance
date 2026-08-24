/**
 * Registre déclaratif des contraintes du moteur (brief §0 : « seule
 * exigence structurante = modèle de contraintes séparé du moteur + règles
 * activables une par une »).
 *
 * Ce fichier ne code pas les vérifications elles-mêmes — celles-ci vivent
 * dans `verify.ts` et `solver.ts` — mais fournit les identifiants et les
 * pré-configurations. Chaque test dans le moteur est encadré par un
 * `if (!registre.has(id)) return …` : quand une contrainte est retirée
 * du registre, le solveur et la vérification indépendante l'ignorent.
 *
 * Objectif : brancher CP-SAT ou changer les règles sans reprendre la
 * boucle centrale.
 */

export type IdContrainte =
  /** Une personne ne peut pas être à deux endroits au même moment. */
  | 'personne-unique-moment'
  /** Une salle ne peut pas être prise deux fois au même créneau. */
  | 'salle-unique-groupe'
  /** Le groupe ne dépasse pas la jauge de la salle. */
  | 'jauge-salle'
  /** Une indispo déclarée (jour/horaire/rôle) bloque le placement. */
  | 'personne-indispo'
  /** Toutes les répétitions tombent avant la date butoir. */
  | 'avant-butoir'
  /** La salle assignée doit figurer dans la liste ouverte au créneau. */
  | 'salle-hors-creneau'
  /** Pas deux répétitions consécutives (fin d'un = début du suivant). */
  | 'creneaux-consecutifs'

export interface RegistreContraintes {
  actives: Set<IdContrainte>
}

/** Cadre V1 (brief §0) : les 4 dures + intégrité salle. */
export const REGISTRE_V1: readonly IdContrainte[] = [
  'personne-unique-moment',
  'salle-unique-groupe',
  'personne-indispo',
  'avant-butoir',
  'jauge-salle',
  'salle-hors-creneau',
]

/** Toutes les contraintes du prototype, y compris « pas consécutif » (P6). */
export const REGISTRE_TOUT: readonly IdContrainte[] = [
  ...REGISTRE_V1,
  'creneaux-consecutifs',
]

export function registreDefaut(): RegistreContraintes {
  return { actives: new Set(REGISTRE_TOUT) }
}

export function registreV1(): RegistreContraintes {
  return { actives: new Set(REGISTRE_V1) }
}

export function registrePersonnalise(ids: readonly IdContrainte[]): RegistreContraintes {
  return { actives: new Set(ids) }
}

export function actif(registre: RegistreContraintes | undefined, id: IdContrainte): boolean {
  if (!registre) return true // rétro-compat : sans registre passé, tout est actif
  return registre.actives.has(id)
}
