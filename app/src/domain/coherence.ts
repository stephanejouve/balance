/**
 * Sujet C étendu — cohérence entre onglets (cas I à P).
 *
 * Complémentaire de `domain/identites.ts` (identité intra-session).
 * Cadrage Stéphane 2026-09-01 : « les noms sont sans ambiguïté, ce
 * sont les données qui se contredisent ». Chacun sa source, plus de
 * recouvrement (feedback fix identités PR #41) :
 *
 * - **identité** (`domain/identites.ts`) → regarde ce qui est CITÉ
 * - **cohérence** (ce module) → compare DÉCLARÉ (Stagiaires) vs CITÉ
 *   (Liste/Proposés) + contradictions internes (indispo × Proposés,
 *   morceau vide, latéralité non-batteur, ...)
 *
 * 8 cas (I à P) du corrigé Stéphane :
 *
 * | Cas | Type technique | Gravité |
 * |-----|----------------|---------|
 * | I resp | `responsable_non_cite` | signalement |
 * | I stagiaire | `stagiaire_orphelin` | signalement |
 * | J | `pupitre_contredit` | **alerte** |
 * | K | (rien) | — |
 * | L | `lateralite_non_batteur` | signalement |
 * | M | `indispo_percutee` | **alerte** (contradiction insoluble) |
 * | N | `nom_cite_absent_stagiaires` | signalement |
 * | O | `pupitre_non_declare_polyvalent` | signalement |
 * | P | `morceau_vide` | signalement |
 *
 * **Priorité Stéphane 2026-09-01** : le cas M est le seul qui produit
 * une contradiction que le solveur ne peut pas résoudre (séance déjà
 * fixée + personne indisponible). Les autres sont des erreurs de
 * saisie corrigeables. À traiter en priorité côté UI/action.
 */

import { estIndispoInterpretable } from '../engine/indispo'
import type { Groupe, Impose, Inscriptions, Personne, Pupitre } from './model'

export type AlerteCoherence =
  | {
      type: 'pupitre_contredit'  // J — alerte
      personne: string
      pupitres_declares: readonly Pupitre[]
      pupitre_cite: Pupitre
      morceau: string
    }
  | {
      type: 'indispo_percutee'  // M — alerte (contradiction insoluble)
      personne: string
      morceau: string
      date: string
      debut: string
      fin: string
      motif_indispo: string
    }
  | {
      type: 'responsable_non_cite'  // I resp — signalement
      personne: string
      morceau: string
    }
  | {
      type: 'stagiaire_orphelin'  // I stagiaire — signalement (info mineure)
      personne: string
    }
  | {
      type: 'lateralite_non_batteur'  // L — signalement
      personne: string
      instruments: readonly Pupitre[]
    }
  | {
      type: 'nom_cite_absent_stagiaires'  // N — signalement
      personne: string
      morceau: string
      pupitre: Pupitre
    }
  | {
      type: 'pupitre_non_declare_polyvalent'  // O — signalement
      personne: string
      pupitre_non_declare: Pupitre
      pupitres_cites: readonly Pupitre[]
      pupitres_declares: readonly Pupitre[]
      morceau: string
    }
  | {
      type: 'morceau_vide'  // P — signalement
      morceau: string
    }

/**
 * Point d'entrée : détecte les 8 cas de cohérence sur un `Inscriptions`
 * candidat. Ordre déterministe (tri interne par personne/morceau).
 *
 * Paramètre `stagiaires_ids` (optionnel) — IDs des personnes déclarées
 * DANS l'onglet Stagiaires. Sert au cas N (nom cité dans un morceau,
 * absent de la déclaration Stagiaires). Sans ce paramètre, la détection
 * N est désactivée — utile quand tous les IDs sont pré-résolus (migrate
 * crée à la volée) ou quand la distinction stagiaire/inféré n'a pas de
 * sens dans le contexte.
 */
