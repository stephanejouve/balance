import type { Creneau } from '../domain/grille'
import type { Indispo, Personne, Pupitre } from '../domain/model'

/**
 * Prédicat unifié : est-ce qu'une indisponibilité de la personne bloque
 * ce créneau, pour ces pupitres joués ?
 *
 * Auparavant dupliqué dans 5 modules (solver, verify, renforts, diagnostic,
 * manuel). Factorisé ici pour que la sémantique évolue en un seul endroit —
 * le fix intersection partielle (v0.1.2) aurait dû être appliqué 5 fois
 * sinon.
 *
 * Sémantique par cas :
 *   - `ind.jours` non vide : ne compte que si le créneau tombe un jour ciblé
 *   - `ind.roles` non vide : ne compte que si un des pupitres joués est ciblé
 *   - ni `debut` ni `fin`         → journée entière bloquée
 *   - `debut` seul                → match exact sur début de créneau (compat
 *                                    prototype : les fixtures legacy déclarent
 *                                    chaque tranche horaire concernée)
 *   - `debut` ET `fin`            → plage [debut, fin[ ; bloque si l'intersection
 *                                    avec [c.debut, c.fin[ est non vide (fix
 *                                    du bug d'intersection partielle : 08:30-09:30
 *                                    vs indispo 09:00-11:00 doit bloquer)
 *
 * **Indispos non interprétables** : ignorées dans le calcul, conservées pour
 * affichage. Arbitrage Stéphane 2026-09-02 : « une indisponibilité que le
 * solveur ne comprend pas ne contraint rien — conservée, affichée, mais
 * ignorée dans le calcul ». Sinon un texte libre à sémantique inconnue
 * bloquait toute la semaine (bug smoke #1 : Olivier avec `convalescence` → 0
 * créneau ouvert sur 28).
 *
 * Deux niveaux de rejet :
 *   1. Aucun champ structuré (`convalescence`, `en arrêt maladie`) — le
 *      parser n'a rien extrait, rien à interpréter.
 *   2. Champs structurés partiels + résidu inconnu dans le motif — critère
 *      de forme Stéphane 2026-09-03 21:28 : « arrive mardi midi » extrait
 *      "mardi" mais laisse "arrive" et "midi" (ni horaire, ni rôle, ni mot
 *      vide). Le parser a mordu sur un fragment mais la phrase décrit autre
 *      chose (mouvement, temporalité floue). Bloquer toute la journée serait
 *      pire que ne rien contraindre.
 *
 * Nuances critiques :
 *   - « absent lundi » (`jours=['lundi']`, motif=`absent lundi`) reste
 *     interprétable — « absent » est mot vide.
 *   - Imposés (`debut` ET `fin` posés programmatiquement) — le motif sert
 *     d'étiquette d'affichage (« Imposé : Blue Bossa »), pas de parsing.
 *     Le check résiduel est court-circuité par la garde `debut && fin`.
 */
export function estIndispoInterpretable(ind: Indispo): boolean {
  const aHoraire = Boolean(ind.debut || ind.fin)
  const aJours = ind.jours.length > 0
  const aRoles = ind.roles.length > 0
  if (!aHoraire && !aJours && !aRoles) return false

  // Garde imposé/parser-complet : quand debut ET fin sont posés, l'intention
  // est structurée (parser complet ou construction programmatique via
  // enrichirIndispos). Le motif peut contenir n'importe quel texte libre
  // (nom de morceau imposé, phrase de contexte) — pas de check résiduel.
  if (ind.debut && ind.fin) return true
  // Pas de texte libre à résidu-vérifier (structuré pur côté écran de
  // relecture, ou champ motif absent).
  if (!ind.motif) return true

  // Le critère de forme n'a de sens que si l'extraction structurée pourrait
  // être partielle — i.e., issue d'un parsing texte libre (jours en noms de
  // jour type "mardi", ou roles extraits par mots-clés). Quand `ind.jours`
  // ne contient que des dates ISO ("2026-08-28"), l'intention est explicite
  // (UI ou import structuré) et le motif est descriptif : « RDV médical »,
  // « congés annuels » ne doivent pas invalider une indispo bien posée.
  const joursParTexte = ind.jours.some((j) => JOURS_FR_NORM.includes(j))
  const rolesParTexte = ind.roles.length > 0
  if (!joursParTexte && !rolesParTexte) return true

  return residuNonReconnu(ind.motif, ind.roles).length === 0
}

