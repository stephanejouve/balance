import type { Creneau } from '../domain/grille'
import type { Groupe, Inscriptions, Lieu, Personne, Pupitre, Session } from '../domain/model'
import type { RegistreContraintes } from './contraintes'
import { actif } from './contraintes'
import { indispoBloque } from './indispo'
import { makeRng, shuffle } from './rng'

/**
 * Cote a priori la difficulté d'un groupe (0 = facile, ∞ = impossible).
 * Combine :
 *   - nb de créneaux fermés par les indispos de ses membres
 *   - nb de groupes partageant au moins un membre
 *   - taille du groupe (léger biais : les gros sont plus contraints)
 * L'ordre de placement au 1er essai suit cette difficulté décroissante :
 *   les groupes les plus contraints choisissent parmi le champ le plus large,
 *   au lieu de se retrouver bloqués en fin de tour.
 */
export function coterDifficulte(
  g: Groupe,
  groupes: Groupe[],
  creneaux: Creneau[],
  personnesParId: Map<string, Personne>,
): number {
  const membres = [...new Set(g.membres.map((m) => m.personne_id))]
  if (membres.length === 0) return 0
  const pupitresParPersonne = new Map<string, Pupitre[]>()
  g.membres.forEach((m) => {
    if (!pupitresParPersonne.has(m.personne_id)) pupitresParPersonne.set(m.personne_id, [])
    pupitresParPersonne.get(m.personne_id)!.push(m.pupitre)
  })
  const ouverts = creneaux.filter((c) => {
    for (const pid of membres) {
      const p = personnesParId.get(pid)
      if (!p) continue
      if (indispoBloque(p, c, pupitresParPersonne.get(pid) ?? [])) return false
    }
    return true
  }).length
  let partages = 0
  const setMembres = new Set(membres)
  for (const g2 of groupes) {
    if (g2.id === g.id) continue
    if (g2.membres.some((m) => setMembres.has(m.personne_id))) partages++
  }
  const ratioFerme = 1 - ouverts / Math.max(1, creneaux.length)
  return partages * 12 + ratioFerme * 60 + membres.length * 2
}

/**
 * Placement horaire — port structuré de `repartir()` (prototype
 * `repartiteur_repetitions.html`). Placement sans salle : l'attribution
 * salles est une passe séparée (cf. `allocate-rooms.ts`, brief §4).
 *
 * Approche : random restart heuristique (2500 essais par défaut) avec
 * tours de table (chaque groupe obtient sa 1ʳᵉ répétition, puis la 2ᵉ,
 * etc.) et scoring des candidats. Le seed rend la sortie reproductible.
 */

export interface FigeeItem {
  groupe_id: string
  creneau_id: string
}

