import { butoirKeyDeGroupe, type Creneau } from '../domain/grille'
import type { Groupe, Inscriptions, Personne, Pupitre, Session } from '../domain/model'
import { indispoBloque } from './indispo'
import { analyserPlafondSalle } from './plafond-salle'

/**
 * Pool d'arbitrage effectif — issue #96 §D+§E, PR 1 fonction pure.
 *
 * Cadrage validé CD msgs 6620/6624/6629/6656 :
 * - Le pool est calculé from `inscriptions` + `refus` persistants + jauge max.
 *   Aucune dépendance au planning en cours (`solveurStore.solution`), donc
 *   utilisable en phase précoce quand l'organisateur compose encore.
 * - Le pool est une VUE (Q1) : ce module est une fonction pure sans effet
 *   de bord. Les artefacts persistants sont côté PR 2 (Refus) et via mutation
 *   `inscriptions.groupes` (acceptations).
 * - Filtre par pertinence (Q2) : structurellement mortes écartées.
 * - Scoring par gain (Q3) : deux gains distincts (plafond source + CHERCHE
 *   cible) qui se cumulent, moins coût source. Filtre `gain_net > 0`.
 *
 * Unité : `gain_net` compte les MORCEAUX QUI PASSENT D'INFAISABLE À FAISABLE.
 * Ne pas dire « morceaux servables » — terme retiré de Quotas par PR #93,
 * réemploi = confusion garantie à 6 mois.
 */

/**
 * Refus persistant d'une proposition — enregistré quand une personne (ou
 * l'organisateur en son nom) refuse un mouvement. Le pool filtre les
 * propositions déjà refusées pour ne pas les reproposer.
 *
 * Défini en PR 1 pour permettre à `calculerPool` de compiler seul. La
 * persistance côté schéma Zod `Inscriptions` est traitée en PR 2 du
 * chantier pool. En attendant, les callers passent `refus: []`.
 */
export interface Refus {
  personne_id: string
  /** Groupe où la personne était et d'où on la retirait. */
  source_groupe_id: string
  /**
   * Groupe cible du mouvement, si le mouvement était un TRANSFERT.
   * Absent pour un RETRAIT SANS RÉAFFECTATION (retrait pur pour libérer
   * un morceau qui ne loge pas).
   */
  cible_groupe_id?: string
  /** ISO datetime du refus, pour audit et éventuel expiration future. */
  refuse_at: string
  /** Motif libre, facultatif — remontée organisateur. */
  motif?: string
}

/**
 * Une proposition du pool — un mouvement possible pour une personne.
 *
 * Deux formes selon la présence de `cible_groupe_id` :
 * - **Transfert** (avec cible) : « retirer Marie de Caravan, la proposer à
 *   Zombie qui cherche du chant ». gain_cible peut valoir 1.
 * - **Retrait sans réaffectation** (sans cible) : « retirer Marie de Feeling
 *   Good pour que le morceau loge ». Marie est libérée sans destination
 *   proposée dans le même mouvement. gain_cible = 0.
 */
export interface Proposition {
  personne_id: string
  source_groupe_id: string
  /** Absent = retrait sans réaffectation. */
  cible_groupe_id?: string
  /** Pupitre concerné par le mouvement (côté source ; identique côté cible). */
  pupitre: Pupitre
  /**
   * 1 si le retrait fait passer le morceau source de « ne loge pas » à
   * « loge dans une salle active » (plafond franchi). 0 sinon. Cf CD 6624 :
   * gain indépendant de la destination.
   */
  gain_source: number
  /**
   * 1 si le morceau cible avait un poste CHERCHE au pupitre de la personne
   * et que ce mouvement le pourvoit. 0 sinon (ou si retrait sans réaffectation).
   */
  gain_cible: number
  /**
   * 1 si retirer la personne laisserait le morceau source avec un pupitre
   * vidé (pupitre à occupant unique). 0 sinon.
   */
  cout_source: number
  /** `gain_source + gain_cible − cout_source`. Filtre pool = `> 0`. */
  gain_net: number
  /**
   * Étiquette lisible pour l'UI. « Transfert » (avec cible) ou
   * « Retrait sans réaffectation » (sans cible).
   */
  nom_mouvement: 'transfert' | 'retrait_sans_reaffectation'
}

/**
 * Compte de personnes distinctes dans les membres d'un groupe (invariant
 * CD 6624 pour Marc basse+chant = 1 personne, pas 2). Utilisé pour la
 * comparaison au plafond de salle et pour la détection de pupitre vidé.
 */
function effectifPersonnes(groupe: Pick<Groupe, 'membres'>): number {
  return new Set(groupe.membres.map((m) => m.personne_id)).size
}

/**
 * Liste des pupitres qu'une personne peut tenir, tirée de ses `instruments`.
 * Défini séparément pour ne pas dépendre d'un groupe (le filtre d'exclusion
 * globale opère sur les pupitres du profil, pas ceux d'une inscription
 * particulière).
 */
