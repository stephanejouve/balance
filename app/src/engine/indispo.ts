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
  const joursParTexte = ind.jours.some((j) => JOURS_FR.includes(j))
  const rolesParTexte = ind.roles.length > 0
  if (!joursParTexte && !rolesParTexte) return true

  return residuNonReconnu(ind.motif, ind.roles).length === 0
}

/** Jours de semaine indexés par `Date.getDay()` (dimanche = 0, ..., samedi = 6).
 *
 *  Constante partagée avec `coherence.ts` — celle-ci l'importe depuis ici
 *  (fix 2026-09-08 « indispo noms de jour » : consolidation des deux
 *  duplicatas voisins au moment du déplacement de `indispoJoursMatche` +
 *  `jourSemaine` vers ce module, cf CD msg 6438). Le duplicata restant
 *  dans `stagiaires-adapter.ts` et `grille.ts` est le sujet d'un ticket
 *  refactor P3 dédié — hors scope de ce fix. */
export const JOURS_FR: string[] = [
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
  for (const j of JOURS_FR) s = s.split(j).join(' ')
  for (const r of roles) s = s.split(normaliser(r)).join(' ')
  s = s.replace(PLAGE_HORAIRE_RE, ' ')
  const tokens = s.split(/[^\p{L}\d]+/u).filter(Boolean)
  return tokens.filter((t) => !MOTS_VIDES.has(t))
}

/**
 * Nom de jour FR (« lundi », « mardi »…) correspondant à une date ISO.
 *
 * Retourne `null` si la date est invalide. Le nom est lowercase, sans
 * accent, aligné avec `JOURS_FR`. Utilisé pour permettre à
 * `indispoJoursMatche` de comparer des noms de jour aux entrées `jours`
 * d'une indispo (en plus des dates ISO).
 *
 * Déplacé depuis `domain/coherence.ts` en 2026-09-08 (CD msg 6438) —
 * l'objectif est une implémentation unique consommée par les deux
 * lecteurs (contrôle d'import cohérence + solveur / diagnostic /
 * verify / renforts / manuel via `indispoBloque`).
 */
export function jourSemaine(dateIso: string): string | null {
  const d = new Date(dateIso + 'T00:00:00')
  if (isNaN(d.getTime())) return null
  return JOURS_FR[d.getDay()]
}

/**
 * True si le tableau `jours` d'une indispo couvre le créneau daté
 * `dateIso`. Trois cas :
 *
 * - `jours` vide → couvre tous les jours de la session (sémantique
 *   « une règle sans jours = tous les jours de la session », alignée
 *   avec la génération de créneaux, cf `grille.ts::genererCreneaux`).
 * - `jours` contient `dateIso` (comparaison ISO littérale) → couvre.
 * - `jours` contient un nom de jour dont le lowercase == `jourSemaineOfDate`
 *   → couvre.
 *
 * Le paramètre `jourSemaineOfDate` est précalculé par l'appelant pour
 * éviter de recréer un `Date` pour chaque indispo d'une même personne
 * (hot loop côté `indispoBloque` et `coherence::_detecterIndispoPercutee`).
 *
 * Déplacée depuis `domain/coherence.ts::_indispoMatche` en 2026-09-08
 * (CD msg 6438). Corrige le défaut du lecteur solveur qui, avant ce
 * déplacement, ne comparait `ind.jours` qu'à `creneau.date` en ISO — les
 * entrées noms de jour (« mardi », « mercredi ») ne matchaient jamais
 * un créneau et les indispos correspondantes étaient silencieusement
 * ignorées (bug smoke Stéphane 2026-09-08 : Chloé placée 3 fois le mardi
 * alors que 4 règles noms couvraient mardi-vendredi). Cf ticket #86.
 */
export function indispoJoursMatche(
  joursIndispo: readonly string[],
  dateIso: string,
  jourSemaineOfDate: string | null,
): boolean {
  if (joursIndispo.length === 0) return true
  for (const j of joursIndispo) {
    if (j === dateIso) return true
    if (jourSemaineOfDate && j.toLowerCase() === jourSemaineOfDate) return true
  }
  return false
}

export function indispoBloque(
  personne: Personne,
  creneau: Creneau,
  pupitres: Pupitre[],
): boolean {
  // Précalcul : le nom de jour d'un créneau ne dépend pas de l'indispo
  // parcourue. Évite N `new Date(...)` pour N indispos de la même personne.
  const jourSem = jourSemaine(creneau.date)
  return personne.indispos.some((ind) => {
    if (!estIndispoInterpretable(ind)) return false
    if (!indispoJoursMatche(ind.jours, creneau.date, jourSem)) return false
    if (ind.roles.length > 0 && !pupitres.some((r) => ind.roles.includes(r))) return false
    if (!ind.debut && !ind.fin) return true
    if (ind.debut && !ind.fin) return creneau.debut === ind.debut
    // Intersection [creneau.debut, creneau.fin[ ∩ [ind.debut, ind.fin[ non vide.
    // Note : les early returns ci-dessus garantissent ind.debut && ind.fin ici.
    return creneau.debut < ind.fin! && ind.debut! < creneau.fin
  })
}