export interface RepartirOptions {
  seed?: number
  maxEssais?: number
  /** Registre des contraintes actives. Défaut : toutes actives. */
  registre?: RegistreContraintes
  /**
   * Assignations à préserver : le solveur pose ces couples (groupe,
   * créneau) au démarrage de chaque essai et calcule le reste autour.
   * Sert à l'ajustement manuel (brief §4) : ce qui est figé n'est plus
   * touché lors des recalculs.
   */
  figees?: readonly FigeeItem[]
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

/** Écart en minutes entre deux créneaux (dates ISO + heures HH:MM). */
function ecartMinutesEntre(a: Creneau, b: Creneau): number {
  const [ya, ma, da] = a.date.split('-').map(Number)
  const [yb, mb, db] = b.date.split('-').map(Number)
  const jourA = Date.UTC(ya, ma - 1, da) / 60000 + toMinutes(a.debut)
  const jourB = Date.UTC(yb, mb - 1, db) / 60000 + toMinutes(b.debut)
  return Math.abs(jourA - jourB)
}

/**
 * Objectifs métier (retours terrain, session 2026) :
 *  - PRIORITAIRE : deux répétitions d'un même morceau sont espacées d'au
 *    moins 12 h — laisse aux musiciens le temps de digérer et de régler
 *    les problèmes vus dans la répé précédente.
 *  - SECONDAIRE : un même musicien évite d'enchaîner ses engagements —
 *    même écart cible, mais pénalité plus faible car moins critique
 *    pour la qualité de la répétition.
 * Traitées en préférences pondérées (score dégressif), pas en contraintes
 * dures : quand un stage court oblige à resserrer, le solveur accepte en
 * pénalisant.
 */
const ECART_MIN_ENTRE_REPETS = 12 * 60
const PENALITE_MORCEAU_12H = 50 // règle prioritaire, poids fort
const PENALITE_MUSICIEN_12H = 20 // règle secondaire, poids réduit

/**
 * Un créneau démarrant à ou après `HEURE_TARDIVE_DEBUT` est considéré
 * « tardif ». Règle métier (participant, 2026) : personne ne devrait se
 * retrouver avec TOUTES ses répétitions à des heures tardives — le
 * score pénalise les placements qui aggravent le déséquilibre.
 */
const HEURE_TARDIVE_DEBUT = 20 * 60

function estTardif(c: Creneau): boolean {
  return toMinutes(c.debut) >= HEURE_TARDIVE_DEBUT
}

function membresUniques(g: Groupe): string[] {
  return [...new Set(g.membres.map((m) => m.personne_id))]
}

function pupitresDe(personne_id: string, g: Groupe): Pupitre[] {
  return g.membres.filter((m) => m.personne_id === personne_id).map((m) => m.pupitre)
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
 * Réparation par échange : pour chaque groupe incomplet, tente de libérer
 * un créneau en délogeant jusqu'à `MAX_BLOQUEURS` bloqueurs partageant un
 * membre, à condition qu'ils soient tous relogeables. Le délogement est
 * exécuté puis annulé (rollback complet) si l'opération ne débloque pas
 * la situation — pas d'état laissé incohérent.
 */
const MAX_BLOQUEURS_REPAR = 3

function reparer(
  groupes: Groupe[],
  memP: Map<string, string[]>,
  e: EtatEssai,
  creneaux: Creneau[],
  cibleDefaut: number,
  cibleGroupe: (g: Groupe) => number,
  estLibre: (c: Creneau, g: Groupe, e: EtatEssai, contraintJour: boolean) => boolean,
  poser: (c: Creneau, g: Groupe, e: EtatEssai) => void,
): void {
  const creneauxParId = new Map(creneaux.map((c) => [c.id, c]))
  const retirer = (c: Creneau, g: Groupe) => {
    e.occSlot.set(c.id, Math.max(0, (e.occSlot.get(c.id) ?? 0) - 1))
    const planG = e.plan.get(g.id)
    if (planG) e.plan.set(g.id, planG.filter((id) => id !== c.id))
    const jours = new Set<string>()
    ;(e.plan.get(g.id) ?? []).forEach((sid) => {
      const s = creneauxParId.get(sid)
      if (s) jours.add(s.date)
    })
    e.joursGroupe.set(g.id, jours)
    for (const pid of memP.get(g.id) ?? []) e.occPersonne.get(pid)?.delete(c.id)
  }

  // Trie les groupes incomplets par manque décroissant (les plus en défaut
  // en premier) — donne plus de chances aux groupes à 0 répé.
  const parPriorite = () =>
    [...groupes].sort(
      (a, b) => (e.plan.get(a.id)?.length ?? 0) - (e.plan.get(b.id)?.length ?? 0),
    )

  for (let passe = 0; passe < 3; passe++) {
    let progresse = false
    for (const g of parPriorite()) {
      const cibleG = cibleGroupe(g)
      let garde = 0
      while ((e.plan.get(g.id)?.length ?? 0) < cibleG && garde++ < 20) {
        let fait = false
        // Essai direct d'abord (sans réparer)
        const planG = e.plan.get(g.id) ?? []
        let direct = creneaux.find((c) => !planG.includes(c.id) && estLibre(c, g, e, true))
        if (!direct) direct = creneaux.find((c) => !planG.includes(c.id) && estLibre(c, g, e, false))
        if (direct) {
          poser(direct, g, e)
          fait = true
          progresse = true
          continue
        }
        // Sinon, chercher un créneau à libérer par délogement
        const membresG = memP.get(g.id) ?? []
        for (const c of creneaux) {
          if (fait) break
          if ((e.plan.get(g.id) ?? []).includes(c.id)) continue
          const bloqueurs: Groupe[] = []
          for (const g2 of groupes) {
            if (g2.id === g.id) continue
            if (!(e.plan.get(g2.id) ?? []).includes(c.id)) continue
            const m2 = memP.get(g2.id) ?? []
            if (m2.some((pid) => membresG.includes(pid))) bloqueurs.push(g2)
          }
          if (bloqueurs.length === 0 || bloqueurs.length > MAX_BLOQUEURS_REPAR) continue
          const occ = e.occSlot.get(c.id) ?? 0
          if (occ - bloqueurs.length >= c.salles.length) continue

          // Snapshot pour rollback : (bloqueur, creneau_delogé, creneau_relogé|null)
          type Op = { g: Groupe; retiré: Creneau; relog: Creneau | null }
          const ops: Op[] = []
          let toutRelog = true
          for (const b of bloqueurs) {
            retirer(c, b)
            let relog = creneaux.find(
              (cc) => !(e.plan.get(b.id) ?? []).includes(cc.id) && estLibre(cc, b, e, true),
            )
            if (!relog) {
              relog = creneaux.find(
                (cc) => !(e.plan.get(b.id) ?? []).includes(cc.id) && estLibre(cc, b, e, false),
              )
            }
            ops.push({ g: b, retiré: c, relog: relog ?? null })
            if (!relog) {
              toutRelog = false
              break
            }
            poser(relog, b, e)
          }
          const posable = toutRelog && estLibre(c, g, e, false)
          if (posable) {
            poser(c, g, e)
            fait = true
            progresse = true
          } else {
            // Rollback : retirer les relogs, restaurer sur c
            for (let i = ops.length - 1; i >= 0; i--) {
              const op = ops[i]
              if (op.relog) retirer(op.relog, op.g)
              poser(op.retiré, op.g, e)
            }
          }
        }
        if (!fait) break
      }
    }
    if (!progresse) break
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
  const reg = options.registre
  const personnesParId = new Map(inscriptions.personnes.map((p) => [p.id, p]))
  const creneauxParId = new Map(creneaux.map((c) => [c.id, c]))
  const sallesActives = new Set(lieu.salles.filter((s) => s.actif).map((s) => s.id))
  const groupes = inscriptions.groupes
  const memP = new Map(groupes.map((g) => [g.id, membresUniques(g)]))
  const cible = session.repetitions_visees
  const total = groupes.length
  /** Cible par groupe = visées - déjà faites (défensif : NaN → 0), ≥ 0 */
  const cibleGroupe = (g: Groupe): number =>
    Math.max(0, session.repetitions_visees - (g.repetitions_deja_faites || 0))
  const difficulte = new Map(
    groupes.map((g) => [g.id, coterDifficulte(g, groupes, creneaux, personnesParId)]),
  )

  const margePct = session.marge_pct || 0
  const sallesUtilisables = (c: Creneau) => {
    const dispo = c.salles.filter((sid) => sallesActives.has(sid)).length
    if (dispo === 0 || margePct === 0) return dispo
    // Réduit la capacité effective pour garder de la marge.
    // Garantit au moins 1 place tant qu'il y a des salles disponibles.
    return Math.max(1, Math.floor(dispo * (1 - margePct / 100)))
  }

  const estLibre = (c: Creneau, g: Groupe, e: EtatEssai, contraintJour: boolean): boolean => {
    const cap = sallesUtilisables(c)
    if (actif(reg, 'salle-unique-groupe') && (e.occSlot.get(c.id) ?? 0) >= cap) return false
    const planG = e.plan.get(g.id) ?? []
    if (actif(reg, 'creneaux-consecutifs') && accolAvecPlan(c, planG, creneauxParId)) return false
    if (contraintJour && e.joursGroupe.get(g.id)?.has(c.date)) return false
    for (const pid of memP.get(g.id) ?? []) {
      if (actif(reg, 'personne-unique-moment') && e.occPersonne.get(pid)?.has(c.id)) return false
      if (!actif(reg, 'personne-indispo')) continue
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
    if (actif(reg, 'preference-espacement-12h')) {
      // Pénalité forte quand deux répés du même morceau sont trop proches
      // — le vrai bénéfice de la répé, c'est le temps entre les deux.
      const planG = e.plan.get(g.id) ?? []
      for (const sid of planG) {
        const s = creneauxParId.get(sid)
        if (!s) continue
        const ecart = ecartMinutesEntre(s, c)
        if (ecart < ECART_MIN_ENTRE_REPETS) {
          v -= Math.round(PENALITE_MORCEAU_12H * (1 - ecart / ECART_MIN_ENTRE_REPETS))
        }
      }
    }
    if (actif(reg, 'preference-repos-musicien-12h')) {
      // Pénalité plus légère pour chaque membre du groupe dont un autre
      // engagement (autre morceau) est à moins de 12 h. Secondaire par
      // rapport à la précédente : dédoublonne les créneaux déjà comptés
      // via planG (une répé du même morceau ne compte qu'une fois).
      const setPlan = new Set(e.plan.get(g.id) ?? [])
      for (const pid of memP.get(g.id) ?? []) {
        const occs = e.occPersonne.get(pid)
        if (!occs) continue
        for (const cid of occs) {
          if (setPlan.has(cid)) continue
          const s = creneauxParId.get(cid)
          if (!s) continue
          const ecart = ecartMinutesEntre(s, c)
          if (ecart < ECART_MIN_ENTRE_REPETS) {
            v -= Math.round(PENALITE_MUSICIEN_12H * (1 - ecart / ECART_MIN_ENTRE_REPETS))
          }
        }
      }
    }
    if (actif(reg, 'preference-equilibre-tardif')) {
      // Évite qu'un musicien se retrouve avec l'ensemble de ses créneaux
      // à des heures tardives.
      const candTardif = estTardif(c)
      for (const pid of memP.get(g.id) ?? []) {
        const occs = e.occPersonne.get(pid)
        if (!occs || occs.size === 0) continue
        let nTard = 0
        let nDiur = 0
        for (const cid of occs) {
          const cc = creneauxParId.get(cid)
          if (!cc) continue
          if (estTardif(cc)) nTard++
          else nDiur++
        }
        if (candTardif && nDiur === 0 && nTard > 0) v -= 25
        else if (!candTardif && nTard > nDiur) v += 12
      }
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

    // Pré-pose des assignations figées (ajustement manuel).
    for (const f of options.figees ?? []) {
      const g = groupes.find((x) => x.id === f.groupe_id)
      const c = creneauxParId.get(f.creneau_id)
      if (!g || !c) continue
      poser(c, g, e)
    }

    for (let tour = 0; tour < cible; tour++) {
      // Essai 0 : ordre par difficulté décroissante (les plus contraints
      // choisissent avant que le graphe ne soit saturé). Essais suivants :
      // shuffle biaisé où les plus difficiles restent souvent en tête.
      let ordre: Groupe[]
      if (essai === 0) {
        ordre = [...groupes].sort((a, b) => (difficulte.get(b.id) ?? 0) - (difficulte.get(a.id) ?? 0))
      } else if (essai % 3 === 1) {
        ordre = [...groupes].sort(
          (a, b) => (memP.get(b.id)?.length ?? 0) - (memP.get(a.id)?.length ?? 0),
        )
      } else {
        ordre = shuffle(groupes, rng)
      }
      for (const g of ordre) {
        if ((e.plan.get(g.id)?.length ?? 0) >= cibleGroupe(g)) continue
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

    // Phase de réparation : pour un groupe incomplet, tenter de déloger
    // jusqu'à MAX_BLOQUEURS_REPAR bloqueurs partageant un membre, avec
    // rollback complet si l'opération n'aboutit pas.
    reparer(groupes, memP, e, creneaux, cible, cibleGroupe, estLibre, poser)

    const complets = groupes.filter((g) => (e.plan.get(g.id)?.length ?? 0) >= cibleGroupe(g)).length
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
    if (best.complets === total) break
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
