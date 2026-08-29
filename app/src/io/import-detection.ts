import readXlsxFile from 'read-excel-file/browser'
import type { Impose, Inscriptions, Personne } from '../domain/model'
import { migrerInscriptions } from '../domain/migrate'
import { parseLegacyInscriptions } from '../domain/legacy'
import { extraireListe } from './liste-adapter'
import type { MappingListe } from './liste-adapter'
import { extraireProposes } from './proposes-adapter'
import type { MappingProposes } from './proposes-adapter'
import { extraireStagiaires } from './stagiaires-adapter'
import type { MappingStagiaires } from './stagiaires-adapter'

/**
 * Détection intelligente + préparation d'un état candidat complet
 * (brief « import unique »).
 *
 * Principe structurel : le fichier est lu, validé, et l'état candidat
 * (inscriptions + éventuellement lieu / session / contraintes pour un
 * `.json`) est entièrement construit **avant** toute mutation. À la
 * confirmation, l'UI fait une seule affectation — l'intégrité en cas
 * d'échec n'est plus une affaire de discipline, elle est structurelle.
 *
 * Vérrouille deux défauts latents identifiés (brief § « défauts latents ») :
 *  1. Un adaptateur qui échoue (colonne manquante) → `statut: 'echec'`
 *     sur l'onglet et l'ensemble ne construit pas de candidat pour cette
 *     destination — l'état actuel reste intact.
 *  2. Les noms d'onglets sont matchés insensibles à la casse, aux
 *     accents et aux espaces (`LISTE`, `proposés`, `Liste ` OK).
 */

/** Destination logique d'un onglet reconnu dans l'app. */
export type DestinationOnglet = 'liste' | 'stagiaires' | 'proposes'

/**
 * Effet de l'onglet sur l'état existant :
 * - `remplace` : écrase la donnée existante — Liste, Proposés
 * - `complete` : fusionne avec l'existant — Stagiaires
 * - `ignore`   : onglet non reconnu ou décoché
 */
export type EffetOnglet = 'remplace' | 'complete' | 'ignore'

/** Statut de la lecture d'un onglet. */
export type StatutOnglet = 'ok' | 'echec' | 'ignore'

export interface OngletDetecte {
  /** Nom original de l'onglet dans le classeur. */
  nom: string
  /** Destination canonique (null si non reconnu). */
  destination: DestinationOnglet | null
  effet: EffetOnglet
  statut: StatutOnglet
  /** Résumé chiffré du contenu (pour la ligne de détection). */
  resume: string
  warnings: string[]
  /** Cochée par défaut ? (true pour un onglet reconnu et valide). */
  actifParDefaut: boolean
}

export interface DetectionExcel {
  type: 'xlsx'
  nomFichier: string
  taille: number
  onglets: OngletDetecte[]
  warningsGlobaux: string[]
  /**
   * Résultats précalculés des adaptateurs, indexés par nom d'onglet.
   * Non exposé au composant UI — utilisé par `construireCandidatExcel`
   * pour assembler l'`Inscriptions` candidat à la confirmation.
   */
  _payloads: Map<
    string,
    | { destination: 'liste'; groupes: Inscriptions['groupes'] }
    | { destination: 'stagiaires'; personnes: Personne[] }
    | { destination: 'proposes'; imposes: Impose[] }
  >
}

/** Résultat d'un import `.json` — reprise intégrale, sans sélection. */
export interface PayloadReprise {
  lieu?: unknown
  session?: unknown
  inscriptions?: unknown
  contraintesActives?: unknown
  /** Marque une détection de format legacy (racine avec `groupes`). */
  legacy?: boolean
}

export interface DetectionJson {
  type: 'json'
  nomFichier: string
  taille: number
  payload: PayloadReprise
  warningsGlobaux: string[]
}

export type Detection = DetectionExcel | DetectionJson

/** Sélection utilisateur au moment de la confirmation. */
export interface SelectionExcel {
  /** Noms d'onglets cochés (pour un `.xlsx`). */
  ongletsCoches: Set<string>
  /** Destinations manuelles pour onglets non reconnus (`nom → destination`). */
  destinationsManuelles: Map<string, DestinationOnglet>
}

/* --- Matching des noms d'onglets ---------------------------------------- */

