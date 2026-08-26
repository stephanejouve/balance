import type { Creneau } from '../domain/grille'
import type { Inscriptions, Lieu, Pupitre } from '../domain/model'
import type { RegistreContraintes } from './contraintes'
import { actif } from './contraintes'
import type { PlacementItem } from './solver'
import type { Assignation, GroupeSansSalle } from './types'
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
/**
 * Coût ajouté à une salle candidate quand elle ferait « voyager » un musicien
 * lourd de plus (i.e. c'est une nouvelle salle pour lui, alors qu'il en a déjà
 * une). Volontairement supérieur à `100` (coût "déjà vue") pour que la
 * stabilité l'emporte sur la rotation esthétique.
 */
const COUT_SALLE_NOUVELLE_LOURD = 140

export interface AttribuerOptions {
  seuil_grand_groupe?: number
  /**
   * Assignations pré-existantes (salle incluse) à préserver telles quelles.
   * Ces couples (groupe, créneau, salle) ne sont pas recalculés — la salle
   * qu'elles occupent est aussi retirée du pool disponible sur leur créneau.
   */
  figees?: readonly Assignation[]
  /** Registre des contraintes actives — utilisé pour la stabilité salle des
   *  musiciens à instrument lourd (préférence `preference-salle-stable-lourd`). */
  registre?: RegistreContraintes
}

export interface AttribuerResultat {
  assignations: Assignation[]
  /** Groupes que le solveur a placés horairement mais que l'attribution
   *  n'a pas pu loger — signalés au lieu d'être perdus silencieusement
   *  (bug identifié à l'audit Leader). */
  groupesPerdus: GroupeSansSalle[]
  /** Warnings textuels (dérivés de `groupesPerdus` pour affichage UI). */
  warnings: string[]
}

