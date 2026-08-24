/**
 * Types du moteur de placement : sortie du solveur et signalements de
 * vérification. Volontairement pauvre en logique — les fonctions vivent
 * dans `contraintes.ts`, `verify.ts` et `solver.ts`.
 */

export interface Assignation {
  groupe_id: string
  creneau_id: string
  salle_id: string
}

export type ProblemeType =
  | 'personne-double-bookee'
  | 'salle-double-bookee'
  | 'jauge-depassee'
  | 'personne-indispo'
  | 'apres-butoir'
  | 'creneaux-consecutifs'
  | 'salle-hors-creneau'

export interface Probleme {
  type: ProblemeType
  message: string
  creneau_id?: string
  personne_id?: string
  groupe_id?: string
  salle_id?: string
}

export interface CouvertureGroupe {
  groupe_id: string
  obtenu: number
  cible: number
  min: number
}

export interface Solution {
  assignations: Assignation[]
  problemes: Probleme[]
  couverture: CouvertureGroupe[]
}
