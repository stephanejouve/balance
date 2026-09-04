import type { Creneau } from '../domain/grille'
import type { Groupe, Inscriptions, Pupitre } from '../domain/model'
import { libellePersonne } from '../domain/model'
import { enrichirIndispos } from './imposes'
import { indispoBloque } from './indispo'
import type { Assignation } from './types'

/**
 * Suggestions de renforts — brief §5 « pour un groupe cherchant un
 * musicien, qui est libre sur ses créneaux ».
 *
 * Renvoie les personnes qui :
 *  1. jouent au moins un des pupitres cherchés
 *  2. ne font pas déjà partie du groupe
 *  3. sont disponibles sur au moins un des créneaux où le groupe est
 *     placé (sinon leur venue serait purement théorique)
 * Triées par nombre de créneaux compatibles décroissant.
 */

export interface RenfortCandidat {
  personne_id: string
  nom: string
  pupitres_dispo: Pupitre[]
  creneaux_compatibles: number
  creneaux_du_groupe: number
  /** Nombre de groupes où la personne est déjà engagée. 0 = stagiaire libre. */
  nb_engagements: number
}

export function suggererRenforts(
  groupe: Groupe,
  inscriptions: Inscriptions,
  creneaux: readonly Creneau[],
  assignations: readonly Assignation[],
): RenfortCandidat[] {
  if (groupe.postes_cherches.length === 0) return []

  const enrichies = enrichirIndispos(inscriptions)
  const parId = new Map(enrichies.personnes.map((p) => [p.id, p]))
  const membresActuels = new Set(groupe.membres.map((m) => m.personne_id))
  // Extraction des pupitres cherchés depuis la structure typée
  // `PosteCherche[]`. Le `nb` par pupitre et le `role` éventuel ne sont pas
  // consommés ici — `suggererRenforts` propose des candidats par pupitre,
  // le raffinement quantitatif est côté UI (bouton d'affectation qui
  // décrémente `nb`).
  const pupitresCherches = new Set<Pupitre>(groupe.postes_cherches.map((pc) => pc.pupitre))

  // Créneaux où le groupe est déjà placé (là où on veut caser le renfort)
  const creneauxDuGroupe = assignations
    .filter((a) => a.groupe_id === groupe.id)
    .map((a) => creneaux.find((c) => c.id === a.creneau_id))
    .filter((c): c is Creneau => c != null)

  // Créneaux où une personne donnée est déjà bookée par une autre assignation
  const occPar = new Map<string, Set<string>>()
  for (const a of assignations) {
    const g = enrichies.groupes.find((x) => x.id === a.groupe_id)
    if (!g) continue
    for (const m of g.membres) {
      if (!occPar.has(m.personne_id)) occPar.set(m.personne_id, new Set())
      occPar.get(m.personne_id)!.add(a.creneau_id)
    }
  }

  // Nb de groupes où chaque personne est déjà engagée
  const engagements = new Map<string, number>()
  for (const g of inscriptions.groupes) {
    for (const pid of new Set(g.membres.map((m) => m.personne_id))) {
      engagements.set(pid, (engagements.get(pid) ?? 0) + 1)
    }
  }

  const out: RenfortCandidat[] = []
  for (const p of enrichies.personnes) {
    if (membresActuels.has(p.id)) continue
    const pupitresPersonne = p.instruments.map((i) => i.pupitre)
    const pupitresCompatibles = pupitresPersonne.filter((pup) => pupitresCherches.has(pup))
    if (pupitresCompatibles.length === 0) continue

    let compatibles = 0
    const dejaBookee = occPar.get(p.id) ?? new Set()
    for (const c of creneauxDuGroupe) {
      if (dejaBookee.has(c.id)) continue
      if (indispoBloque(p, c, pupitresCompatibles)) continue
      compatibles++
    }
    if (compatibles === 0) continue

    out.push({
      personne_id: p.id,
      nom: libellePersonne(p),
      pupitres_dispo: [...new Set(pupitresCompatibles)],
      creneaux_compatibles: compatibles,
      creneaux_du_groupe: creneauxDuGroupe.length,
      nb_engagements: engagements.get(p.id) ?? 0,
    })
  }

  // Tri : les stagiaires libres (0 engagement) d'abord, puis les moins
  // chargés, puis ceux avec le plus de créneaux compatibles.
  return out.sort(
    (a, b) =>
      a.nb_engagements - b.nb_engagements ||
      b.creneaux_compatibles - a.creneaux_compatibles ||
      a.nom.localeCompare(b.nom, 'fr'),
  )
}
