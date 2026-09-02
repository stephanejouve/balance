/**
 * `comparerRepartitions` — diff ensembliste entre 2 répartitions.
 *
 * Spec Stéphane 2026-09-02 (PR-B0). Discriminants (nano-précision Leader) :
 * - Comptage cardinalité : `deplacement_pur = n_avant === n_apres AND
 *   (ajouts OR retires)` — pas `ajouts > 0 && retires > 0` naïf.
 * - Comparaison ensembliste — jamais par index tableau.
 */

import type { PlacementItem, RepartirResultat } from '../engine/solver'

export interface GroupeModifie {
  groupe_id: string
  creneaux_ajoutes: string[]
  creneaux_retires: string[]
  deplacement_pur: boolean
}

export interface DiffRepartition {
  identiques: boolean
  delta_places: number
  delta_groupes_complets: number
  nb_groupes_modifies: number
  nb_seances_ajoutees: number
  nb_seances_retirees: number
  groupes_modifies: GroupeModifie[]
}

export interface MetaComparaison {
  a: RepartirResultat
  b: RepartirResultat
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

export function comparerRepartitions(
  a: readonly PlacementItem[],
  b: readonly PlacementItem[],
  meta?: MetaComparaison,
): DiffRepartition {
  const indexA = indexerParGroupe(a)
  const indexB = indexerParGroupe(b)

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

    if (ajoutes.length === 0 && retires.length === 0) continue

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
    })
  }

  groupes_modifies.sort((g1, g2) => g1.groupe_id.localeCompare(g2.groupe_id))

  const delta_groupes_complets = meta ? meta.b.groupes_complets - meta.a.groupes_complets : 0

  return {
    identiques: groupes_modifies.length === 0,
    delta_places: b.length - a.length,
    delta_groupes_complets,
    nb_groupes_modifies: groupes_modifies.length,
    nb_seances_ajoutees,
    nb_seances_retirees,
    groupes_modifies,
  }
}
