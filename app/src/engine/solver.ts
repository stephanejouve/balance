import type { Creneau } from '../domain/grille'
import type { Groupe, Inscriptions, Lieu, Personne, Pupitre, Session } from '../domain/model'
import { makeRng, shuffle } from './rng'

/**
 * Placement horaire — port structuré de `repartir()` (prototype
 * `repartiteur_repetitions.html`). Placement sans salle : l'attribution
 * salles est une passe séparée (cf. `allocate-rooms.ts`, brief §4).
 *
 * Approche : random restart heuristique (2500 essais par défaut) avec
 * tours de table (chaque groupe obtient sa 1ʳᵉ répétition, puis la 2ᵉ,
 * etc.) et scoring des candidats. Le seed rend la sortie reproductible.
 */

export interface RepartirOptions {
  seed?: number
  maxEssais?: number
}

export interface PlacementItem {
  groupe_id: string
  creneau_id: string
}

export interface RepartirResultat {
  placement: PlacementItem[]
  groupes_complets: number
  places_totales: number
  jours_couverts: number
}

interface EtatEssai {
  plan: Map<string, string[]>
  occSlot: Map<string, number>
  occPersonne: Map<string, Set<string>>
  joursGroupe: Map<string, Set<string>>
}

function toMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function membresUniques(g: Groupe): string[] {
  return [...new Set(g.membres.map((m) => m.personne_id))]
}

function pupitresDe(personne_id: string, g: Groupe): Pupitre[] {
  return g.membres.filter((m) => m.personne_id === personne_id).map((m) => m.pupitre)
}

function indispoBloque(p: Personne, c: Creneau, pupitres: Pupitre[]): boolean {
  return p.indispos.some((ind) => {
    if (ind.jours.length > 0 && !ind.jours.includes(c.date)) return false
    if (ind.roles.length > 0 && !pupitres.some((r) => ind.roles.includes(r))) return false
    if (ind.debut && c.debut < ind.debut) return false
    if (ind.fin && c.debut >= ind.fin) return false
    if (!ind.debut && !ind.fin) return true
    return true
  })
}

function accolAvecPlan(
  c: Creneau,
  planGroupe: string[],
  creneauxParId: Map<string, Creneau>,
): boolean {
  return planGroupe.some((sid) => {
    const s = creneauxParId.get(sid)
    if (!s || s.date !== c.date) return false
    return s.fin === c.debut || c.fin === s.debut
  })
}

/**
 * Tente de déloger les groupes bloqueurs d'un créneau afin d'y placer un
 * groupe incomplet. Un bloqueur est délogeable si (1) il ne partage pas
 * son créneau avec plusieurs groupes conflictuels et (2) on peut le
 * reloger ailleurs. Version conservatrice du prototype.
 */
function reparer(
  groupes: Groupe[],
  memP: Map<string, string[]>,
  e: EtatEssai,
  creneaux: Creneau[],
  estLibre: (c: Creneau, g: Groupe, e: EtatEssai, contraintJour: boolean) => boolean,
  poser: (c: Creneau, g: Groupe, e: EtatEssai) => void,
): void {
  const retirer = (c: Creneau, g: Groupe) => {
    e.occSlot.set(c.id, Math.max(0, (e.occSlot.get(c.id) ?? 0) - 1))
    const planG = e.plan.get(g.id)
    if (planG) e.plan.set(g.id, planG.filter((id) => id !== c.id))
    // recalcule les jours du groupe
    const jours = new Set<string>()
    ;(e.plan.get(g.id) ?? []).forEach((sid) => {
      const s = creneaux.find((x) => x.id === sid)
      if (s) jours.add(s.date)
    })
    e.joursGroupe.set(g.id, jours)
    for (const pid of memP.get(g.id) ?? []) e.occPersonne.get(pid)?.delete(c.id)
  }

  const cible = 3 // consommé après avoir vérifié plan.length < cible

  for (const g of groupes) {
    let garde = 0
    while ((e.plan.get(g.id)?.length ?? 0) < cible && garde++ < 40) {
      let fait = false
      for (const c of creneaux) {
        if (fait) break
        const planG = e.plan.get(g.id) ?? []
        if (planG.includes(c.id)) continue

        // Identifier les groupes bloqueurs (qui partagent un membre)
        const membresG = memP.get(g.id) ?? []
        const bloqueurs: Groupe[] = []
        for (const g2 of groupes) {
          if (g2.id === g.id) continue
          if (!(e.plan.get(g2.id) ?? []).includes(c.id)) continue
          const m2 = memP.get(g2.id) ?? []
          if (m2.some((pid) => membresG.includes(pid))) bloqueurs.push(g2)
        }
        // Contrainte : au plus 1 bloqueur (sinon délogement en cascade)
        if (bloqueurs.length > 1) continue
        const occ = e.occSlot.get(c.id) ?? 0
        // Il faut que la salle se libère après délogement
        if (occ - bloqueurs.length >= c.salles.length) continue

        for (const bloqueur of bloqueurs) {
          retirer(c, bloqueur)
          // Chercher un nouveau créneau pour le bloqueur
          const relog = creneaux.find(
            (cc) => !(e.plan.get(bloqueur.id) ?? []).includes(cc.id) && estLibre(cc, bloqueur, e, true),
          )
          if (!relog) {
            // Rétablir le bloqueur à sa place
            poser(c, bloqueur, e)
            break
          }
          poser(relog, bloqueur, e)
        }
        if (estLibre(c, g, e, false)) {
          poser(c, g, e)
          fait = true
        }
      }
      if (!fait) break
    }
  }
}