function pupitresDePersonne(personne: Pick<Personne, 'instruments'>): Pupitre[] {
  return personne.instruments.map((i) => i.pupitre)
}

/**
 * Groupe sans une personne P — pour simuler l'effet d'un retrait sur la
 * cardinalité et la couverture des pupitres. Retire TOUS les postes de P
 * dans le groupe (Marc basse+chant → les 2 postes disparaissent).
 */
function groupeSansPersonne<G extends Pick<Groupe, 'membres'>>(g: G, personne_id: string): G {
  return { ...g, membres: g.membres.filter((m) => m.personne_id !== personne_id) }
}

/**
 * Pupitres tenus par la personne dans le groupe. Une personne peut occuper
 * plusieurs pupitres dans le même morceau (Marc basse+chant).
 */
function pupitresDePersonneDans(g: Pick<Groupe, 'membres'>, personne_id: string): Pupitre[] {
  return g.membres.filter((m) => m.personne_id === personne_id).map((m) => m.pupitre)
}

/**
 * Nombre de titulaires d'un pupitre donné dans un groupe (pour détecter le
 * pupitre vidé après retrait).
 */
function nbTitulairesPupitre(g: Pick<Groupe, 'membres'>, pupitre: Pupitre): number {
  return g.membres.filter((m) => m.pupitre === pupitre).length
}

/**
 * Vrai si `refus` contient une entrée qui matche la proposition considérée.
 * Match strict sur `(personne_id, source_groupe_id, cible_groupe_id?)`. Un
 * refus « retrait sans réaffectation » (cible_groupe_id absent) ne bloque
 * pas un transfert vers la même source, et réciproquement.
 */
function estRefuse(
  refus: readonly Refus[],
  personne_id: string,
  source_groupe_id: string,
  cible_groupe_id: string | undefined,
): boolean {
  return refus.some(
    (r) =>
      r.personne_id === personne_id &&
      r.source_groupe_id === source_groupe_id &&
      r.cible_groupe_id === cible_groupe_id,
  )
}

/**
 * Calcule le pool complet des propositions de mouvement pertinentes.
 *
 * Fonction pure : `(inscriptions, creneaux, refus, plus_grande_jauge_active)
 * → Proposition[]` triée par `gain_net` décroissant. Aucune dépendance au
 * planning en cours (pas d'accès à `solveurStore.solution`), volontaire —
 * le pool doit fonctionner en phase précoce, avant même la première passe
 * du solveur.
 *
 * Ordre du filtrage :
 * 1. **Q2 structurellement mortes** — personne exclue globalement, pupitre
 *    absent chez la personne, aucun créneau libre côté cible pour son pupitre.
 * 2. **Refus persistants** — l'entrée `(personne, source, cible?)` figure
 *    déjà dans `refus[]`.
 * 3. **Q3 valeur nulle ou négative** — `gain_net ≤ 0`.
 *
 * Deux formes de propositions énumérées :
 * - **Transferts** : pour chaque personne du groupe source × chaque groupe
 *   cible ayant un CHERCHE au pupitre de la personne.
 * - **Retraits sans réaffectation** : pour chaque personne du groupe source,
 *   une proposition sans cible (`cible_groupe_id` absent). N'est retenue
 *   que si `gain_source > 0` (sinon aucun intérêt sans destination).
 *
 * @param inscriptions État courant (mutable) des inscriptions.
 * @param creneaux Grille des créneaux disponibles (utilisé pour vérifier
 *   qu'une personne a au moins un créneau libre côté cible).
 * @param refus Historique des refus persistants — filtre les propositions
 *   déjà refusées. Passer `[]` si pas encore branché (PR 2).
 * @param plus_grande_jauge_active Plus grande jauge parmi les salles
 *   actives, calculée via `plafond-salle::plusGrandeJauge`. Utilisée pour
 *   déterminer si un morceau « loge » avant/après un retrait.
 */
