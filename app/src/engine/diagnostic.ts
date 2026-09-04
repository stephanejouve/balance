import type { Creneau } from '../domain/grille'
import type { Groupe, Inscriptions, Personne, Pupitre, Session } from '../domain/model'
import { libellePersonne } from '../domain/model'
import { enrichirIndispos } from './imposes'
import { indispoBloque } from './indispo'
import type { PlacementItem } from './solver'

/**
 * Diagnostic pré-solve : détecte les infaisabilités évidentes avant même
 * de lancer le moteur. Brief §4 : « ce calcul trivial explique
 * instantanément un échec que le solveur mettrait longtemps à démontrer ».
 *
 * Pour chaque personne, on compare :
 *   - la demande = (nb groupes où elle joue × répétitions visées)
 *                  + (nb séances d'imposés où elle joue)
 *   - l'offre    = nb créneaux non bloqués par ses indispos (dont imposés)
 * Si demande > offre : personne physiquement impossible à satisfaire.
 */

/**
 * Type d'infaisabilité — distingue les deux cas qui appellent des actions
 * utilisateur différentes (audit Stéphane smoke 2026-09-03 défaut #2) :
 *
 * - `surcharge` : `offre > 0 && demande > offre`. La personne a des créneaux
 *   ouverts mais pas assez pour satisfaire la demande. Action attendue :
 *   réduire les engagements ou libérer des créneaux.
 * - `exclusion` : `offre === 0`. La personne n'a **aucun** créneau ouvert
 *   (souvent : indisponibilités trop larges ou séances imposées qui
 *   couvrent tout). Action attendue : vérifier ses indisponibilités.
 *   Zéro créneau n'est pas une surcharge — c'est une exclusion, et le
 *   message doit orienter vers la bonne cause.
 */
export type TypeInfaisabilite = 'surcharge' | 'exclusion'

export interface DiagCharge {
  personne_id: string
  nom: string
  demande: number
  offre: number
  type: TypeInfaisabilite
  detail: {
    groupes: number
    seances_imposees: number
    repetitions_visees: number
    creneaux_bloques: number
    creneaux_total: number
  }
}

function pupitresDePersonneDansGroupe(g: Groupe, pid: string): Pupitre[] {
  return g.membres.filter((m) => m.personne_id === pid).map((m) => m.pupitre)
}

export function analyserInfaisabilite(
  session: Session,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
): DiagCharge[] {
  const cible = session.repetitions_visees
  const enrichies = enrichirIndispos(inscriptions)
  const parId = new Map(enrichies.personnes.map((p) => [p.id, p]))

  const nbGroupesPar = new Map<string, number>()
  const pupitresDeParPar = new Map<string, Set<Pupitre>>()
  for (const g of enrichies.groupes) {
    const membres = new Set(g.membres.map((m) => m.personne_id))
    for (const pid of membres) {
      nbGroupesPar.set(pid, (nbGroupesPar.get(pid) ?? 0) + 1)
      const pupitres = pupitresDePersonneDansGroupe(g, pid)
      if (!pupitresDeParPar.has(pid)) pupitresDeParPar.set(pid, new Set())
      for (const p of pupitres) pupitresDeParPar.get(pid)!.add(p)
    }
  }
  const nbImposesPar = new Map<string, number>()
  for (const im of enrichies.imposes) {
    for (const pid of im.membres) {
      nbImposesPar.set(pid, (nbImposesPar.get(pid) ?? 0) + im.seances.length)
    }
  }

  const out: DiagCharge[] = []
  for (const p of enrichies.personnes) {
    const nbGroupes = nbGroupesPar.get(p.id) ?? 0
    if (nbGroupes === 0) continue
    const nbImposes = nbImposesPar.get(p.id) ?? 0
    const demande = nbGroupes * cible + nbImposes
    const pupitres = [...(pupitresDeParPar.get(p.id) ?? new Set())]
    const bloques = creneaux.filter((c) => indispoBloque(p, c, pupitres)).length
    const offre = creneaux.length - bloques
    if (demande > offre) {
      out.push({
        personne_id: p.id,
        nom: libellePersonne(p),
        demande,
        offre,
        type: offre === 0 ? 'exclusion' : 'surcharge',
        detail: {
          groupes: nbGroupes,
          seances_imposees: nbImposes,
          repetitions_visees: cible,
          creneaux_bloques: bloques,
          creneaux_total: creneaux.length,
        },
      })
    }
  }
  return out.sort((a, b) => b.demande - b.offre - (a.demande - a.offre))
}

/**
 * Diagnostic post-échec : pour chaque groupe incomplet, explique pourquoi
 * en désignant les personnes les plus contraintes et les groupes avec
 * lesquels il partage des musiciens.
 */
