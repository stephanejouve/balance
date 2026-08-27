import type { FonctionsActivees, Inscriptions, Lieu } from '../domain/model'

/**
 * Cascade des « fonctions activées » du lieu vers le solveur et la
 * couche vues.
 *
 * Une case décochée doit signifier « n'entre pas dans le calcul », pas
 * seulement « ne s'affiche pas » — sinon on obtient un planning que
 * personne ne peut expliquer, avec des créneaux inexplicablement
 * interdits par des contraintes invisibles.
 *
 * Ce module isole cette cascade pour qu'elle soit auditée et testée
 * indépendamment de l'UI. Comportement par défaut (tout à `true`) :
 * strictement inchangé par rapport à main.
 */

/**
 * Normalise l'état des fonctions activées pour respecter les dépendances
 * qui ne peuvent pas être exprimées en Zod (couplages entre champs) :
 *
 * - `conducteur` implique `ordre_passage` : impossible de minuter un
 *   spectacle sans savoir dans quel ordre il passe. Si `conducteur=true`
 *   et `ordre_passage=false` (état incohérent qu'un JSON édité à la
 *   main pourrait produire), on force `ordre_passage=true`.
 *
 * Retourne un nouvel objet — n'altère pas l'entrée. La règle « décocher
 * ordre_passage décoche conducteur » est appliquée par l'UI au moment
 * du clic (pas ici, où on ne connaît pas l'intention utilisateur).
 */
export function normaliserFonctionsActivees(f: FonctionsActivees): FonctionsActivees {
  if (f.conducteur && !f.ordre_passage) {
    return { ...f, ordre_passage: true }
  }
  return f
}

/**
 * Prépare les inscriptions pour le solveur en filtrant selon les
 * fonctions activées du lieu.
 *
 * Actuellement une seule bascule affecte le pipeline solveur :
 *
 * - `proposes=false` → les imposés ne sont pas transmis. L'appelant
 *   voit un `Inscriptions` où `imposes = []` — `enrichirIndispos` ne
 *   génère alors aucune contrainte de séance imposée.
 *
 * Les autres bascules (`conducteur`, `ordre_passage`, `charge`,
 * `renforts`) n'ont pas d'impact solveur direct — elles filtrent
 * côté UI (vues, suggestions, alertes). Cette fonction n'a rien à en
 * faire pour l'instant.
 *
 * **Ne mute pas l'entrée** : retourne un `Inscriptions` filtré si un
 * filtre s'applique, sinon renvoie l'objet original (structural sharing).
 */
export function preparerInscriptionsPourSolveur(
  inscriptions: Inscriptions,
  lieu: Lieu,
): Inscriptions {
  if (!lieu.fonctionsActivees.proposes) {
    return { ...inscriptions, imposes: [] }
  }
  return inscriptions
}