export function detecterAlertesCoherence(
  inscriptions: Inscriptions,
  options: { stagiaires_ids?: ReadonlySet<string> } = {},
): AlerteCoherence[] {
  const out: AlerteCoherence[] = []
  out.push(..._detecterPupitreContreditEtPolyvalent(inscriptions))
  out.push(..._detecterIndispoPercutee(inscriptions))
  out.push(..._detecterResponsablesNonCites(inscriptions))
  out.push(..._detecterStagiairesOrphelins(inscriptions))
  out.push(..._detecterLateraliteNonBatteur(inscriptions))
  if (options.stagiaires_ids) {
    out.push(..._detecterNomsCitesAbsents(inscriptions, options.stagiaires_ids))
  }
  out.push(..._detecterMorceauxVides(inscriptions))
  return out
}

// ───────────────────────────────────────────────────────────────────────
// J + O — pupitre contredit vs polyvalence non déclarée
// ───────────────────────────────────────────────────────────────────────

/**
 * J = cité 1 seul pupitre sur un morceau, ce pupitre n'est pas dans ses
 * instruments déclarés → **alerte** (probablement erreur de déclaration).
 *
 * O = cité 2+ pupitres sur le même morceau, au moins un non déclaré →
 * **signalement** (polyvalence prouvée par présence multi-pupitre sur
 * un morceau ; il manque juste une déclaration additionnelle).
 *
 * K = cité un pupitre déclaré comme additionnel → aucune alerte.
 */
function _detecterPupitreContreditEtPolyvalent(
  inscriptions: Inscriptions,
): AlerteCoherence[] {
  const parId = new Map(inscriptions.personnes.map((p) => [p.id, p]))
  const alertes: AlerteCoherence[] = []
  for (const g of inscriptions.groupes) {
    // Regrouper par personne_id dans ce groupe (une personne peut avoir
    // plusieurs membres = plusieurs pupitres cités sur le même morceau)
    const pupitresParPersonne = new Map<string, Pupitre[]>()
    for (const m of g.membres) {
      const liste = pupitresParPersonne.get(m.personne_id) ?? []
      liste.push(m.pupitre)
      pupitresParPersonne.set(m.personne_id, liste)
    }
    for (const [personneId, pupitresCites] of [...pupitresParPersonne.entries()].sort()) {
      const p = parId.get(personneId)
      if (!p) continue  // cas N traité ailleurs
      const declares = p.instruments.map((i) => i.pupitre)
      const nonDeclares = pupitresCites.filter((pu) => !declares.includes(pu))
      if (nonDeclares.length === 0) continue  // K : tout déclaré
      if (pupitresCites.length >= 2) {
        // O — polyvalence prouvée sur ce morceau, signalement
        for (const pupitreNd of nonDeclares) {
          alertes.push({
            type: 'pupitre_non_declare_polyvalent',
            personne: _nomAffichage(p),
            pupitre_non_declare: pupitreNd,
            pupitres_cites: [...new Set(pupitresCites)].sort(),
            pupitres_declares: declares,
            morceau: g.titre,
          })
        }
      } else {
        // J — cité un seul pupitre, non déclaré, alerte
        alertes.push({
          type: 'pupitre_contredit',
          personne: _nomAffichage(p),
          pupitres_declares: declares,
          pupitre_cite: pupitresCites[0],
          morceau: g.titre,
        })
      }
    }
  }
  return alertes
}

// ───────────────────────────────────────────────────────────────────────
// M — indisponibilité percutée par séance Proposés (contradiction insoluble)
// ───────────────────────────────────────────────────────────────────────

const JOURS_FR = [
  'dimanche', 'lundi', 'mardi', 'mercredi',
  'jeudi', 'vendredi', 'samedi',
] as const

