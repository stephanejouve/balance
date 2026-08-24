import type { Creneau } from '../domain/grille'
import type { Inscriptions, Lieu } from '../domain/model'
import type { PlacementItem } from './solver'
import type { Assignation } from './types'
import { salleRestreinte } from './verify'

/**
 * Attribution des salles — passe séparée après le placement horaire
 * (brief §4). Heuristique greedy :
 *   1. tri chronologique des créneaux
 *   2. pour chaque créneau, tri des groupes par « qui enchaîne d'abord,
 *      puis par taille décroissante »
 *   3. si un groupe enchaîne depuis le créneau précédent (même jour,
 *      créneau accolé) et sa salle reste disponible → il y reste
 *   4. sinon, coût minimal : jauge suffisante, éviter réutilisation d'une
 *      salle déjà employée par ce groupe, éviter gaspiller une grande
 *      salle pour un petit groupe
 */

const SEUIL_GRAND_GROUPE = 6

export interface AttribuerOptions {
  seuil_grand_groupe?: number
}

export function attribuerSalles(
  placement: PlacementItem[],
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  options: AttribuerOptions = {},
): Assignation[] {
  const seuilGrand = options.seuil_grand_groupe ?? SEUIL_GRAND_GROUPE
  const groupesParId = new Map(inscriptions.groupes.map((g) => [g.id, g]))
  const creneauxParId = new Map(creneaux.map((c) => [c.id, c]))
  const sallesParId = new Map(lieu.salles.map((s) => [s.id, s]))
  const sallesActives = new Set(lieu.salles.filter((s) => s.actif).map((s) => s.id))

  const taille = (gid: string): number => {
    const g = groupesParId.get(gid)
    if (!g) return 0
    return new Set(g.membres.map((m) => m.personne_id)).size
  }

  const parCreneau = new Map<string, string[]>()
  for (const p of placement) {
    if (!parCreneau.has(p.creneau_id)) parCreneau.set(p.creneau_id, [])
    parCreneau.get(p.creneau_id)!.push(p.groupe_id)
  }

  interface Dernier {
    date: string
    fin: string
    salle: string
  }
  const dejaVues = new Map<string, Set<string>>()
  const dernier = new Map<string, Dernier>()

  const assignations: Assignation[] = []

  const cids = [...parCreneau.keys()].sort((a, b) => {
    const ca = creneauxParId.get(a)
    const cb = creneauxParId.get(b)
    if (!ca || !cb) return 0
    return `${ca.date}T${ca.debut}`.localeCompare(`${cb.date}T${cb.debut}`)
  })

  for (const cid of cids) {
    const creneau = creneauxParId.get(cid)
    if (!creneau) continue
    const restant = new Set(
      creneau.salles.filter((sid) => {
        if (!sallesActives.has(sid)) return false
        const s = sallesParId.get(sid)
        if (!s) return true
        const restr = salleRestreinte(s, creneau)
        return restr !== 'interdit' && restr !== 'pas_reduit'
      }),
    )
    const groupesIci = [...(parCreneau.get(cid) ?? [])]

    // Ordre : ceux qui enchaînent d'abord, puis les grands
    groupesIci.sort((a, b) => {
      const da = dernier.get(a)
      const db = dernier.get(b)
      const enchainA = da && da.date === creneau.date && da.fin === creneau.debut ? 1 : 0
      const enchainB = db && db.date === creneau.date && db.fin === creneau.debut ? 1 : 0
      if (enchainA !== enchainB) return enchainB - enchainA
      return taille(b) - taille(a)
    })

    for (const gid of groupesIci) {
      const eff = taille(gid)
      const grand = eff >= seuilGrand
      const d = dernier.get(gid)
      const enchaine = d && d.date === creneau.date && d.fin === creneau.debut

      // Enchaînement : rester sur place si possible
      if (enchaine && restant.has(d.salle)) {
        assignations.push({ groupe_id: gid, creneau_id: cid, salle_id: d.salle })
        restant.delete(d.salle)
        if (!dejaVues.has(gid)) dejaVues.set(gid, new Set())
        dejaVues.get(gid)!.add(d.salle)
        dernier.set(gid, { date: creneau.date, fin: creneau.fin, salle: d.salle })
        continue
      }

      // Candidats : jauge suffisante (restrictions déjà filtrées dans `restant`)
      const cands = [...restant].filter((sid) => {
        const s = sallesParId.get(sid)
        return s != null && s.jauge >= eff
      })
      if (cands.length === 0) continue // pas de salle possible : le groupe est perdu

      const scored = cands.map((sid) => {
        const s = sallesParId.get(sid)!
        let cost = 0
        if (dejaVues.get(gid)?.has(sid)) cost += 100
        if (!grand && s.jauge >= seuilGrand + 4) cost += 6
        // léger bonus pour attribuer les grandes salles aux grands groupes
        if (grand && s.jauge < seuilGrand + 2) cost += 4
        return { sid, cost }
      })
      scored.sort((a, b) => a.cost - b.cost)
      const chosen = scored[0].sid

      assignations.push({ groupe_id: gid, creneau_id: cid, salle_id: chosen })
      restant.delete(chosen)
      if (!dejaVues.has(gid)) dejaVues.set(gid, new Set())
      dejaVues.get(gid)!.add(chosen)
      dernier.set(gid, { date: creneau.date, fin: creneau.fin, salle: chosen })
    }
  }

  return assignations
}
