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
import { grouperAlertesCoherence, type AlerteCoherence } from '../domain/coherence'
import type { AnalyseIdentitesImport } from '../io/alertes-import'

/**
 * Seuil au-delà duquel les `stagiaire_orphelin` s'agrègent en une seule
 * ligne dépliable au lieu d'être listés individuellement.
 *
 * Justification Stéphane 2026-09-01 : sur `balance-stress-test.xlsx`
 * 21 des 84 stagiaires ne sont dans aucun morceau (répertoire des
 * intervenants — situation normale). 21 lignes noieraient les alertes
 * réelles. « Trois occurrences se listent, vingt et une s'additionnent. »
 *
 * Aggrégation limitée au type `stagiaire_orphelin` — les autres types
 * (pupitre_contredit, indispo_percutee, etc.) sont rares par nature et
 * chaque occurrence porte une info actionnable spécifique.
 */
export const SEUIL_AGREGATION_ORPHELINS = 3

export interface SignalementsCoherenceOrganises {
  /** Signalements affichés individuellement (tous types sauf orphelins). */
  autres: AlerteCoherence[]
  /** Orphelins listés individuellement (si N ≤ SEUIL) ou vide (si agrégés). */
  orphelins_individuels: Extract<AlerteCoherence, { type: 'stagiaire_orphelin' }>[]
  /** Orphelins agrégés (si N > SEUIL) — l'UI rend 1 ligne dépliable. */
  orphelins_agreges: Extract<AlerteCoherence, { type: 'stagiaire_orphelin' }>[]
}

export function organiserSignalementsCoherence(
  signalements: readonly AlerteCoherence[],
): SignalementsCoherenceOrganises {
  const orphelins: Extract<AlerteCoherence, { type: 'stagiaire_orphelin' }>[] = []
  const autres: AlerteCoherence[] = []
  for (const s of signalements) {
    if (s.type === 'stagiaire_orphelin') orphelins.push(s)
    else autres.push(s)
  }
  if (orphelins.length > SEUIL_AGREGATION_ORPHELINS) {
    return { autres, orphelins_individuels: [], orphelins_agreges: orphelins }
  }
  return { autres, orphelins_individuels: orphelins, orphelins_agreges: [] }
}

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
 *
 * Les compteurs `nb_decisions` et `nb_signalements` cumulent
 * identité (A-H) + cohérence entre onglets (I-P) — l'utilisateur voit
 * un seul chiffre par niveau de gravité.
 */
export interface Synthese {
  nb_decisions: number
  nb_signalements: number
  nb_personnes: number
}

export function synthese(analyse: AnalyseIdentitesImport): Synthese {
  const { decisions, signalements } = grouperAlertes(analyse.alertes_identite)
  const coh = grouperAlertesCoherence(analyse.alertes_coherence)
  return {
    nb_decisions: decisions.length + coh.alertes.length,
    nb_signalements: signalements.length + coh.signalements.length,
    nb_personnes: analyse.personnes_relecture.length,
  }
}
