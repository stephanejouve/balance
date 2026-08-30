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

export const Lateralite = z.enum(['droitier', 'gaucher'])
export type Lateralite = z.infer<typeof Lateralite>

export const Instrument = z.object({
  pupitre: Pupitre,
  /** Précision libre (ex. « clarinette basse », « contrebasse ») — facultative. */
  precision: z.string().optional(),
  /**
   * Instrument encombrant / difficile à déplacer (contrebasse, ampli lourd, kit
   * atypique…). Le solveur préfère alors regrouper les répétitions de cette
   * personne (pour cet instrument-là) dans une même salle — évite de trimballer
   * l'instrument à travers le lieu à chaque changement de créneau.
   *
   * Défaut : `false`. Prudent parce que la préférence « salle stable pour
   * lourd » a un coût (elle réduit la latitude du solveur, peut forcer une
   * salle non idéale). L'activer par défaut pénaliserait la majorité des
   * instruments non-encombrants pour rien. C'est à la personne qui saisit
   * son instrument de cocher — un guitariste standard n'a pas à y penser.
   */
  lourd: z.boolean().default(false),
  /**
   * Latéralité — droitier / gaucher. Attribut **par instrument** parce
   * qu'il ne fait sens que pour la batterie (optimisation d'inversion de
   * kit entre morceaux consécutifs au concert). Une personne qui joue
   * chant + batterie n'a « une latéralité » que dans le contexte de la
   * batterie ; la préciser sur le chant serait dénué de sens.
   *
   * Le solveur / calculateur conducteur ne consulte cette valeur que
   * pour l'instrument batterie de la personne engagée dans un groupe.
   */
  lateralite: Lateralite.optional(),
})
export type Instrument = z.infer<typeof Instrument>

export const RolePersonne = z.enum(['musicien', 'chanteur', 'intervenant'])
export type RolePersonne = z.infer<typeof RolePersonne>

/**
 * Indispo d'une personne. Peut cibler :
 *  - un ou plusieurs jours précis (`jours`), ou tous (`jours` vide)
 *  - un intervalle horaire (`debut`/`fin`), l'intégralité du jour, ou un
 *    créneau ponctuel
 *  - éventuellement seulement certains rôles (`roles`) — reprend la
 *    sémantique du prototype (cf. `roles: ['chant']`)
 *
 * Sémantique horaire :
 *  - ni `debut` ni `fin`      → journée entière
 *  - `debut` seul             → créneau commençant exactement à `debut`
 *                               (compatibilité prototype : match sur début)
 *  - `debut` et `fin`         → plage `[debut, fin[`
 */
export const Indispo = z.object({
  jours: z.array(IsoDate).default([]),
  debut: HhMm.optional(),
  fin: HhMm.optional(),
  roles: z.array(Pupitre).default([]),
  motif: z.string().default(''),
})
export type Indispo = z.infer<typeof Indispo>

// preprocess : back-compat pour les états JSON antérieurs à 2026-08-30
// qui avaient `Personne.lateralite`. On la déplace vers l'instrument
// batterie de la personne (là où elle a du sens sémantiquement). Si la
// personne n'a pas d'instrument batterie, la valeur est jetée
// silencieusement — elle n'avait pas de sens de toute façon.
const PersonneBrute = z.object({
  id: z.string().min(1),
  /** Prénom (ou nom d'usage principal). */
  nom: z.string().min(1),
  /** Discriminant d'unicité : initiale, nom, tag entre parenthèses. */
  discriminant: z.string().default(''),
  instruments: z.array(Instrument).default([]),
  role: RolePersonne.default('musicien'),
  indispos: z.array(Indispo).default([]),
  /** @deprecated — voir migration ci-dessous. */
  lateralite: Lateralite.optional(),
})
export const Personne = PersonneBrute.transform((p) => {
  if (p.lateralite) {
    const batterie = p.instruments.find((i) => i.pupitre === 'batterie')
    if (batterie && !batterie.lateralite) {
      batterie.lateralite = p.lateralite
    }
  }
  const { lateralite: _drop, ...clean } = p
  return clean
})
export type Personne = z.infer<typeof Personne>