/** Jours de semaine reconnus par le parser texte libre (miroir de
 *  `stagiaires-adapter.ts::JOURS_FR`). Duplication assumée : un extract vers
 *  un module partagé est un follow-up P3 (aussi en coherence.ts + grille.ts). */
const JOURS_FR_NORM = [
  'dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi',
]

/**
 * Mots vides ignorés par le critère de forme : ils n'ajoutent pas
 * d'information sémantique. Volontairement court — cible les qualificatifs
 * neutres (« absent »), articles, prépositions, connecteurs.
 *
 * Les mots temporels partiels (« matin », « midi », « soir », « aprem »)
 * NE sont PAS des mots vides : ils suggèrent une plage qu'on ne sait pas
 * placer sans risque (« repart jeudi soir » ne dit pas quand exactement —
 * bloquer toute la journée serait trop, ne rien bloquer trop peu).
 */
const MOTS_VIDES = new Set([
  'absent', 'absente', 'absents', 'absentes',
  'indispo', 'indisponible', 'indisponibles',
  'a', 'au', 'aux', // « à » normalisé (NFD)
  'de', 'du', 'des',
  'le', 'la', 'les',
  'et', 'ou',
  'en', 'pour', 'sur',
  // Quantificateurs et unités-jour qui n'ajoutent pas d'info horaire :
  // « toute la journée » = journée entière = équivalent au comportement
  // par défaut « ni debut ni fin bloque le jour » (voir docstring principale).
  'toute', 'toutes', 'tout', 'tous',
  'journee', 'journees', 'jour', 'jours',
])

/** Regex plage horaire — miroir de `parserIndispoLibre` (9h-10h, 9:00-10:00,
 *  9.30 à 10.30). Le flag `g` permet un `replace` global. */
const PLAGE_HORAIRE_RE = /(\d{1,2})[h:.]?(\d{0,2})\s*[-–a]\s*(\d{1,2})[h:.]?(\d{0,2})/gu

function normaliser(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Renvoie les tokens du motif qui ne sont ni un jour, ni une plage horaire,
 * ni un rôle, ni un mot vide. Vide = motif entièrement interprétable au
 * niveau lexical. Ne dépend pas de la sémantique — voir docstring de
 * `estIndispoInterpretable` pour la justification « critère de forme ».
 */
function residuNonReconnu(motif: string, roles: readonly Pupitre[]): string[] {
  let s = normaliser(motif)
  for (const j of JOURS_FR_NORM) s = s.split(j).join(' ')
  for (const r of roles) s = s.split(normaliser(r)).join(' ')
  s = s.replace(PLAGE_HORAIRE_RE, ' ')
  const tokens = s.split(/[^\p{L}\d]+/u).filter(Boolean)
  return tokens.filter((t) => !MOTS_VIDES.has(t))
}

export function indispoBloque(
  personne: Personne,
  creneau: Creneau,
  pupitres: Pupitre[],
): boolean {
  return personne.indispos.some((ind) => {
    if (!estIndispoInterpretable(ind)) return false
    if (ind.jours.length > 0 && !ind.jours.includes(creneau.date)) return false
    if (ind.roles.length > 0 && !pupitres.some((r) => ind.roles.includes(r))) return false
    if (!ind.debut && !ind.fin) return true
    if (ind.debut && !ind.fin) return creneau.debut === ind.debut
    // Intersection [creneau.debut, creneau.fin[ ∩ [ind.debut, ind.fin[ non vide.
    // Note : les early returns ci-dessus garantissent ind.debut && ind.fin ici.
    return creneau.debut < ind.fin! && ind.debut! < creneau.fin
  })
}
