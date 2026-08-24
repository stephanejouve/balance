import { z } from 'zod'

/**
 * Modèle canonique de la refonte MF-RepSal.
 *
 * Trois jeux de données indépendants (cf. brief §11) :
 *   - `Lieu`         — salles d'un site, réutilisable session après session
 *   - `Session`      — dates, grille de créneaux, plafonds, propre à un stage
 *   - `Inscriptions` — personnes et groupes, propres à chaque session
 *
 * Chaque jeu est parsable / sérialisable indépendamment.
 */

/** Accepte 24:00 pour représenter la fin de journée (repris du prototype). */
const HH_MM_RE = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/
export const HhMm = z.string().regex(HH_MM_RE, 'attendu HH:MM (ou 24:00 pour minuit)')
export type HhMm = z.infer<typeof HhMm>

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const IsoDate = z.string().regex(ISO_DATE_RE, 'attendu AAAA-MM-JJ')
export type IsoDate = z.infer<typeof IsoDate>

/* ---------------------------------------------------------------- Personnes */

/** Pupitres par défaut. Configurable par lieu (brief §11 "vocabulaire"). */
export const PUPITRES_DEFAULTS = [
  'chant',
  'piano',
  'basse',
  'batterie',
  'guitare',
  'vents',
] as const
export const Pupitre = z.string().min(1)
export type Pupitre = z.infer<typeof Pupitre>

export const Instrument = z.object({
  pupitre: Pupitre,
  /** Précision libre (ex. « clarinette basse », « contrebasse ») — facultative. */
  precision: z.string().optional(),
})
export type Instrument = z.infer<typeof Instrument>

export const Lateralite = z.enum(['droitier', 'gaucher'])
export type Lateralite = z.infer<typeof Lateralite>

export const RolePersonne = z.enum(['musicien', 'chanteur', 'intervenant'])
export type RolePersonne = z.infer<typeof RolePersonne>

/**
 * Indispo d'une personne. Peut cibler :
 *  - un ou plusieurs jours précis (`jours`), ou tous (`jours` vide)
 *  - un intervalle horaire (`debut`/`fin`), ou l'intégralité du jour
 *  - éventuellement seulement certains rôles (`roles`) — reprend la
 *    sémantique du prototype (cf. `roles: ['chant']`)
 */
export const Indispo = z.object({
  jours: z.array(IsoDate).default([]),
  debut: HhMm.optional(),
  fin: HhMm.optional(),
  roles: z.array(Pupitre).default([]),
  motif: z.string().default(''),
})
export type Indispo = z.infer<typeof Indispo>

export const Personne = z.object({
  id: z.string().min(1),
  /** Prénom (ou nom d'usage principal). */
  nom: z.string().min(1),
  /** Discriminant d'unicité : initiale, nom, tag entre parenthèses. */
  discriminant: z.string().default(''),
  instruments: z.array(Instrument).default([]),
  lateralite: Lateralite.optional(),
  role: RolePersonne.default('musicien'),
  indispos: z.array(Indispo).default([]),
})
export type Personne = z.infer<typeof Personne>

/** Libellé d'affichage : `Pierre (SIG)`, `David R.`, `Colette`. */
export function libellePersonne(p: Personne): string {
  return p.discriminant ? `${p.nom} ${p.discriminant}`.trim() : p.nom
}

/* -------------------------------------------------------------------- Lieux */

export const Equipement = z.enum(['batterie', 'piano', 'ampli', 'sono'])
export type Equipement = z.infer<typeof Equipement>

export const RestrictionHoraire = z.object({
  debut: HhMm,
  fin: HhMm,
  /** Contrainte imposée sur cette plage. */
  contrainte: z.enum(['acoustique_seulement', 'interdit']),
  motif: z.string().default(''),
})
export type RestrictionHoraire = z.infer<typeof RestrictionHoraire>

export const Salle = z.object({
  id: z.string().min(1),
  nom: z.string().min(1),
  jauge: z.number().int().positive(),
  equipement: z.array(Equipement).default([]),
  restrictions: z.array(RestrictionHoraire).default([]),
  actif: z.boolean().default(true),
})
export type Salle = z.infer<typeof Salle>

export const Lieu = z.object({
  id: z.string().min(1),
  nom: z.string().min(1),
  salles: z.array(Salle),
  /** Pupitres reconnus sur ce lieu (défaut = `PUPITRES_DEFAULTS`). */
  pupitres: z.array(Pupitre).default([...PUPITRES_DEFAULTS]),
})
export type Lieu = z.infer<typeof Lieu>

/* -------------------------------------------------------- Session (dates) */

/**
 * Règle DSL de génération de créneaux (S2). Volontairement minimale pour cette
 * itération : un motif journalier avec pas configurable et sélection de salles.
 * L'extension (blocages, exceptions ponctuelles, plages libres) viendra avec
 * l'implémentation du générateur.
 */
export const RegleCreneau = z.object({
  /** Jours ciblés (ISO). Vide = tous les jours de la session. */
  jours: z.array(IsoDate).default([]),
  debut: HhMm,
  fin: HhMm,
  /** Durée d'un tour, en minutes. Défaut 60. */
  pas_minutes: z.number().int().positive().default(60),
  /** Restreint aux salles listées. Vide = toutes les salles actives du lieu. */
  salles: z.array(z.string()).default([]),
  /** Si `true` : retire les créneaux plutôt que les créer (exception). */
  bloque: z.boolean().default(false),
})
export type RegleCreneau = z.infer<typeof RegleCreneau>

export const Session = z.object({
  id: z.string().min(1),
  nom: z.string().min(1),
  lieu_id: z.string().min(1),
  date_debut: IsoDate,
  date_fin: IsoDate,
  /** Toutes les répétitions doivent tomber strictement avant. */
  date_butoir: IsoDate,
  butoir_heure: HhMm.default('23:59'),
  grille: z.array(RegleCreneau).default([]),
  plafond_morceaux: z.number().int().positive().default(13),
  repetitions_visees: z.number().int().positive().default(3),
  repetitions_min: z.number().int().positive().default(2),
})
export type Session = z.infer<typeof Session>

/* -------------------------------------------------------------- Groupes ---*/

export const MembreGroupe = z.object({
  personne_id: z.string().min(1),
  pupitre: Pupitre,
  precision: z.string().optional(),
})
export type MembreGroupe = z.infer<typeof MembreGroupe>

export const Groupe = z.object({
  id: z.string().min(1),
  titre: z.string().min(1),
  auteur: z.string().default(''),
  style: z.string().default(''),
  tonalite: z.string().default(''),
  responsable_id: z.string().default(''),
  membres: z.array(MembreGroupe).default([]),
  postes_cherches: z.array(Pupitre).default([]),
})
export type Groupe = z.infer<typeof Groupe>

/* ---------------------------------------------------------- Inscriptions --*/

export const Inscriptions = z.object({
  session_id: z.string().min(1),
  personnes: z.array(Personne).default([]),
  groupes: z.array(Groupe).default([]),
})
export type Inscriptions = z.infer<typeof Inscriptions>

/* ---------------------------------------------------------- Utilitaires ---*/

export function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