export interface DiagGroupe {
  groupe_id: string
  titre: string
  obtenu: number
  cible: number
  /**
   * Créneaux où AUCUN membre du groupe n'est indisponible. Sémantique
   * fidèle au calcul (`indispoBloque` sur chaque membre). Ne préjuge pas
   * de la capacité restante — un créneau ouvert peut être saturé par
   * d'autres groupes. Voir `creneaux_exploitables` pour la dimension
   * capacité.
   */
  creneaux_ouverts: number
  /**
   * Créneaux ouverts (cf. `creneaux_ouverts`) ET ayant au moins un slot
   * capacité restant : `sallesUtilisables(c) - nb_placements_sur_c > 0`.
   * Version simplifiée qui ne re-simule pas les collisions personnes
   * cross-groupes du solveur (trop coûteux + duplication d'implémentation).
   *
   * Invariant par construction : `creneaux_exploitables <= creneaux_ouverts`.
   *
   * Sémantique messages « Pourquoi ça bloque » (feedback Stéphane 2026-09-04) :
   * - `ouverts === 0` → cas A, cause indispos
   * - `ouverts > 0 && exploitables === 0` → cas B, saturation capacité
   * - `ouverts > 0 && exploitables > 0` → cas C, la capacité n'est PAS la
   *   contrainte. Le chiffre `exploitables` devient faux ami à ce stade
   *   (une collision personne cross-groupes peut le rendre optimiste),
   *   il n'est pas affiché à l'utilisateur — on s'appuie sur `partages`.
   */
  creneaux_exploitables: number
  partages: Array<{ groupe_id: string; titre: string; communs: string[] }>
  poids_musicien?: {
    nom: string
    n_groupes: number
    n_imposes: number
  }
  /** Nombre de répétitions déjà effectuées — si > 0, on ne peut plus retirer un membre. */
  repetitions_deja_faites: number
}

export function diagnostiquer(
  session: Session,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  placement: PlacementItem[],
): DiagGroupe[] {
  const cible = session.repetitions_visees
  const enrichies = enrichirIndispos(inscriptions)
  const parId = new Map(enrichies.personnes.map((p) => [p.id, p]))
  const posesPar = new Map<string, number>()
  for (const p of placement) posesPar.set(p.groupe_id, (posesPar.get(p.groupe_id) ?? 0) + 1)

  // Index créneau → nb placements (pour `creneaux_exploitables`).
  const placementsParCreneau = new Map<string, number>()
  for (const p of placement) {
    placementsParCreneau.set(p.creneau_id, (placementsParCreneau.get(p.creneau_id) ?? 0) + 1)
  }
  const margePct = session.marge_pct || 0
  // Miroir de `solver.ts::sallesUtilisables` — duplication contrôlée par
  // l'invariant `exploitables <= ouverts` posé en test. Extraire vers module
  // partagé = follow-up P3, hors scope.
  const capaciteCreneau = (c: Creneau): number => {
    const dispo = c.salles.length
    if (dispo === 0 || margePct === 0) return dispo
    return Math.max(1, Math.floor(dispo * (1 - margePct / 100)))
  }

  const nbImposesPar = new Map<string, number>()
  for (const im of enrichies.imposes) {
    for (const pid of im.membres) {
      nbImposesPar.set(pid, (nbImposesPar.get(pid) ?? 0) + im.seances.length)
    }
  }

  const out: DiagGroupe[] = []
  for (const g of enrichies.groupes) {
    const dejaFaites = g.repetitions_deja_faites || 0
    const cibleG = Math.max(0, cible - dejaFaites)
    const obtenu = posesPar.get(g.id) ?? 0
    if (obtenu >= cibleG) continue
    const membres = [...new Set(g.membres.map((m) => m.personne_id))]

    // Créneaux ouverts : aucun membre indispo dessus
    const creneauxOuvertsListe = creneaux.filter((c) => {
      for (const pid of membres) {
        const p = parId.get(pid)
        if (!p) continue
        const pups = g.membres.filter((m) => m.personne_id === pid).map((m) => m.pupitre)
        if (indispoBloque(p, c, pups)) return false
      }
      return true
    })
    const ouverts = creneauxOuvertsListe.length

    // Créneaux exploitables : sous-ensemble des ouverts ayant encore de la
    // capacité salle (post-placement solveur). Invariant : exploitables ≤ ouverts.
    const exploitables = creneauxOuvertsListe.filter((c) => {
      return capaciteCreneau(c) - (placementsParCreneau.get(c.id) ?? 0) > 0
    }).length

    // Partages : autres groupes ayant au moins un membre commun
    const partages: DiagGroupe['partages'] = []
    for (const g2 of enrichies.groupes) {
      if (g2.id === g.id) continue
      const communs = g2.membres.map((m) => m.personne_id).filter((pid) => membres.includes(pid))
      const uniques = [...new Set(communs)]
      if (uniques.length > 0) {
        partages.push({
          groupe_id: g2.id,
          titre: g2.titre,
          communs: uniques.map((pid) => libellePersonne(parId.get(pid) ?? { id: pid, nom: pid, discriminant: '', instruments: [], role: 'musicien', indispos: [] } as Personne)),
        })
      }
    }
    partages.sort((a, b) => b.communs.length - a.communs.length)

    // Musicien le plus chargé
    let poids: DiagGroupe['poids_musicien'] | undefined
    for (const pid of membres) {
      const p = parId.get(pid)
      if (!p) continue
      const n_groupes = enrichies.groupes.filter((g2) =>
        g2.membres.some((m) => m.personne_id === pid),
      ).length
      const n_imposes = nbImposesPar.get(pid) ?? 0
      if (!poids || n_groupes + n_imposes > poids.n_groupes + poids.n_imposes) {
        poids = { nom: libellePersonne(p), n_groupes, n_imposes }
      }
    }

    out.push({
      groupe_id: g.id,
      titre: g.titre,
      obtenu,
      cible: cibleG,
      creneaux_ouverts: ouverts,
      creneaux_exploitables: exploitables,
      partages: partages.slice(0, 4),
      // Le remplacement d'un membre n'a plus de sens si le groupe a déjà répété
      poids_musicien: dejaFaites > 0 ? undefined : poids,
      repetitions_deja_faites: dejaFaites,
    })
  }
  return out
}
