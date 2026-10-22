import { butoirKeyDeGroupe, type Creneau } from '../domain/grille'
import { Echeance, type Inscriptions, type Pupitre, type Session } from '../domain/model'
import { indispoBloque } from './indispo'

/**
 * Saturation par pupitre — brief §11 et §14 : « avec tant de batteurs, de
 * bassistes et de pianistes inscrits, où reste-t-il de la marge ? »
 *
 * Analyse par pupitre :
 *  - nb de musiciens qui le tiennent
 *  - nb de groupes qui l'exigent (au moins un membre à ce pupitre, ou un
 *    poste cherché)
 *  - demande = nb_groupes × répétitions_visées
 *  - capacité = places-répétitions réellement ouvertes aux musiciens du
 *    pupitre : Σ musiciens Σ créneaux AVANT le butoir de l'échéance, hors
 *    créneaux bloqués par leurs indispos (`indispoBloque`, même contrôle
 *    que le solveur)
 *  - ratio saturation = demande / capacité (>1 = surcharge structurelle)
 *
 * Ticket #92 (mesure 2026-10-22) : l'ancienne capacité `musiciens ×
 * créneaux` comptait toute la session. Sur nos deux jeux, tous les groupes
 * sont en échéance apéro (28 créneaux avant butoir sur 50) : la saturation
 * affichée était près de deux fois trop basse — en amont de la décision de
 * recrutement. Les indispos pèsent < 1 % sur ces jeux, mais rien ne le
 * garantit sur un stage réel, d'où leur prise en compte.
 *
 * Échéances mélangées : les fenêtres sont emboîtées (un groupe apéro doit
 * tenir avant le butoir apéro ; apéro + vendredi avant le butoir vendredi).
 * Pour chaque butoir, on rapporte la demande cumulée des groupes dont le
 * butoir tombe au plus tard à cette date à la capacité avant ce butoir, et
 * on retient la fenêtre la plus tendue. `demande` et `capacite` exposés
 * sont ceux de cette fenêtre — le ratio affiché reste leur quotient.
 */

export interface QuotaPupitre {
  pupitre: Pupitre
  nb_musiciens: number
  nb_groupes_demandeurs: number
  demande: number
  capacite: number
  ratio: number
  /**
   * Pourquoi la capacité retenue est nulle alors que la demande ne l'est pas
   * (ratio `Infinity`), #154. Deux dénominateurs nuls ne disent pas la même
   * chose : un libellé unique mentirait une fois sur deux (CD 2026-10-22).
   */
  capacite_nulle?: CapaciteNulle
}

export type CapaciteNulle = 'aucun-musicien' | 'aucun-creneau' | 'tous-indisponibles'

/** Libellé affiché à la place d'un « Infinity% ». */
export const LIBELLE_CAPACITE_NULLE: Record<CapaciteNulle, string> = {
  'aucun-musicien': 'aucun musicien à ce pupitre',
  'aucun-creneau': 'plus aucun créneau avant le butoir',
  'tous-indisponibles': 'musiciens tous indisponibles avant le butoir',
}

const cleCreneau = (c: Creneau): string => `${c.date}T${c.debut.replace(':', '')}`

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

  // Fenêtres de butoir triées de la plus courte à la plus longue. Même
  // règle que `solver.ts::estLibre` : un créneau dont la clé est >= butoir
  // est exclu.
  const fenetres = Echeance.options
    .map((echeance) => {
      const butoir = butoirKeyDeGroupe(session, echeance)
      return { echeance, butoir, creneaux: creneaux.filter((c) => cleCreneau(c) < butoir) }
    })
    .sort((a, b) => a.butoir.localeCompare(b.butoir))

  const out: QuotaPupitre[] = []
  for (const pup of pupitresPresents) {
    const musiciens = inscriptions.personnes.filter((p) => p.instruments.some((i) => i.pupitre === pup))
    // Groupes qui demandent ce pupitre (au moins un membre y joue, ou postes_cherches)
    const groupesDemandeurs = inscriptions.groupes.filter(
      (g) =>
        g.membres.some((m) => m.pupitre === pup) ||
        g.postes_cherches.some((pc) => pc.pupitre === pup),
    )

    // Fenêtre retenue par défaut : la plus longue (aucune demande → ratio 0
    // sur toute la capacité de la session avant dernier butoir).
    let retenue = { demande: 0, capacite: 0, ratio: -1, nbCreneaux: 0 }
    let demandeCumulee = 0
    for (const f of fenetres) {
      demandeCumulee += groupesDemandeurs.filter((g) => g.echeance === f.echeance).length * cible
      let capacite = 0
      for (const p of musiciens) {
        for (const c of f.creneaux) if (!indispoBloque(p, c, [pup])) capacite++
      }
      const ratio = capacite > 0 ? demandeCumulee / capacite : demandeCumulee > 0 ? Infinity : 0
      if (ratio >= retenue.ratio) retenue = { demande: demandeCumulee, capacite, ratio, nbCreneaux: f.creneaux.length }
    }

    let capacite_nulle: CapaciteNulle | undefined
    if (retenue.capacite === 0 && retenue.demande > 0) {
      capacite_nulle =
        musiciens.length === 0 ? 'aucun-musicien' : retenue.nbCreneaux === 0 ? 'aucun-creneau' : 'tous-indisponibles'
    }

    out.push({
      pupitre: pup,
      nb_musiciens: musiciens.length,
      nb_groupes_demandeurs: groupesDemandeurs.length,
      demande: retenue.demande,
      capacite: retenue.capacite,
      ratio: retenue.ratio,
      ...(capacite_nulle ? { capacite_nulle } : {}),
    })
  }

  return out.sort((a, b) => b.ratio - a.ratio)
}