function _detecterIndispoPercutee(
  inscriptions: Inscriptions,
): AlerteCoherence[] {
  const parId = new Map(inscriptions.personnes.map((p) => [p.id, p]))
  const alertes: AlerteCoherence[] = []
  for (const imp of inscriptions.imposes) {
    for (const seance of imp.seances) {
      const jourSemaine = _jourSemaine(seance.date)
      for (const membre of imp.membres) {
        const p = parId.get(membre)
        if (!p) continue
        for (const indispo of p.indispos) {
          // Filtre les indispos non interprétables (« convalescence » : ni jour,
          // ni horaire, ni rôle). L'import les ignore dans le calcul du solveur
          // et émet un warning explicite « ignorée dans le calcul » — l'écran de
          // relecture ne doit pas non plus les signaler comme contradiction, sous
          // peine de dire deux choses opposées de la même donnée (bug smoke
          // Stéphane 2026-09-03 v20260903.1511 défaut #1 : coherence.ts exigeait
          // un arbitrage sur une contrainte que le solveur n'appliquait plus).
          if (!estIndispoInterpretable(indispo)) continue
          if (!_indispoMatche(indispo.jours, seance.date, jourSemaine)) continue
          if (!_creneauChevauche(seance.debut, seance.fin, indispo.debut, indispo.fin)) continue
          alertes.push({
            type: 'indispo_percutee',
            personne: _nomAffichage(p),
            morceau: imp.morceau,
            date: seance.date,
            debut: seance.debut,
            fin: seance.fin,
            motif_indispo: indispo.motif,
          })
          break  // une alerte par (personne, séance) suffit
        }
      }
    }
  }
  return alertes
}

