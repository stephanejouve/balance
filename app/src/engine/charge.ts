import type { Creneau } from '../domain/grille'
import type { Inscriptions } from '../domain/model'
import type { Assignation } from './types'

/**
 * Charge par musicien — brief §5 « total de répétitions, alerte au-delà
 * d'un seuil ». Compte les créneaux par personne (unique par (jour) et
 * total sur la semaine).
 */

export interface ChargePersonne {
  personne_id: string
  total: number
  max_jour: number
  par_jour: Array<{ date: string; n: number }>
}

export function chargeParMusicien(
  inscriptions: Inscriptions,
  creneaux: readonly Creneau[],
  assignations: readonly Assignation[],
): Map<string, ChargePersonne> {
  const creneauxParId = new Map(creneaux.map((c) => [c.id, c]))
  const groupesParId = new Map(inscriptions.groupes.map((g) => [g.id, g]))

  // Comptage par (personne, date)
  const par = new Map<string, Map<string, number>>()
  for (const a of assignations) {
    const c = creneauxParId.get(a.creneau_id)
    const g = groupesParId.get(a.groupe_id)
    if (!c || !g) continue
    const membres = new Set(g.membres.map((m) => m.personne_id))
    for (const pid of membres) {
      if (!par.has(pid)) par.set(pid, new Map())
      const m = par.get(pid)!
      m.set(c.date, (m.get(c.date) ?? 0) + 1)
    }
  }
  // Les séances imposées comptent aussi comme charge
  for (const im of inscriptions.imposes) {
    for (const pid of im.membres) {
      if (!par.has(pid)) par.set(pid, new Map())
      const m = par.get(pid)!
      for (const s of im.seances) {
        m.set(s.date, (m.get(s.date) ?? 0) + 1)
      }
    }
  }

  const out = new Map<string, ChargePersonne>()
  for (const [pid, jours] of par) {
    let total = 0
    let maxJour = 0
    const parJour: ChargePersonne['par_jour'] = []
    for (const [date, n] of [...jours.entries()].sort()) {
      parJour.push({ date, n })
      total += n
      if (n > maxJour) maxJour = n
    }
    out.set(pid, { personne_id: pid, total, max_jour: maxJour, par_jour: parJour })
  }
  return out
}