export function attribuerSalles(
  placement: PlacementItem[],
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  options: AttribuerOptions = {},
): AttribuerResultat {
  const seuilGrand = options.seuil_grand_groupe ?? SEUIL_GRAND_GROUPE
  const reg = options.registre
  const groupesPerdus: GroupeSansSalle[] = []
  const groupesParId = new Map(inscriptions.groupes.map((g) => [g.id, g]))
  const creneauxParId = new Map(creneaux.map((c) => [c.id, c]))
  const sallesParId = new Map(lieu.salles.map((s) => [s.id, s]))
  const sallesActives = new Set(lieu.salles.filter((s) => s.actif).map((s) => s.id))

  // Précalcule les pupitres marqués « lourds » pour chaque personne : on
  // scorera la stabilité de salle uniquement quand la personne joue son
  // instrument lourd dans le groupe considéré (ex. Prune est lourde en
  // contrebasse mais pas quand elle est au piano).
  const pupitresLourdsParPersonne = new Map<string, Set<Pupitre>>()
  for (const p of inscriptions.personnes) {
    const set = new Set<Pupitre>()
    for (const ins of p.instruments) if (ins.lourd) set.add(ins.pupitre)
    if (set.size > 0) pupitresLourdsParPersonne.set(p.id, set)
  }
  const stabiliteLourdActive =
    actif(reg, 'preference-salle-stable-lourd') && pupitresLourdsParPersonne.size > 0

  // Salles déjà utilisées par une personne lourde (toutes ses répés cumulées,
  // tous groupes confondus). Sert à pénaliser une salle « nouvelle » pour elle.
  const sallesParPersonneLourd = new Map<string, Set<string>>()

  const taille = (gid: string): number => {
    const g = groupesParId.get(gid)
    if (!g) return 0
    return new Set(g.membres.map((m) => m.personne_id)).size
  }

  /** Personnes du groupe qui jouent un instrument marqué lourd sur ce morceau. */
  const personnesLourdesDuGroupe = (gid: string): string[] => {
    const g = groupesParId.get(gid)
    if (!g) return []
    const out = new Set<string>()
    for (const m of g.membres) {
      const lourds = pupitresLourdsParPersonne.get(m.personne_id)
      if (lourds && lourds.has(m.pupitre)) out.add(m.personne_id)
    }
    return [...out]
  }

  const marquerLourdsSurSalle = (gid: string, salleId: string) => {
    if (!stabiliteLourdActive) return
    for (const pid of personnesLourdesDuGroupe(gid)) {
      if (!sallesParPersonneLourd.has(pid)) sallesParPersonneLourd.set(pid, new Set())
      sallesParPersonneLourd.get(pid)!.add(salleId)
    }
  }

  const parCreneau = new Map<string, string[]>()
  const figeesKey = new Set((options.figees ?? []).map((f) => `${f.groupe_id}|${f.creneau_id}`))
  const figeesParCreneauSalle = new Set(
    (options.figees ?? []).map((f) => `${f.creneau_id}|${f.salle_id}`),
  )
  for (const p of placement) {
    // Les figées sortent du calcul (elles ont déjà leur salle)
    if (figeesKey.has(`${p.groupe_id}|${p.creneau_id}`)) continue
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

  const assignations: Assignation[] = [...(options.figees ?? [])]
  // Pré-remplit dernier[] avec les figées pour préserver enchaînement
  for (const f of options.figees ?? []) {
    const c = creneauxParId.get(f.creneau_id)
    if (!c) continue
    dernier.set(f.groupe_id, { date: c.date, fin: c.fin, salle: f.salle_id })
    if (!dejaVues.has(f.groupe_id)) dejaVues.set(f.groupe_id, new Set())
    dejaVues.get(f.groupe_id)!.add(f.salle_id)
    marquerLourdsSurSalle(f.groupe_id, f.salle_id)
  }

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
        if (figeesParCreneauSalle.has(`${cid}|${sid}`)) return false // salle prise par une figée
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
        marquerLourdsSurSalle(gid, d.salle)
        continue
      }

      // Candidats : jauge suffisante (restrictions déjà filtrées dans `restant`)
      const cands = [...restant].filter((sid) => {
        const s = sallesParId.get(sid)
        return s != null && s.jauge >= eff
      })
      if (cands.length === 0) {
        // Groupe perdu : le solveur l'a placé à ce créneau mais aucune salle
        // active n'accueille son effectif ici. On signale au lieu de swallow
        // (bug identifié à l'audit Leader — auparavant silent `continue`).
        const sallesOuvertes = restant.size
        const sallesTropPetites = [...restant].filter((sid) => {
          const s = sallesParId.get(sid)
          return s != null && s.jauge < eff
        }).length
        const raison =
          sallesOuvertes === 0
            ? 'aucune salle disponible sur ce créneau (toutes prises par des groupes précédents)'
            : `effectif ${eff} > jauge de toutes les salles restantes (${sallesTropPetites} salle(s) trop petite(s))`
        const g = groupesParId.get(gid)
        groupesPerdus.push({
          groupe_id: gid,
          creneau_id: cid,
          effectif: eff,
          raison: g ? `${g.titre} (${eff} musiciens) : ${raison}` : raison,
        })
        continue
      }

      // Personnes lourdes du groupe (calcul une seule fois par (groupe, créneau)).
      const lourdsGroupe = stabiliteLourdActive ? personnesLourdesDuGroupe(gid) : []

      const scored = cands.map((sid) => {
        const s = sallesParId.get(sid)!
        let cost = 0
        if (dejaVues.get(gid)?.has(sid)) cost += 100
        if (!grand && s.jauge >= seuilGrand + 4) cost += 6
        // léger bonus pour attribuer les grandes salles aux grands groupes
        if (grand && s.jauge < seuilGrand + 2) cost += 4
        // Stabilité salle des musiciens lourds : coût par personne lourde
        // pour qui cette salle serait nouvelle (au-delà de sa 1ʳᵉ). La 1ʳᵉ
        // salle est gratuite (il faut bien commencer quelque part).
        if (lourdsGroupe.length > 0) {
          for (const pid of lourdsGroupe) {
            const dejaSalles = sallesParPersonneLourd.get(pid)
            if (!dejaSalles || dejaSalles.size === 0) continue // 1ʳᵉ répé
            if (!dejaSalles.has(sid)) cost += COUT_SALLE_NOUVELLE_LOURD
          }
        }
        return { sid, cost }
      })
      scored.sort((a, b) => a.cost - b.cost)
      const chosen = scored[0].sid

      assignations.push({ groupe_id: gid, creneau_id: cid, salle_id: chosen })
      restant.delete(chosen)
      if (!dejaVues.has(gid)) dejaVues.set(gid, new Set())
      dejaVues.get(gid)!.add(chosen)
      dernier.set(gid, { date: creneau.date, fin: creneau.fin, salle: chosen })
      marquerLourdsSurSalle(gid, chosen)
    }
  }

  const warnings = groupesPerdus.map((gp) => `Groupe non logé : ${gp.raison}`)
  return { assignations, groupesPerdus, warnings }
}
