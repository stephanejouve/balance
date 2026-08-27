import type { Creneau } from '../domain/grille'
import type { Groupe, Inscriptions, Lieu, Pupitre } from '../domain/model'
import { enrichirIndispos } from './imposes'
import { indispoBloque } from './indispo'
import type { Assignation } from './types'
import { salleRestreinte } from './verify'

/**
 * Ajustement manuel — helper pour valider un déplacement candidat sans
 * lancer le solveur : on regarde si (nouveauCreneau, nouvelleSalle)
 * serait acceptable pour un groupe donné, sachant que la place
 * précédente sera libérée.
 */

function pupitresDe(g: Groupe, pid: string): Pupitre[] {
  return g.membres.filter((m) => m.personne_id === pid).map((m) => m.pupitre)
}

export type RaisonRefus =
  | 'creneau-butoir'
  | 'salle-inactive'
  | 'salle-restreinte'
  | 'salle-prise'
  | 'jauge-depassee'
  | 'membre-double-booke'
  | 'membre-indispo'
  | 'creneau-accole'

/**
 * Renvoie `null` si le déplacement de `originale` vers `(cibleCreneau,
 * cibleSalleId)` est acceptable, ou la raison du refus le cas échéant.
 *
 * Les autres assignations (`autres`) sont l'état actuel moins celle à
 * déplacer — le check simule le déplacement.
 */
export function testerDeplacement(
  originale: Assignation,
  cibleCreneau: Creneau,
  cibleSalleId: string,
  groupe: Groupe,
  lieu: Lieu,
  inscriptions: Inscriptions,
  autres: readonly Assignation[],
  butoir: { date: string; heure: string },
): RaisonRefus | null {
  const salleCible = lieu.salles.find((s) => s.id === cibleSalleId)
  if (!salleCible || !salleCible.actif) return 'salle-inactive'
  if (!cibleCreneau.salles.includes(cibleSalleId)) return 'salle-inactive'
  const restr = salleRestreinte(salleCible, cibleCreneau)
  if (restr === 'interdit' || restr === 'pas_reduit') return 'salle-restreinte'

  const butoirKey = `${butoir.date}T${butoir.heure.replace(':', '')}`
  if (`${cibleCreneau.date}T${cibleCreneau.debut.replace(':', '')}` >= butoirKey)
    return 'creneau-butoir'

  const effectif = new Set(groupe.membres.map((m) => m.personne_id)).size
  if (effectif > salleCible.jauge) return 'jauge-depassee'

  // Salle prise par une autre assignation sur ce créneau ?
  for (const a of autres) {
    if (a.creneau_id === cibleCreneau.id && a.salle_id === cibleSalleId) return 'salle-prise'
  }

  // Membres double-bookés ou indisponibles ?
  const enrichies = enrichirIndispos(inscriptions)
  const parId = new Map(enrichies.personnes.map((p) => [p.id, p]))
  const groupesParId = new Map(enrichies.groupes.map((g) => [g.id, g]))
  const membres = new Set(groupe.membres.map((m) => m.personne_id))
  for (const a of autres) {
    if (a.creneau_id !== cibleCreneau.id) continue
    const g2 = groupesParId.get(a.groupe_id)
    if (!g2) continue
    for (const m of g2.membres) {
      if (membres.has(m.personne_id)) return 'membre-double-booke'
    }
  }
  for (const pid of membres) {
    const p = parId.get(pid)
    if (!p) continue
    if (indispoBloque(p, cibleCreneau, pupitresDe(groupe, pid))) return 'membre-indispo'
  }

  // NB : la contrainte « pas 2 créneaux accolés pour un même groupe » n'est
  // pas vérifiée ici — laissée à la vérification indépendante post-hoc.
  return null
}

/** Version pratique : renvoie la liste des cibles valides pour un déplacement. */
export function ciblesValides(
  originale: Assignation,
  groupe: Groupe,
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: readonly Creneau[],
  autres: readonly Assignation[],
  butoir: { date: string; heure: string },
): Array<{ creneau: Creneau; salle_id: string }> {
  const out: Array<{ creneau: Creneau; salle_id: string }> = []
  for (const c of creneaux) {
    for (const sid of c.salles) {
      // Éviter la position originale
      if (c.id === originale.creneau_id && sid === originale.salle_id) continue
      const refus = testerDeplacement(originale, c, sid, groupe, lieu, inscriptions, autres, butoir)
      if (!refus) out.push({ creneau: c, salle_id: sid })
    }
  }
  return out
}
