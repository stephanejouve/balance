import type { Creneau } from '../domain/grille'
import type { Groupe, Inscriptions, Pupitre, Session } from '../domain/model'

/**
 * Simulation de quotas — brief §11 (piste à forte valeur) et §14 (argument
 * démo n°3) : « avec tant de batteurs, de bassistes et de pianistes
 * inscrits, combien de groupes pourra-t-on servir ? »
 *
 * Analyse par pupitre :
 *  - nb de musiciens qui le tiennent
 *  - nb de groupes qui l'exigent (au moins un membre à ce pupitre)
 *  - capacité théorique = nb_musiciens × nb_créneaux × (répétitions moyennes)
 *  - demande = nb_groupes × répétitions_visées
 *  - ratio saturation = demande / capacité (>1 = surcharge structurelle)
 *  - simulation : combien de groupes serviables avec un delta de musiciens
 */

export interface QuotaPupitre {
  pupitre: Pupitre
  nb_musiciens: number
  nb_groupes_demandeurs: number
  demande: number
  capacite: number
  ratio: number
  /** Nombre de groupes qui pourraient être servis avec `nb_musiciens + delta`. */
  simuler_delta(delta: number): number
}

export function analyseQuotas(
  session: Session,
  inscriptions: Inscriptions,
  creneaux: readonly Creneau[],
): QuotaPupitre[] {
  const cible = session.repetitions_visees
  // Pupitres présents dans les inscriptions (personnes ou groupes)
  const pupitresPresents = new Set<Pupitre>()
  for (const p of inscriptions.personnes) {
    for (const i of p.instruments) pupitresPresents.add(i.pupitre)
  }
  for (const g of inscriptions.groupes) {
    for (const m of g.membres) pupitresPresents.add(m.pupitre)
    // `postes_cherches` : structure typée depuis 2026-09-04
    // (`PosteCherche[]`), on lit le pupitre de chaque poste. Le `nb` et
    // `role` ne sont pas consommés ici — les quotas raisonnent en
    // pupitres, pas en postes.
    for (const c of g.postes_cherches) pupitresPresents.add(c.pupitre)
  }

  const out: QuotaPupitre[] = []
  for (const pup of pupitresPresents) {
    const musiciens = new Set<string>()
    for (const p of inscriptions.personnes) {
      if (p.instruments.some((i) => i.pupitre === pup)) musiciens.add(p.id)
    }
    // Groupes qui demandent ce pupitre (au moins un membre y joue, ou postes_cherches)
    const groupesDemandeurs = inscriptions.groupes.filter(
      (g) =>
        g.membres.some((m) => m.pupitre === pup) ||
        g.postes_cherches.some((pc) => pc.pupitre === pup),
    )
    const nb_musiciens = musiciens.size
    const nb_groupes = groupesDemandeurs.length
    const demande = nb_groupes * cible
    const capacite = nb_musiciens * creneaux.length
    const ratio = capacite > 0 ? demande / capacite : Infinity

    /**
     * Nombre de groupes serviables avec `nb_musiciens + delta` musiciens
     * à ce pupitre. Approximation : chaque musicien peut tenir au plus
     * `nb_creneaux / cible` groupes (idéal, sans conflits croisés).
     */
    const simuler_delta = (delta: number): number => {
      const n = Math.max(0, nb_musiciens + delta)
      // Capacité brute en places-répétitions
      const capaciteN = n * creneaux.length
      // Groupes serviables si demande = groupes × cible
      return Math.floor(capaciteN / cible)
    }

    out.push({
      pupitre: pup,
      nb_musiciens,
      nb_groupes_demandeurs: nb_groupes,
      demande,
      capacite,
      ratio,
      simuler_delta,
    })
  }

  return out.sort((a, b) => b.ratio - a.ratio)
}