export function repartir(
  session: Session,
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  options: RepartirOptions = {},
): RepartirResultat {
  const maxEssais = options.maxEssais ?? 2500
  const rng = makeRng(options.seed ?? 1)
  const personnesParId = new Map(inscriptions.personnes.map((p) => [p.id, p]))
  const creneauxParId = new Map(creneaux.map((c) => [c.id, c]))
  const sallesActives = new Set(lieu.salles.filter((s) => s.actif).map((s) => s.id))
  const groupes = inscriptions.groupes
  const memP = new Map(groupes.map((g) => [g.id, membresUniques(g)]))
  const cible = session.repetitions_visees
  const total = groupes.length

  const sallesUtilisables = (c: Creneau) => c.salles.filter((sid) => sallesActives.has(sid)).length

  const estLibre = (c: Creneau, g: Groupe, e: EtatEssai, contraintJour: boolean): boolean => {
    const cap = sallesUtilisables(c)
    if ((e.occSlot.get(c.id) ?? 0) >= cap) return false
    const planG = e.plan.get(g.id) ?? []
    if (accolAvecPlan(c, planG, creneauxParId)) return false
    if (contraintJour && e.joursGroupe.get(g.id)?.has(c.date)) return false
    for (const pid of memP.get(g.id) ?? []) {
      if (e.occPersonne.get(pid)?.has(c.id)) return false
      const p = personnesParId.get(pid)
      if (!p) continue
      if (indispoBloque(p, c, pupitresDe(pid, g))) return false
    }
    return true
  }

  const poser = (c: Creneau, g: Groupe, e: EtatEssai) => {
    e.occSlot.set(c.id, (e.occSlot.get(c.id) ?? 0) + 1)
    if (!e.plan.has(g.id)) e.plan.set(g.id, [])
    e.plan.get(g.id)!.push(c.id)
    if (!e.joursGroupe.has(g.id)) e.joursGroupe.set(g.id, new Set())
    e.joursGroupe.get(g.id)!.add(c.date)
    for (const pid of memP.get(g.id) ?? []) {
      if (!e.occPersonne.has(pid)) e.occPersonne.set(pid, new Set())
      e.occPersonne.get(pid)!.add(c.id)
    }
  }

  const score = (c: Creneau, g: Groupe, e: EtatEssai): number => {
    let v = 0
    const cap = sallesUtilisables(c)
    const occ = e.occSlot.get(c.id) ?? 0
    v += (cap - occ) * 3 // préférer les créneaux avec de la marge
    v -= occ * 9 // pénaliser la saturation
    const planG = e.plan.get(g.id) ?? []
    for (const sid of planG) {
      const s = creneauxParId.get(sid)
      if (!s) continue
      if (s.date === c.date) v -= 15
      if (s.date === c.date && Math.abs(toMinutes(s.debut) - toMinutes(c.debut)) < 240) v -= 10
    }
    return v
  }

  interface Best {
    plan: Map<string, string[]>
    complets: number
    total: number
    etale: number
  }
  let best: Best | null = null

  for (let essai = 0; essai < maxEssais; essai++) {
    const e: EtatEssai = {
      plan: new Map(),
      occSlot: new Map(),
      occPersonne: new Map(),
      joursGroupe: new Map(),
    }
    groupes.forEach((g) => e.plan.set(g.id, []))

    for (let tour = 0; tour < cible; tour++) {
      const ordre =
        essai === 0
          ? [...groupes].sort(
              (a, b) => (memP.get(b.id)?.length ?? 0) - (memP.get(a.id)?.length ?? 0),
            )
          : shuffle(groupes, rng)
      for (const g of ordre) {
        if ((e.plan.get(g.id)?.length ?? 0) > tour) continue
        let cands = creneaux.filter((c) => estLibre(c, g, e, true))
        if (cands.length === 0) {
          cands = creneaux.filter(
            (c) => estLibre(c, g, e, false) && !(e.plan.get(g.id) ?? []).includes(c.id),
          )
        }
        if (cands.length === 0) continue
        cands.sort((a, b) => score(b, g, e) - score(a, g, e))
        const k = essai === 0 ? 0 : Math.floor(rng() * Math.min(4, cands.length))
        poser(cands[k], g, e)
      }
    }

    // Phase de réparation : pour un groupe incomplet, tenter de déloger un
    // bloqueur (autre groupe qui partage un membre) vers un autre créneau.
    // Port du prototype `repartir()` § "réparation".
    reparer(groupes, memP, e, creneaux, estLibre, poser)

    const complets = [...e.plan.values()].filter((cs) => cs.length === cible).length
    const totalPosé = [...e.plan.values()].reduce((s, cs) => s + cs.length, 0)
    let etale = 0
    for (const cs of e.plan.values()) {
      etale += new Set(cs.map((id) => creneauxParId.get(id)?.date).filter(Boolean)).size
    }
    const cand: Best = { plan: e.plan, complets, total: totalPosé, etale }
    if (
      !best ||
      cand.complets > best.complets ||
      (cand.complets === best.complets && cand.total > best.total) ||
      (cand.complets === best.complets && cand.total === best.total && cand.etale > best.etale)
    ) {
      best = cand
    }
    if (best.complets === total && best.etale === total * cible) break
  }

  const placement: PlacementItem[] = []
  best!.plan.forEach((sids, gid) =>
    sids.forEach((sid) => placement.push({ groupe_id: gid, creneau_id: sid })),
  )
  return {
    placement,
    groupes_complets: best!.complets,
    places_totales: best!.total,
    jours_couverts: best!.etale,
  }
}
