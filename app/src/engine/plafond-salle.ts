import type { Groupe, Salle } from '../domain/model'

/**
 * Plafond de salle — cadrage CD msg 6542 + 6582 (2026-09-11), issue #96.
 *
 * Un morceau ne peut occuper qu'une salle à la fois. Si son effectif de
 * PERSONNES dépasse la plus grande jauge active, il ne loge nulle part.
 * L'objet de ce module est de signaler ce risque **au moment de la saisie**
 * (étape 1b Inscriptions), pas après le placement.
 *
 * Personnes vs postes : Marc basse + chant sur un même morceau occupe
 * DEUX postes (basse pourvu, chant pourvu) mais UNE place en salle
 * (un seul corps). `MembreGroupe = { personne_id, pupitre }` — une entrée
 * par poste, on déduit les personnes via `distinct(personne_id)`.
 *
 * CD msg 6582 impose DEUX états distincts, pas un chiffre fusionné :
 *
 * 1. `ne_loge_pas` — l'effectif ACTUEL dépasse déjà la plus grande jauge.
 *    C'est un FAIT vérifiable maintenant. Action : retirer quelqu'un.
 *
 * 2. `ne_logera_plus` — l'effectif actuel tient, mais l'effectif actuel
 *    + les postes cherchés dépasse la jauge. C'est un RISQUE, réalisé si
 *    tous les cherchés sont pourvus par de nouvelles personnes. Action :
 *    réduire ce qui est cherché.
 *
 *    (Un poste cherché peut être comblé par une personne DÉJÀ présente
 *    sur un autre poste du même morceau — Marc basse pourvoit un cherche
 *    chant, l'effectif ne bouge pas. Le risque est donc un majorant : on
 *    l'annonce comme tel, pas comme un fait.)
 *
 * 3. `ok` — les deux comptes tiennent dans la plus grande jauge.
 *
 * L'appelant décide s'il affiche ok en silence ou avec un badge discret.
 */
export type EtatPlafondSalle = 'ok' | 'ne_loge_pas' | 'ne_logera_plus'

export interface PlafondSalleAnalyse {
  etat: EtatPlafondSalle
  /** Nombre de personnes DISTINCTES dans `membres` (Marc basse+chant = 1). */
  effectif_actuel: number
  /** `effectif_actuel + Σ postes_cherches.nb`. Majorant si les cherchés sont tous nouveaux. */
  effectif_max_potentiel: number
  /** Plus grande jauge parmi les salles actives, transmise pour lisibilité du message. */
  plus_grande_jauge_active: number
}

/**
 * Plus grande jauge parmi les salles marquées `actif = true`. Renvoie 0
 * si aucune salle active (défensif — l'écran a du sens tant qu'il y a
 * une salle utilisable, mais on refuse d'appeler `Math.max()` sur un tableau vide).
 */
export function plusGrandeJaugeActive(salles: readonly Salle[]): number {
  const jauges = salles.filter((s) => s.actif).map((s) => s.jauge)
  return jauges.length === 0 ? 0 : Math.max(...jauges)
}

/**
 * Analyse le plafond de salle pour un morceau donné.
 *
 * Précondition : `plus_grande_jauge_active` a été calculé par ailleurs
 * (via `plusGrandeJaugeActive(lieu.salles)`) et passé en argument — l'écran
 * a besoin de la même valeur pour tous ses groupes, autant la mémoïser en amont.
 */
export function analyserPlafondSalle(
  groupe: Pick<Groupe, 'membres' | 'postes_cherches'>,
  plus_grande_jauge_active: number,
): PlafondSalleAnalyse {
  const effectif_actuel = new Set(groupe.membres.map((m) => m.personne_id)).size
  const nb_cherches = groupe.postes_cherches.reduce((sum, pc) => sum + pc.nb, 0)
  const effectif_max_potentiel = effectif_actuel + nb_cherches

  // Cas dégénéré : aucune salle active → tout groupe non vide déclenche
  // `ne_loge_pas`. Peu probable en usage réel, mais mieux vaut le signaler
  // que produire un `ok` faussement rassurant.
  if (plus_grande_jauge_active <= 0) {
    return {
      etat: effectif_actuel > 0 ? 'ne_loge_pas' : 'ok',
      effectif_actuel,
      effectif_max_potentiel,
      plus_grande_jauge_active,
    }
  }

  let etat: EtatPlafondSalle
  if (effectif_actuel > plus_grande_jauge_active) {
    etat = 'ne_loge_pas'
  } else if (effectif_max_potentiel > plus_grande_jauge_active) {
    etat = 'ne_logera_plus'
  } else {
    etat = 'ok'
  }

  return {
    etat,
    effectif_actuel,
    effectif_max_potentiel,
    plus_grande_jauge_active,
  }
}