export function calculerPool(
  inscriptions: Inscriptions,
  session: Session,
  creneaux: readonly Creneau[],
  refus: readonly Refus[],
  plus_grande_jauge_active: number,
): Proposition[] {
  const personnesParId = new Map(inscriptions.personnes.map((p) => [p.id, p]))
  const groupes = inscriptions.groupes

  // Q2 filtre 1 : personnes globalement exclues (aucun créneau libre sur
  // aucun de leurs pupitres). Calcul inline via `indispoBloque` — pas de
  // dépendance à `analyserInfaisabilite(session, ...)` qui exigerait la
  // session juste pour cette information, alors que le pool ne dépend pas
  // sinon de la session. `indispoBloque` est correct depuis PR #87.
  const exclues = new Set<string>()
  for (const personne of inscriptions.personnes) {
    const pupitres = pupitresDePersonne(personne)
    if (pupitres.length === 0) continue
    const auMoinsUnCreneau = creneaux.some((c) => !indispoBloque(personne, c, pupitres))
    if (!auMoinsUnCreneau) exclues.add(personne.id)
  }

  const propositions: Proposition[] = []

  for (const source of groupes) {
    const effActuelSource = effectifPersonnes(source)
    // Optimisation : si le morceau loge déjà et n'a aucun pupitre unique,
    // aucun retrait ne peut produire de gain_source ni éviter un coût — on
    // laisse quand même la boucle continuer parce que gain_cible peut suffire.
    const source_ne_loge_pas = effActuelSource > plus_grande_jauge_active

    // Personnes distinctes de ce morceau — Marc basse+chant = 1 personne.
    const personnesSource = new Set(source.membres.map((m) => m.personne_id))

    for (const personne_id of personnesSource) {
      if (exclues.has(personne_id)) continue
      const personne = personnesParId.get(personne_id)
      if (!personne) continue

      const pupitresP = pupitresDePersonneDans(source, personne_id)

      // Simulation du retrait : source sans P (tous ses postes retirés,
      // invariant Marc basse+chant CD 6624).
      const sourceSansP = groupeSansPersonne(source, personne_id)

      // Coût source : au moins un pupitre de P dans source deviendrait vidé
      // après retrait ? Si oui, coût = 1 (le morceau perd un pupitre unique).
      let cout_source = 0
      for (const pup of pupitresP) {
        if (nbTitulairesPupitre(sourceSansP, pup) === 0) {
          cout_source = 1
          break
        }
      }

      // Gain source : le retrait fait passer le morceau de « ne loge pas »
      // à « loge dans une salle active ». Calculé via plafond-salle.ts.
      let gain_source = 0
      if (source_ne_loge_pas) {
        const etatApres = analyserPlafondSalle(sourceSansP, plus_grande_jauge_active).etat
        if (etatApres !== 'ne_loge_pas') gain_source = 1
      }

      // Énumération des cibles = groupes avec CHERCHE au pupitre de P.
      // Pour chaque combinaison (personne, source, cible) on émet un
      // transfert candidat.
      for (const cible of groupes) {
        if (cible.id === source.id) continue

        for (const pup of pupitresP) {
          // Q2 filtre 3 : la cible cherche-t-elle ce pupitre ?
          const cherchesPupitre = cible.postes_cherches.filter((pc) => pc.pupitre === pup)
          if (cherchesPupitre.length === 0) continue

          // Q2 filtre 2 : la personne a-t-elle au moins un créneau libre
          // compatible avec un créneau candidat de la CIBLE ? Le morceau
          // cible n'accepte que les créneaux strictement avant son butoir
          // d'échéance (issue #103) — on filtre les créneaux passés en
          // argument par ce butoir avant de tester `indispoBloque`. Sinon
          // on compterait des créneaux hors fenêtre du morceau, faux
          // positif silencieux du côté « proposition mort-née ».
          const butoirCibleKey = butoirKeyDeGroupe(session, cible.echeance)
          const auMoinsUnCreneau = creneaux.some(
            (c) =>
              `${c.date}T${c.debut.replace(':', '')}` < butoirCibleKey &&
              !indispoBloque(personne, c, [pup]),
          )
          if (!auMoinsUnCreneau) continue

          // Refus persistants
          if (estRefuse(refus, personne_id, source.id, cible.id)) continue

          const gain_cible = 1
          const gain_net = gain_source + gain_cible - cout_source
          if (gain_net <= 0) continue

          propositions.push({
            personne_id,
            source_groupe_id: source.id,
            cible_groupe_id: cible.id,
            pupitre: pup,
            gain_source,
            gain_cible,
            cout_source,
            gain_net,
            nom_mouvement: 'transfert',
          })
        }
      }

      // Retrait sans réaffectation — proposé seulement si gain_source > 0
      // (aucune destination = ne peut valoir qu'en libérant le morceau
      // source de son plafond).
      if (gain_source > 0) {
        // Refus persistants
        if (estRefuse(refus, personne_id, source.id, undefined)) continue

        const gain_net = gain_source - cout_source
        if (gain_net > 0) {
          // Un seul pupitre représentatif dans la proposition — l'affichage
          // pourra détailler « libérer Marc de tous ses postes ». On prend
          // le premier pour lister quelque chose de concret.
          propositions.push({
            personne_id,
            source_groupe_id: source.id,
            pupitre: pupitresP[0],
            gain_source,
            gain_cible: 0,
            cout_source,
            gain_net,
            nom_mouvement: 'retrait_sans_reaffectation',
          })
        }
      }
    }
  }

  // Tri décroissant sur gain_net. Départage par gain_source > 0 (les
  // mouvements qui débloquent un plafond passent devant les simples
  // pourvois CHERCHE) puis par ordre d'énumération (déterministe).
  return propositions.sort((a, b) => {
    if (b.gain_net !== a.gain_net) return b.gain_net - a.gain_net
    return b.gain_source - a.gain_source
  })
}