function normaliser(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Noms canoniques acceptés pour chaque destination. Le matching se fait
 * sur la forme normalisée (trim + lowercase + accents retirés) — couvre
 * `LISTE`, `liste`, `Liste `, `PROPOSES`, `proposés`, etc.
 *
 * Volontairement pas de synonymes ni d'heuristiques : ne pas reconnaître
 * un onglet ne coûte rien (il apparaît « non reconnu » avec le sélecteur
 * d'association manuelle, un clic explicite). Reconnaître à tort coûte
 * cher : la case arrive pré-cochée et des données entrent dans un
 * emplacement qui n'est pas le leur sans que personne ne le voie. Un
 * onglet nommé `Concert` peut contenir l'ordre de passage, la liste
 * des invités ou les contacts techniques — deviner ici, c'est parier
 * sur du silence.
 */
const NOMS_CANONIQUES: Record<DestinationOnglet, string> = {
  liste: 'liste',
  stagiaires: 'stagiaires',
  proposes: 'proposes',
}

const EFFET_PAR_DESTINATION: Record<DestinationOnglet, EffetOnglet> = {
  liste: 'remplace',
  stagiaires: 'complete',
  proposes: 'remplace',
}

export function reconnaitreDestination(nomOnglet: string): DestinationOnglet | null {
  const n = normaliser(nomOnglet)
  for (const [dest, canon] of Object.entries(NOMS_CANONIQUES) as Array<[DestinationOnglet, string]>) {
    if (n === canon) return dest
  }
  return null
}

/* --- Détection Excel : lit + valide + précalcule tout ------------------- */

export interface MappingsImport {
  liste: MappingListe
  stagiaires: MappingStagiaires
  proposes: MappingProposes
}

export async function preparerImportExcel(
  file: File,
  mappings: MappingsImport,
  personnesConnues: readonly Personne[],
): Promise<DetectionExcel> {
  // Une seule lecture du classeur — read-excel-file rend
  // `Sheet<number>[]` (= `{ sheet: string, data: Row[] }[]`) quand aucun
  // paramètre `sheet` n'est fourni.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheets = (await (readXlsxFile as any)(file)) as Array<{ sheet: string; data: unknown[][] }>
  return analyserSheetsExcel(sheets, file.name, file.size, mappings, personnesConnues)
}

/**
 * Analyse un ensemble de feuilles déjà lues — même logique que
 * `preparerImportExcel` mais sans l'appel IO. Isolé pour la testabilité :
 * on peut simuler un classeur (Liste avec colonnes non conformes,
 * Stagiaires vide, mix reconnus / non reconnus…) sans binaire réel.
 */
export function analyserSheetsExcel(
  sheets: Array<{ sheet: string; data: unknown[][] }>,
  nomFichier: string,
  taille: number,
  mappings: MappingsImport,
  personnesConnues: readonly Personne[],
): DetectionExcel {
  const onglets: OngletDetecte[] = []
  const warningsGlobaux: string[] = []
  const payloads: DetectionExcel['_payloads'] = new Map()

  for (const s of sheets) {
    const destination = reconnaitreDestination(s.sheet)
    if (destination === null) {
      onglets.push({
        nom: s.sheet,
        destination: null,
        effet: 'ignore',
        statut: 'ignore',
        resume: 'onglet non reconnu — assignable à la main',
        warnings: [],
        actifParDefaut: false,
      })
      continue
    }

    const effet = EFFET_PAR_DESTINATION[destination]

    // Coerce s.data en Array<Array<unknown>> défensivement. `readXlsxFile`
    // devrait toujours rendre un `Row[]`, mais certains classeurs (feuilles
    // vides, formats atypiques, versions différentes de la lib) peuvent
    // produire un `undefined` ou un objet arrayLike. Sans ce guard,
    // `indexerColonnes(rows[0])` plantait avec `e.forEach is not a function`
    // et l'import complet cratérait sans onglet importé.
    const data: unknown[][] = Array.isArray(s.data)
      ? (s.data as unknown[][]).filter((r) => Array.isArray(r))
      : []

    try {
      if (destination === 'liste') {
        const { groupes, warnings } = extraireListe(data, mappings.liste)
        // Migration immédiate en Inscriptions.groupes (LegacyGroupe[] → Groupe[]).
        // On construit une Inscriptions intermédiaire vide autour des groupes.
        const inscMigre = migrerInscriptions(
          { groupes, membresImposes: {}, indispos: [], identitesConnues: [] },
          '_detection_',
        )
        const nGroupes = inscMigre.groupes.length
        const statut: StatutOnglet = nGroupes === 0 ? 'echec' : 'ok'
        onglets.push({
          nom: s.sheet,
          destination,
          effet,
          statut,
          resume:
            statut === 'ok'
              ? `${nGroupes} morceau${nGroupes > 1 ? 'x' : ''}`
              : "échec — aucun morceau extrait (colonnes attendues manquantes ?)",
          warnings,
          actifParDefaut: statut === 'ok',
        })
        if (statut === 'ok') {
          payloads.set(s.sheet, { destination: 'liste', groupes: inscMigre.groupes })
        }
      } else if (destination === 'stagiaires') {
        const { personnes, warnings } = extraireStagiaires(data, mappings.stagiaires)
        const statut: StatutOnglet = personnes.length === 0 ? 'echec' : 'ok'
        onglets.push({
          nom: s.sheet,
          destination,
          effet,
          statut,
          resume:
            statut === 'ok'
              ? `${personnes.length} personne${personnes.length > 1 ? 's' : ''}`
              : 'échec — aucune personne extraite',
          warnings,
          actifParDefaut: statut === 'ok',
        })
        if (statut === 'ok') {
          payloads.set(s.sheet, { destination: 'stagiaires', personnes })
        }
      } else {
        // proposes
        const { imposes, warnings } = extraireProposes(data, mappings.proposes, personnesConnues)
        const nSeances = imposes.reduce((n, i) => n + i.seances.length, 0)
        const statut: StatutOnglet = imposes.length === 0 ? 'echec' : 'ok'
        onglets.push({
          nom: s.sheet,
          destination,
          effet,
          statut,
          resume:
            statut === 'ok'
              ? `${imposes.length} morceau${imposes.length > 1 ? 'x' : ''} · ${nSeances} séance${nSeances > 1 ? 's' : ''}`
              : "échec — aucun morceau proposé extrait",
          warnings,
          actifParDefaut: statut === 'ok',
        })
        if (statut === 'ok') {
          payloads.set(s.sheet, { destination: 'proposes', imposes })
        }
      }
    } catch (err) {
      // Bouclier de dernier recours : un adapter qui lève inattendument
      // ne doit pas cratérer toute la détection — l'onglet passe en échec
      // et l'utilisateur voit ce qui a marché sur les autres onglets.
      onglets.push({
        nom: s.sheet,
        destination,
        effet,
        statut: 'echec',
        resume: `échec — ${err instanceof Error ? err.message : String(err)}`,
        warnings: [],
        actifParDefaut: false,
      })
    }
  }

  if (onglets.length > 0 && onglets.every((o) => o.destination === null)) {
    warningsGlobaux.push(
      `Aucun onglet reconnu (Liste, Stagiaires, Proposés). Onglets présents : ${sheets.map((s) => s.sheet).join(', ') || '(aucun)'}.`,
    )
  }

  return {
    type: 'xlsx',
    nomFichier,
    taille,
    onglets,
    warningsGlobaux,
    _payloads: payloads,
  }
}

/**
 * Construit l'état candidat `Inscriptions` complet à partir de la
 * détection et de la sélection utilisateur. **Ne mute rien** : retourne
 * un nouvel objet, prêt à être affecté en une seule assignation.
 *
 * Sémantique par destination :
 *  - `liste` (remplace) : les groupes du candidat = ceux de l'onglet
 *    (pas de fusion avec les groupes actuels). Les personnes citées par
 *    la Liste sont fusionnées avec `personnes` actuelles (une identité
 *    est identifiée par son id).
 *  - `stagiaires` (complete) : nouvelles personnes ajoutées à l'existant
 *    (les doublons par id sont ignorés).
 *  - `proposes` (remplace) : les imposés du candidat = ceux de l'onglet.
 */
export function construireCandidatExcel(
  detection: DetectionExcel,
  selection: SelectionExcel,
  inscriptionsActuelles: Inscriptions,
  session_id: string,
): Inscriptions {
  const actives = new Map(
    detection.onglets
      .filter((o) => selection.ongletsCoches.has(o.nom) && o.destination !== null && o.statut === 'ok')
      .map((o) => [o.nom, o] as const),
  )

  // Point de départ : l'état actuel (dupliqué en surface — on va remplacer
  // les tableaux qui bougent).
  //
  // INVARIANT — cette fonction ne modifie JAMAIS un champ d'un objet
  // partagé (personne, groupe, imposé). Elle remplace les tableaux ou
  // ajoute des éléments neufs. Le jour où une fusion devra corriger un
  // pupitre sur une personne existante (par exemple), il faudra cloner
  // cette personne — pas l'éditer. Sinon l'appelant qui a gardé une
  // référence à l'ancien état verrait ce changement et « état intact
  // en cas d'échec » deviendrait faux.
  const candidat: Inscriptions = {
    session_id,
    personnes: [...inscriptionsActuelles.personnes],
    groupes: [...inscriptionsActuelles.groupes],
    imposes: [...inscriptionsActuelles.imposes],
  }
  const personnesParId = new Map(candidat.personnes.map((p) => [p.id, p]))

  // Discrimination sur `p.destination` directement (TS narrow correctement
  // la Map union — le pattern « for(dest) then narrow p.destination !== dest »
  // ne propage pas le narrow). L'ordre entre destinations n'importe pas :
  // chacune s'applique à un tableau distinct de `candidat`.
  for (const [nom] of actives) {
    const p = detection._payloads.get(nom)
    if (!p) continue
    if (p.destination === 'liste') {
      candidat.groupes = p.groupes
    } else if (p.destination === 'stagiaires') {
      for (const pers of p.personnes) {
        if (!personnesParId.has(pers.id)) {
          personnesParId.set(pers.id, pers)
          candidat.personnes.push(pers)
        }
      }
    } else {
      // proposes
      candidat.imposes = p.imposes
    }
  }

  return candidat
}

/* --- Détection JSON : parse + valide, mode reprise intégrale ------------ */

export async function preparerImportJson(file: File): Promise<DetectionJson> {
  const texte = await file.text()
  const warningsGlobaux: string[] = []
  let brut: Record<string, unknown>
  try {
    brut = JSON.parse(texte) as Record<string, unknown>
  } catch (err) {
    throw new Error(`JSON invalide : ${err instanceof Error ? err.message : String(err)}`)
  }

  const payload: PayloadReprise = {}
  if (brut.lieu) payload.lieu = brut.lieu
  if (brut.session) payload.session = brut.session
  if (brut.inscriptions) payload.inscriptions = brut.inscriptions
  if (brut.contraintesActives) payload.contraintesActives = brut.contraintesActives

  const rien = Object.keys(payload).length === 0
  if (rien && Array.isArray(brut.groupes)) {
    // Format legacy prototype : { groupes, membresImposes, indispos, identitesConnues }
    payload.legacy = true
    payload.inscriptions = brut
    warningsGlobaux.push(
      `Format legacy détecté (${(brut.groupes as unknown[]).length} groupes) — sera migré vers le modèle canonique.`,
    )
  } else if (rien) {
    throw new Error(
      "Fichier JSON non reconnu : aucun bloc `lieu` / `session` / `inscriptions` ni `groupes` à la racine.",
    )
  }

  return {
    type: 'json',
    nomFichier: file.name,
    taille: file.size,
    payload,
    warningsGlobaux,
  }
}

/**
 * Construit l'état candidat pour un import JSON. **Ne mute rien** —
 * retourne les valeurs à assigner en une seule affectation UI.
 * L'appelant reçoit les blocs présents dans le fichier ; ceux absents
 * restent `undefined` et l'UI garde l'état actuel pour ces blocs.
 */
export function construireCandidatJson(
  detection: DetectionJson,
  session_id: string,
): {
  lieu?: unknown
  session?: unknown
  inscriptions?: Inscriptions
  contraintesActives?: unknown
} {
  const p = detection.payload
  const out: ReturnType<typeof construireCandidatJson> = {}
  if (p.lieu) out.lieu = p.lieu
  if (p.session) out.session = p.session
  if (p.contraintesActives) out.contraintesActives = p.contraintesActives
  if (p.inscriptions) {
    if (p.legacy) {
      // Migration legacy → canonique en une passe, sans mutation en aval
      const legacyParsed = parseLegacyInscriptions(p.inscriptions)
      out.inscriptions = migrerInscriptions(legacyParsed, session_id)
    } else {
      out.inscriptions = p.inscriptions as Inscriptions
    }
  }
  return out
}

/** Bilan de ce qui a été appliqué (pour l'écran 4). */
export interface BilanImport {
  onglets_appliques: Array<{ nom: string; destination: DestinationOnglet; effet: EffetOnglet; resume: string }>
  onglets_ignores: Array<{ nom: string; motif: string }>
  warnings: string[]
}

export function bilanExcel(detection: DetectionExcel, selection: SelectionExcel): BilanImport {
  const appliques: BilanImport['onglets_appliques'] = []
  const ignores: BilanImport['onglets_ignores'] = []
  const warnings: string[] = [...detection.warningsGlobaux]
  for (const o of detection.onglets) {
    if (selection.ongletsCoches.has(o.nom) && o.destination !== null && o.statut === 'ok') {
      appliques.push({ nom: o.nom, destination: o.destination, effet: o.effet, resume: o.resume })
    } else {
      const motif =
        o.statut === 'echec'
          ? 'échec de lecture'
          : o.statut === 'ignore'
            ? 'onglet non reconnu'
            : "décoché par l'utilisateur"
      ignores.push({ nom: o.nom, motif })
    }
    if (o.warnings.length > 0) warnings.push(...o.warnings.map((w) => `[${o.nom}] ${w}`))
  }
  return { onglets_appliques: appliques, onglets_ignores: ignores, warnings }
}
