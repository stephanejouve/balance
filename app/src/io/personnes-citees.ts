/**
 * Lot 2b de #164 (arbitrage CD 2026-10-22) : créer les personnes citées
 * dans la Liste sans déclaration Stagiaires — par une DÉCISION prise sur
 * l'écran de relecture, jamais d'office à l'import.
 *
 * Pourquoi pas d'office : l'onglet Stagiaires sert aussi de liste de
 * référence. « Hélène Barault » tapé au lieu de « Hélène Barrault » produit
 * aujourd'hui un signalement ; créé d'office, il produirait une 25e
 * personne qui partage en silence les morceaux d'une seule.
 *
 * Trois étapes, toutes pures :
 *  1. `preparerCreation` — les personnes citées absentes du candidat, et
 *     les noms proches à trancher AVANT création (entre citations, et
 *     entre une citation et une personne déclarée) ;
 *  2. la relecture affiche la liste et les rapprochements, l'organisateur
 *     tranche chaque rapprochement (même personne ou deux personnes) ;
 *  3. `appliquerCreation` — nouveau candidat, citations fusionnées
 *     réécrites vers la personne retenue.
 *
 * Le pupitre vient de la colonne où le nom apparaît (`migrerInscriptions`
 * agrège les colonnes) : un nom cité sous plusieurs colonnes reçoit
 * plusieurs pupitres.
 */
import type { Inscriptions, Personne } from '../domain/model'
import { slug } from '../domain/model'

export interface RapprochementCreation {
  /** Personne citée, à créer. */
  cite: Personne
  /** Nom proche : une autre citation à créer, ou une personne déclarée. */
  proche: Personne
  proche_declaree: boolean
}

export interface CreationPersonnes {
  a_creer: Personne[]
  rapprochements: RapprochementCreation[]
}

/** Clé de comparaison : celle de l'identifiant, tirets compris retirés. */
function cle(p: Personne): string {
  return slug(`${p.nom} ${p.discriminant}`).replace(/-/g, '')
}

/** Distance d'édition ≤ 1 (une lettre ajoutée, retirée ou changée). */
function aUneLettrePres(a: string, b: string): boolean {
  if (a === b) return false
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let ecarts = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++
      j++
      continue
    }
    if (++ecarts > 1) return false
    if (a.length > b.length) i++
    else if (b.length > a.length) j++
    else {
      i++
      j++
    }
  }
  return ecarts + (a.length - i) + (b.length - j) <= 1
}

/**
 * Personnes citées dans les groupes du candidat mais absentes de ses
 * personnes, et rapprochements à trancher avant de les créer.
 *
 * `citees` vient de l'extraction de la Liste (`migrerInscriptions`) : nom
 * tel que cité, discriminant, pupitres des colonnes.
 */
export function preparerCreation(candidat: Inscriptions, citees: readonly Personne[]): CreationPersonnes {
  const declarees = new Map(candidat.personnes.map((p) => [p.id, p]))
  const referencees = new Set(candidat.groupes.flatMap((g) => g.membres.map((m) => m.personne_id)))
  const a_creer = citees.filter((p) => referencees.has(p.id) && !declarees.has(p.id))

  const rapprochements: RapprochementCreation[] = []
  for (let i = 0; i < a_creer.length; i++) {
    const ci = cle(a_creer[i])
    for (let j = i + 1; j < a_creer.length; j++) {
      if (aUneLettrePres(ci, cle(a_creer[j]))) {
        rapprochements.push({ cite: a_creer[i], proche: a_creer[j], proche_declaree: false })
      }
    }
    for (const d of declarees.values()) {
      if (aUneLettrePres(ci, cle(d))) rapprochements.push({ cite: a_creer[i], proche: d, proche_declaree: true })
    }
  }
  return { a_creer, rapprochements }
}

/** Décision sur un rapprochement : fusionner vers l'id retenu, ou garder deux personnes. */
export type DecisionRapprochement = { garder: string } | 'distinctes'

export function cleRapprochement(r: RapprochementCreation): string {
  return `${r.cite.id}|${r.proche.id}`
}

/** Rapprochements encore sans décision — la création reste bloquée tant qu'il en reste. */
export function rapprochementsATrancher(
  creation: CreationPersonnes,
  decisions: ReadonlyMap<string, DecisionRapprochement>,
): RapprochementCreation[] {
  return creation.rapprochements.filter((r) => !decisions.has(cleRapprochement(r)))
}

/**
 * Nouveau candidat : personnes citées créées, citations des noms fusionnés
 * réécrites vers la personne retenue. Ne mute rien (même invariant que
 * `construireCandidatExcel`).
 *
 * Lève si un rapprochement reste sans décision : l'appelant ne doit pas
 * proposer le geste tant que `rapprochementsATrancher` n'est pas vide.
 */
export function appliquerCreation(
  candidat: Inscriptions,
  creation: CreationPersonnes,
  decisions: ReadonlyMap<string, DecisionRapprochement>,
): Inscriptions {
  if (rapprochementsATrancher(creation, decisions).length > 0) {
    throw new Error('rapprochements non tranchés : création refusée')
  }
  // id fusionné → id retenu, chaînes résolues (A→B, B→C donne A→C).
  const vers = new Map<string, string>()
  for (const r of creation.rapprochements) {
    const d = decisions.get(cleRapprochement(r))!
    if (d === 'distinctes') continue
    const perdu = d.garder === r.cite.id ? r.proche.id : r.cite.id
    vers.set(perdu, d.garder)
  }
  const resoudre = (id: string): string => {
    const vus = new Set<string>()
    while (vers.has(id) && !vus.has(id)) {
      vus.add(id)
      id = vers.get(id)!
    }
    return id
  }

  // Personnes créées : clones, pupitres des noms fusionnés ajoutés à la
  // personne retenue quand elle est elle-même créée ici.
  const crees = new Map<string, Personne>()
  for (const p of creation.a_creer) {
    if (resoudre(p.id) === p.id) crees.set(p.id, { ...p, instruments: p.instruments.map((i) => ({ ...i })) })
  }
  for (const p of creation.a_creer) {
    const cible = crees.get(resoudre(p.id))
    if (!cible || cible.id === p.id) continue
    for (const ins of p.instruments) {
      if (!cible.instruments.some((i) => i.pupitre === ins.pupitre)) cible.instruments.push({ ...ins })
    }
  }

  const groupes = candidat.groupes.map((g) => {
    const vus = new Set<string>()
    const membres = g.membres
      .map((m) => (vers.has(m.personne_id) ? { ...m, personne_id: resoudre(m.personne_id) } : m))
      .filter((m) => {
        const k = `${m.personne_id}|${m.pupitre}`
        if (vus.has(k)) return false
        vus.add(k)
        return true
      })
    const responsable_id = vers.has(g.responsable_id) ? resoudre(g.responsable_id) : g.responsable_id
    const change = membres.length !== g.membres.length || membres.some((m, i) => m !== g.membres[i]) || responsable_id !== g.responsable_id
    return change ? { ...g, membres, responsable_id } : g
  })

  return { ...candidat, personnes: [...candidat.personnes, ...crees.values()], groupes }
}