/** Libellé d'affichage : `Pierre (SIG)`, `David R.`, `Colette`. */
export function libellePersonne(p: Personne): string {
  return p.discriminant ? `${p.nom} ${p.discriminant}`.trim() : p.nom
}

/* -------------------------------------------------------------------- Lieux */

export const Equipement = z.enum(['batterie', 'piano', 'ampli', 'sono'])
export type Equipement = z.infer<typeof Equipement>

/**
 * Restriction horaire d'une salle. Trois régimes :
 *  - `interdit` : la salle est fermée dans `[debut, fin[` (dortoirs, autre
 *    usage réservé). Aucun placement possible.
 *  - `acoustique_seulement` : la salle reste ouverte mais uniquement pour
 *    des pratiques discrètes (V1 = warning, pas encore de discrimination).
 *  - `pas_reduit` : la salle est ouverte mais seulement pour des créneaux
 *    dont la durée ≤ `pas_max_minutes`. Utile pour un régime « ateliers
 *    30 min entre deux répétitions du concert du vendredi ».
 *
 * `jours` cible des dates ISO précises. Vide = tous les jours de la session
 * (comportement historique).
 */
export const RestrictionHoraire = z.object({
  jours: z.array(IsoDate).default([]),
  debut: HhMm,
  fin: HhMm,
  contrainte: z.enum(['interdit', 'acoustique_seulement', 'pas_reduit']),
  pas_max_minutes: z.number().int().positive().optional(),
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

/**
 * Fonctions débrayables du lieu — brief « import unique » §
 * « Précision étape 1c débrayable ».
 *
 * Un lieu peut ne pas héberger un concert du vendredi, ne pas produire
 * de spectacle final, ne pas suivre la charge par musicien, etc. Ces
 * bascules pilotent à la fois l'UI (sections cachées) ET la cascade
 * du solveur (les données correspondantes n'entrent pas dans le calcul).
 * Une contrainte invisible mais active serait le pire résultat possible.
 *
 * Persistées avec le profil du lieu (§12 : changer de lieu emporte sa
 * configuration).
 *
 * **Piège migration** : un `.json` antérieur à cette version n'a pas ce
 * champ. Défaut = tout à `true` — le comportement historique est
 * strictement préservé, une session ancienne rouvrira sans perte
 * silencieuse de contrainte.
 *
 * Dépendance UI (non exprimée en Zod, appliquée par
 * `normaliserFonctionsActivees`) : `conducteur` implique
 * `ordre_passage` — on ne minute pas un spectacle sans savoir dans
 * quel ordre il passe.
 */
export const FonctionsActivees = z.object({
  /** Étape 1c — morceaux imposés du concert du vendredi. Décoché → le
   *  solveur ignore les imposés dans `enrichirIndispos`. */
  proposes: z.boolean().default(true),
  /** Conducteur du spectacle — vue Concert + minutage + inversions kit. */
  conducteur: z.boolean().default(true),
  /** Ordre de passage — drag/drop et scoring d'un ordre du concert. */
  ordre_passage: z.boolean().default(true),
  /** Charge par musicien — vue Quotas + alertes seuil charge/jour. */
  charge: z.boolean().default(true),
  /** Suggestions de renforts — quand un groupe cherche un pupitre. */
  renforts: z.boolean().default(true),
})
export type FonctionsActivees = z.infer<typeof FonctionsActivees>

/**
 * Valeur par défaut de `FonctionsActivees` : tout à `true`.
 *
 * Explicite (plutôt que dérivée de `FonctionsActivees.parse({})`) parce
 * que Zod v4 applique `.default()` sur la valeur *output*, pas sur
 * l'input — un default `{}` littéral resterait `{}` sans se remplir des
 * defaults intérieurs. On expose donc cette constante et on la passe à
 * `Lieu.parse` en default du champ `fonctionsActivees`.
 */
export const FONCTIONS_ACTIVEES_TOUT_ACTIF: FonctionsActivees = {
  proposes: true,
  conducteur: true,
  ordre_passage: true,
  charge: true,
  renforts: true,
}

export const Lieu = z.object({
  id: z.string().min(1),
  nom: z.string().min(1),
  salles: z.array(Salle),
  /** Pupitres reconnus sur ce lieu (défaut = `PUPITRES_DEFAULTS`). */
  pupitres: z.array(Pupitre).default([...PUPITRES_DEFAULTS]),
  /** Fonctions du lieu activées. Voir `FonctionsActivees` pour le piège
   *  migration : absent → tout à `true`. */
  fonctionsActivees: FonctionsActivees.default(FONCTIONS_ACTIVEES_TOUT_ACTIF),
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
  /**
   * Marge d'occupation en pourcentage : le solveur ne remplit pas plus de
   * `(100 - marge_pct)`% des salles disponibles à chaque créneau. Permet
   * de garder du jeu pour les imprévus (brief §5 « un planning optimal à
   * 100 % est un planning qui casse au premier contretemps »).
   * 0 = comportement historique (peut saturer à 100%).
   */
  marge_pct: z.number().min(0).max(90).default(0),
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
  /**
   * Répétitions déjà effectuées (ex : recalcul en milieu de session).
   * Le solveur ne cherche que `session.repetitions_visees - repetitions_deja_faites`
   * créneaux supplémentaires pour ce groupe. Défaut 0 = rien de fait.
   */
  repetitions_deja_faites: z.number().int().min(0).default(0),
})
export type Groupe = z.infer<typeof Groupe>

/* --------------------------------------------- Morceaux imposés ---------*/

/**
 * Séance de répétition déjà planifiée pour un morceau imposé — date, plage
 * horaire, éventuellement salle (informative). Le solveur en dérive une
 * `Indispo` pour chaque membre du morceau : ils sont bloqués sur cette
 * plage-là, quel que soit leur autre engagement.
 */
export const Seance = z.object({
  date: IsoDate,
  debut: HhMm,
  fin: HhMm,
  salle_id: z.string().optional(),
})
export type Seance = z.infer<typeof Seance>

/**
 * Morceau imposé du stage (les 12 morceaux « obligatoires » du prototype
 * en sont un exemple). Chaque imposé cite les personnes qui y jouent et
 * les séances déjà planifiées — ces créneaux sont retirés du champ des
 * possibles pour les groupes volontaires partageant des membres.
 */
export const Impose = z.object({
  id: z.string().min(1),
  morceau: z.string().min(1),
  membres: z.array(z.string()).default([]),
  seances: z.array(Seance).default([]),
})
export type Impose = z.infer<typeof Impose>

/* ---------------------------------------------------------- Inscriptions --*/

export const Inscriptions = z.object({
  session_id: z.string().min(1),
  personnes: z.array(Personne).default([]),
  groupes: z.array(Groupe).default([]),
  imposes: z.array(Impose).default([]),
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

/**
 * Génère un identifiant opaque stable pour une nouvelle entité (Personne,
 * Groupe, Salle, Impose). Format : préfixe humain + UUID court, ex.
 * `personne-01H8Y9Z2K3F4M5N6P7Q8R9S0T1`.
 *
 * Motivation Sujet A (feedback Claude Desktop 2026-08-30) : l'id doit
 * être **indépendant du nom** pour que le renommage ne casse pas les
 * références dans `MembreGroupe.personne_id`, `Impose.membres`, etc.
 *
 * Le préfixe humain (« personne- », « groupe- », …) n'est pas requis
 * pour l'unicité mais aide au debug côté logs et introspection JSON
 * (on reconnaît le type d'entité).
 *
 * Utilise `crypto.randomUUID()` (dispo dans tous les navigateurs
 * modernes + Node 20+). L'UUID v4 (128 bits, randomness suffisant) est
 * sérialisé en hex pour compacité.
 */
function _nouvelIdSuffixe(): string {
  // crypto.randomUUID est dispo côté browser (Balance offline-first) et
  // côté Node (tests). Fallback timestamp+random si absent (envs très
  // anciens — ne devrait pas arriver mais évite un throw).
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '')
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function nouvelIdPersonne(): string {
  return `personne-${_nouvelIdSuffixe()}`
}
export function nouvelIdGroupe(): string {
  return `groupe-${_nouvelIdSuffixe()}`
}
export function nouvelIdSalle(): string {
  return `salle-${_nouvelIdSuffixe()}`
}
export function nouvelIdImpose(): string {
  return `impose-${_nouvelIdSuffixe()}`
}
