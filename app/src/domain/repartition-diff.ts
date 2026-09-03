/**
 * `comparerRepartitions` — diff ensembliste entre 2 répartitions.
 *
 * Spec Stéphane 2026-09-02 (PR-B0). Discriminants (nano-précision Leader) :
 * - Comptage cardinalité : `deplacement_pur = n_avant === n_apres AND
 *   (ajouts OR retires)` — pas `ajouts > 0 && retires > 0` naïf.
 * - Comparaison ensembliste — jamais par index tableau.
 */

import type { PlacementItem, RepartirResultat } from '../engine/solver'
import type { Assignation } from '../engine/types'

/**
 * Séance conservée (même groupe, même créneau) mais dans une salle différente
 * par rapport au placement précédent. Extension du diff décidée après le smoke
 * Stéphane 2026-09-03 v20260903.1623 : désactiver une salle occupée déplace des
 * séances de lieu sans changer aucun horaire — sans cette dimension, le
 * comparateur renvoyait « aucun changement » alors que la moitié du planning
 * migrait ailleurs.
 */
export interface ChangementSalle {
  creneau_id: string
  salle_avant: string
  salle_apres: string
}

export interface GroupeModifie {
  groupe_id: string
  creneaux_ajoutes: string[]
  creneaux_retires: string[]
  deplacement_pur: boolean
  /**
   * Séances au même créneau mais dans une salle différente. Vide en mode
   * dégradé (assignations avec salles non fournies) — voir signature de
   * `comparerRepartitions`.
   */
  changements_salle: ChangementSalle[]
}

export interface DiffRepartition {
  identiques: boolean
  delta_places: number
  delta_groupes_complets: number
  nb_groupes_modifies: number
  /** Nombre total de **créneaux** ajoutés (pas de changements de salle). */
  nb_seances_ajoutees: number
  /** Nombre total de **créneaux** retirés (pas de changements de salle). */
  nb_seances_retirees: number
  /**
   * Nombre total de changements de salle (somme des `changements_salle`
   * de tous les groupes) — orthogonal aux ajouts/retraits de créneaux.
   * Toujours 0 si `assignationsAvecSalles` n'est pas passé au comparateur
   * — mode dégradé rétro-compatible.
   */
  nb_changements_salle: number
  groupes_modifies: GroupeModifie[]
}

export interface MetaComparaison {
  a: RepartirResultat
  b: RepartirResultat
}

/**
 * Assignations complètes (avec `salle_id`) avant et après recalcul. Nécessaire
 * pour détecter les changements de salle — `PlacementItem` ne porte que
 * `groupe_id` et `creneau_id` par contrat historique (spec 2026-09-02).
 * Optionnel : sans lui, le comparateur fonctionne en mode dégradé (aucun
 * changement de salle détecté, `nb_changements_salle = 0`).
 */
export interface AssignationsAvecSalles {
  avant: readonly Assignation[]
  apres: readonly Assignation[]
}

function indexerParGroupe(items: readonly PlacementItem[]): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const item of items) {
    let creneaux = index.get(item.groupe_id)
    if (!creneaux) {
      creneaux = new Set()
      index.set(item.groupe_id, creneaux)
    }
    creneaux.add(item.creneau_id)
  }
  return index
}

/** Index `(groupe_id, creneau_id) → salle_id` pour lookup O(1) des salles. */
function indexerSallesParPlacement(
  assignations: readonly Assignation[],
): Map<string, string> {
  const index = new Map<string, string>()
  for (const a of assignations) {
    index.set(`${a.groupe_id}|${a.creneau_id}`, a.salle_id)
  }
  return index
}

export function comparerRepartitions(
  a: readonly PlacementItem[],
  b: readonly PlacementItem[],
  meta?: MetaComparaison,
  assignationsAvecSalles?: AssignationsAvecSalles,
): DiffRepartition {
  const indexA = indexerParGroupe(a)
  const indexB = indexerParGroupe(b)

  // Mode dégradé si les assignations complètes ne sont pas fournies : maps
  // vides, aucune détection de changement de salle possible. Contrat
  // rétro-compatible (spec Stéphane 2026-09-03 : « meta absent → pas d'erreur »).
  const sallesAvant = assignationsAvecSalles
    ? indexerSallesParPlacement(assignationsAvecSalles.avant)
    : new Map<string, string>()
  const sallesApres = assignationsAvecSalles
    ? indexerSallesParPlacement(assignationsAvecSalles.apres)
    : new Map<string, string>()

  const groupesIds = new Set<string>([...indexA.keys(), ...indexB.keys()])
  const groupes_modifies: GroupeModifie[] = []
  let nb_seances_ajoutees = 0
  let nb_seances_retirees = 0

  for (const groupe_id of groupesIds) {
    const creneauxA = indexA.get(groupe_id) ?? new Set<string>()
    const creneauxB = indexB.get(groupe_id) ?? new Set<string>()

    const ajoutes: string[] = []
    for (const c of creneauxB) if (!creneauxA.has(c)) ajoutes.push(c)
    const retires: string[] = []
    for (const c of creneauxA) if (!creneauxB.has(c)) retires.push(c)

    // Changements de salle sur les créneaux communs (avant ∩ après) —
    // uniquement si les assignations avec salles ont été fournies.
    const changements_salle: ChangementSalle[] = []
    if (assignationsAvecSalles) {
      for (const c of creneauxA) {
        if (!creneauxB.has(c)) continue
        const salle_avant = sallesAvant.get(`${groupe_id}|${c}`)
        const salle_apres = sallesApres.get(`${groupe_id}|${c}`)
        if (salle_avant && salle_apres && salle_avant !== salle_apres) {
          changements_salle.push({
            creneau_id: c,
            salle_avant,
            salle_apres,
          })
        }
      }
      changements_salle.sort((c1, c2) => c1.creneau_id.localeCompare(c2.creneau_id))
    }

    // Un groupe est modifié s'il a un créneau ajouté/retiré OU un changement
    // de salle sur un créneau conservé. Sinon on skip.
    if (ajoutes.length === 0 && retires.length === 0 && changements_salle.length === 0) continue

    ajoutes.sort()
    retires.sort()
    nb_seances_ajoutees += ajoutes.length
    nb_seances_retirees += retires.length

    const n_avant = creneauxA.size
    const n_apres = creneauxB.size
    const deplacement_pur = n_avant === n_apres && (ajoutes.length > 0 || retires.length > 0)

    groupes_modifies.push({
      groupe_id,
      creneaux_ajoutes: ajoutes,
      creneaux_retires: retires,
      deplacement_pur,
      changements_salle,
    })
  }

  groupes_modifies.sort((g1, g2) => g1.groupe_id.localeCompare(g2.groupe_id))

  const delta_groupes_complets = meta ? meta.b.groupes_complets - meta.a.groupes_complets : 0
  const nb_changements_salle = groupes_modifies.reduce(
    (s, g) => s + g.changements_salle.length,
    0,
  )

  return {
    identiques: groupes_modifies.length === 0,
    delta_places: b.length - a.length,
    delta_groupes_complets,
    nb_groupes_modifies: groupes_modifies.length,
    nb_seances_ajoutees,
    nb_seances_retirees,
    nb_changements_salle,
    groupes_modifies,
  }
}
