/**
 * View-model pour l'écran de relecture des identités (Sujet C PR3).
 *
 * Extrait la logique de tri / filtrage / groupement du composant Svelte
 * pour la rendre testable en isolation.
 *
 * Doctrine (cadrage Stéphane 2026-09-01) :
 * - **Hiérarchie visuelle** : 3 niveaux au poids distinct — alertes en
 *   haut/évidence, signalements repliés, liste des personnes dessous.
 *   Un écran de 40 lignes uniformes n'est pas lu.
 * - **Garde-fou d'affichage** : ce qui s'affiche = ce que l'utilisateur
 *   a écrit. « BRUNO V. » reste « BRUNO V. », pas « bruno v. ». Sinon
 *   l'utilisateur croit à une corruption.
 * - **Franchissable sans corriger** : le bouton Valider est actif même
 *   si des alertes sont présentes — le blocage vient du contenu (l'user
 *   décide), pas de la mécanique.
 */

import type { AlerteIdentite, PersonneRelecture } from '../domain/identites'
import { normaliserNom } from '../domain/identites'
import type { AnalyseIdentitesImport } from '../io/alertes-import'

/**
 * Groupes séparés pour la hiérarchie visuelle. Le type stocké dans
 * `alertes_identite` est plat ; on le sépare ici par gravité :
 *
 * - **decisions** — homonymie + doublon → décision humaine, top écran.
 * - **signalements** — rapprochements proposés → info collapsible.
 */
export interface AlertesGroupees {
  decisions: AlerteIdentite[]
  signalements: AlerteIdentite[]
}

export function grouperAlertes(alertes: readonly AlerteIdentite[]): AlertesGroupees {
  const decisions: AlerteIdentite[] = []
  const signalements: AlerteIdentite[] = []
  for (const a of alertes) {
    if (a.type === 'rapprochement_propose') signalements.push(a)
    else decisions.push(a)
  }
  return { decisions, signalements }
}

/**
 * Tri des personnes pour affichage. Deux modes courants :
 * - `alpha` : nom d'affichage lowercase (défaut, prévisible)
 * - `engagements` : nb décroissant, puis alpha en cas d'égalité (met les
 *   personnes très engagées en tête pour repérage rapide)
 */
export type TriPersonnes = 'alpha' | 'engagements'

export function trierPersonnes(
  personnes: readonly PersonneRelecture[],
  tri: TriPersonnes,
): PersonneRelecture[] {
  const copie = [...personnes]
  if (tri === 'engagements') {
    return copie.sort(
      (a, b) =>
        b.nb_engagements - a.nb_engagements ||
        normaliserNom(a.nom_affichage).localeCompare(normaliserNom(b.nom_affichage)),
    )
  }
  return copie.sort((a, b) =>
    normaliserNom(a.nom_affichage).localeCompare(normaliserNom(b.nom_affichage)),
  )
}

/**
 * Filtre les personnes par sous-chaîne du nom. Recherche insensible à
 * la casse et aux espaces multiples (utilise `normaliserNom`). Champ
 * de recherche vide → toutes les personnes.
 */
export function filtrerPersonnes(
  personnes: readonly PersonneRelecture[],
  recherche: string,
): PersonneRelecture[] {
  const cle = normaliserNom(recherche)
  if (!cle) return [...personnes]
  return personnes.filter((p) => normaliserNom(p.nom_affichage).includes(cle))
}

/**
 * Vue synthèse pour le header : 3 compteurs bien séparés. Le total
 * d'alertes fusionne decisions + signalements mais l'user voit surtout
 * les décisions (poids visuel plus fort).
 */
export interface Synthese {
  nb_decisions: number
  nb_signalements: number
  nb_personnes: number
}

export function synthese(analyse: AnalyseIdentitesImport): Synthese {
  const { decisions, signalements } = grouperAlertes(analyse.alertes_identite)
  return {
    nb_decisions: decisions.length,
    nb_signalements: signalements.length,
    nb_personnes: analyse.personnes_relecture.length,
  }
}