function _jourSemaine(dateIso: string): string | null {
  const d = new Date(dateIso + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return JOURS_FR[d.getDay()]
}

function _indispoMatche(
  joursIndispo: readonly string[],
  dateIso: string,
  jourSemaine: string | null,
): boolean {
  if (joursIndispo.length === 0) return true  // indispo tous les jours
  for (const j of joursIndispo) {
    if (j === dateIso) return true
    if (jourSemaine && j.toLowerCase() === jourSemaine) return true
  }
  return false
}

function _creneauChevauche(
  seanceDebut: string,
  seanceFin: string,
  indispoDebut: string | undefined,
  indispoFin: string | undefined,
): boolean {
  if (!indispoDebut) return true  // indispo journée entière
  const s1 = _hhmm(seanceDebut)
  const s2 = _hhmm(seanceFin)
  const i1 = _hhmm(indispoDebut)
  const i2 = indispoFin ? _hhmm(indispoFin) : _hhmm(indispoDebut) + 30  // ponctuel
  return s1 < i2 && i1 < s2
}

function _hhmm(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

// ───────────────────────────────────────────────────────────────────────
// I (resp) — responsable d'un morceau, non cité dans ses membres
// ───────────────────────────────────────────────────────────────────────

function _detecterResponsablesNonCites(
  inscriptions: Inscriptions,
): AlerteCoherence[] {
  const parId = new Map(inscriptions.personnes.map((p) => [p.id, p]))
  const alertes: AlerteCoherence[] = []
  for (const g of inscriptions.groupes) {
    if (!g.responsable_id) continue
    const p = parId.get(g.responsable_id)
    if (!p) continue
    const membresIds = new Set(g.membres.map((m) => m.personne_id))
    if (!membresIds.has(g.responsable_id)) {
      alertes.push({
        type: 'responsable_non_cite',
        personne: _nomAffichage(p),
        morceau: g.titre,
      })
    }
  }
  return alertes
}

// ───────────────────────────────────────────────────────────────────────
// I (stagiaire) — orphelin dans aucun morceau
// ───────────────────────────────────────────────────────────────────────

function _detecterStagiairesOrphelins(
  inscriptions: Inscriptions,
): AlerteCoherence[] {
  const idsCites = new Set<string>()
  for (const g of inscriptions.groupes) {
    for (const m of g.membres) idsCites.add(m.personne_id)
  }
  const alertes: AlerteCoherence[] = []
  for (const p of inscriptions.personnes) {
    if (idsCites.has(p.id)) continue
    alertes.push({
      type: 'stagiaire_orphelin',
      personne: _nomAffichage(p),
    })
  }
  return alertes
}

// ───────────────────────────────────────────────────────────────────────
// L — latéralité renseignée sur un non-batteur
// ───────────────────────────────────────────────────────────────────────

function _detecterLateraliteNonBatteur(
  inscriptions: Inscriptions,
): AlerteCoherence[] {
  const alertes: AlerteCoherence[] = []
  for (const p of inscriptions.personnes) {
    const nonBatteurAvecLat = p.instruments.filter(
      (i) => i.pupitre !== 'batterie' && i.lateralite,
    )
    if (nonBatteurAvecLat.length === 0) continue
    alertes.push({
      type: 'lateralite_non_batteur',
      personne: _nomAffichage(p),
      instruments: nonBatteurAvecLat.map((i) => i.pupitre),
    })
  }
  return alertes
}

// ───────────────────────────────────────────────────────────────────────
// N — nom cité dans un morceau, absent de Stagiaires
// ───────────────────────────────────────────────────────────────────────

function _detecterNomsCitesAbsents(
  inscriptions: Inscriptions,
  stagiairesIds: ReadonlySet<string>,
): AlerteCoherence[] {
  const parId = new Map(inscriptions.personnes.map((p) => [p.id, p]))
  const alertes: AlerteCoherence[] = []
  for (const g of inscriptions.groupes) {
    for (const m of g.membres) {
      if (stagiairesIds.has(m.personne_id)) continue
      // Résoudre le nom via `personnes` (peut avoir été inféré par
      // `migrerInscriptions`) sinon `personne_id` brut
      const p = parId.get(m.personne_id)
      alertes.push({
        type: 'nom_cite_absent_stagiaires',
        personne: p ? _nomAffichage(p) : m.personne_id,
        morceau: g.titre,
        pupitre: m.pupitre,
      })
    }
  }
  return alertes
}

// ───────────────────────────────────────────────────────────────────────
// P — morceau sans aucun membre (et rien à CHERCHE)
// ───────────────────────────────────────────────────────────────────────

function _detecterMorceauxVides(
  inscriptions: Inscriptions,
): AlerteCoherence[] {
  // « Encore Sans Titre » du corrigé Stéphane 2026-09-01 : signaler
  // même si postes_cherches présent — « groupe déclaré mais vide », le
  // solveur ne peut rien en faire (les CHERCHE sont des souhaits, pas
  // des membres). L'utilisateur doit le savoir avant de lancer.
  const alertes: AlerteCoherence[] = []
  for (const g of inscriptions.groupes) {
    if (g.membres.length === 0) {
      alertes.push({ type: 'morceau_vide', morceau: g.titre })
    }
  }
  return alertes
}

// ───────────────────────────────────────────────────────────────────────
// UI helpers — grouper par gravité (alertes rouges vs signalements orange)
// ───────────────────────────────────────────────────────────────────────

const TYPES_ALERTES = new Set<AlerteCoherence['type']>([
  'pupitre_contredit',
  'indispo_percutee',
])

export interface AlertesCoherenceGroupees {
  alertes: AlerteCoherence[]  // rouge — décision requise
  signalements: AlerteCoherence[]  // orange — info
}

export function grouperAlertesCoherence(
  alertes: readonly AlerteCoherence[],
): AlertesCoherenceGroupees {
  const out: AlertesCoherenceGroupees = { alertes: [], signalements: [] }
  for (const a of alertes) {
    if (TYPES_ALERTES.has(a.type)) out.alertes.push(a)
    else out.signalements.push(a)
  }
  return out
}

// ───────────────────────────────────────────────────────────────────────

function _nomAffichage(p: Personne): string {
  return p.discriminant ? `${p.nom} ${p.discriminant}` : p.nom
}
