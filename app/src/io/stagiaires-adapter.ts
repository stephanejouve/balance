import { pupitreDe } from '../domain/migrate'
import type { Indispo, Personne, Pupitre } from '../domain/model'
import { PUPITRES_DEFAULTS, slug } from '../domain/model'

/**
 * Adapter du classeur Excel de l'association — onglet `Stagiaires` —
 * vers le modèle canonique `Personne[]`.
 *
 * Convention terrain :
 *   - une ligne par personne
 *   - colonne `Nom` obligatoire (avec discriminant optionnel entre
 *     parenthèses : `Emma (B)` = distingue une homonyme)
 *   - colonne `Pupitre principal` — un des 6 pupitres du lieu
 *   - colonne `Pupitres additionnels` — pour les polyvalents, virgulés
 *   - colonne `Instrument` — precision libre (`sax alto`, `contrebasse`)
 *   - colonne `Latéralité` — `droitier` / `gaucher` (batteurs seulement)
 *   - colonne `Indispos` — format libre, parsé en best-effort
 *
 * L'import peuple `inscriptions.personnes` sans les rattacher à un
 * groupe : ils apparaissent comme « libres » et deviennent
 * automatiquement candidats renforts pour les groupes cherchant leur
 * pupitre.
 */

export interface MappingStagiaires {
  ligneEnTete?: number
  colonneNom: string
  colonnePupitrePrincipal?: string
  colonnePupitresAdditionnels?: string
  colonneInstrument?: string
  colonneLateralite?: string
  colonneIndispos?: string
}

/**
 * Mapping par défaut aligné sur la convention Musiques Festives.
 * Descendu depuis `App.svelte` en 2026-08-27 (brief import unique § « prérequis
 * du classeur modèle ») pour que le générateur de modèle vive à la même source
 * que l'importeur.
 */
export const MAPPING_STAGIAIRES_DEFAUT: MappingStagiaires = {
  colonneNom: 'Nom',
  colonnePupitrePrincipal: 'Pupitre',
  colonnePupitresAdditionnels: 'Pupitres additionnels',
  colonneInstrument: 'Instrument',
  colonneLateralite: 'Latéralité',
  colonneIndispos: 'Indispos',
}

type Cellule = unknown

function texte(c: Cellule): string {
  if (c == null) return ''
  if (typeof c === 'string') return c.trim()
  return String(c).trim()
}

function indexerColonnes(entete: Cellule[]): Map<string, number> {
  const m = new Map<string, number>()
  entete.forEach((c, i) => {
    const t = texte(c)
    if (t) m.set(t, i)
  })
  return m
}

/**
 * Parse un texte d'indisponibilité au format libre. Extraction
 * best-effort — le texte brut est toujours conservé dans `motif` pour
 * relecture humaine.
 *
 * Motifs reconnus :
 *   - noms de jours FR (`lundi`, `mardi`… tolérant à la casse et aux
 *     accents) → remplit `jours` (jours de la semaine — le générateur
 *     de créneaux les résout ensuite en dates ISO)
 *   - plage horaire `9h-10h`, `9:00-10:00`, `09h30-10h` → `debut`/`fin`
 *   - noms de pupitres → `roles`
 */
const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function normaliser(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

function parseHeure(h: string, m: string): string {
  const hh = String(parseInt(h, 10)).padStart(2, '0')
  const mm = m ? String(parseInt(m, 10)).padStart(2, '0') : '00'
  return `${hh}:${mm}`
}

export function parserIndispoLibre(brut: string): Indispo | null {
  const t = brut.trim()
  if (!t) return null
  const norm = normaliser(t)

  const jours: string[] = []
  for (const j of JOURS_FR) if (norm.includes(j)) jours.push(j)

  const roles: Pupitre[] = []
  for (const pup of PUPITRES_DEFAULTS) if (norm.includes(pup)) roles.push(pup)

  let debut: string | undefined
  let fin: string | undefined
  const plage = norm.match(/(\d{1,2})[h:.]?(\d{0,2})\s*[-–à]\s*(\d{1,2})[h:.]?(\d{0,2})/)
  if (plage) {
    debut = parseHeure(plage[1], plage[2])
    fin = parseHeure(plage[3], plage[4])
  }

  return {
    jours,
    debut,
    fin,
    roles,
    motif: t,
  }
}

export function extraireDiscriminant(nom: string): { nom: string; discriminant: string } {
  const m = nom.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (m) return { nom: m[1].trim(), discriminant: `(${m[2].trim()})` }
  return { nom: nom.trim(), discriminant: '' }
}

export interface ExtractionStagiaires {
  personnes: Personne[]
  warnings: string[]
}

/**
 * Ensemble des pupitres reconnus pour la validation. Par défaut = pupitres
 * standards. L'appelant peut passer un sur-ensemble via `pupitresValides`
 * (utile quand un lieu ajoute un pupitre custom).
 */
function ensemblePupitres(pupitresValides?: readonly Pupitre[]): Set<Pupitre> {
  if (pupitresValides && pupitresValides.length > 0) return new Set(pupitresValides)
  return new Set(PUPITRES_DEFAULTS)
}

export function extraireStagiaires(
  rows: Cellule[][],
  mapping: MappingStagiaires,
  pupitresValides?: readonly Pupitre[],
): ExtractionStagiaires {
  const warnings: string[] = []
  const ligneEnTete = mapping.ligneEnTete ?? 0
  if (rows.length <= ligneEnTete) {
    return { personnes: [], warnings: [`classeur vide (${rows.length} lignes, en-tête ligne ${ligneEnTete})`] }
  }
  const cols = indexerColonnes(rows[ligneEnTete])
  const iNom = cols.get(mapping.colonneNom)
  if (iNom === undefined) {
    return { personnes: [], warnings: [`colonne « ${mapping.colonneNom} » introuvable`] }
  }
  const pupitresOk = ensemblePupitres(pupitresValides)
  // Warn quand une colonne optionnelle est configurée mais absente de l'en-tête.
  // Auparavant swallow silencieusement (audit Leader) → un utilisateur qui
  // renommait `Pupitre` en `Pupitre principal` perdait le mapping sans avertissement.
  const idx = (name: string | undefined, labelPourWarn: string): number | undefined => {
    if (!name) return undefined
    const i = cols.get(name)
    if (i === undefined) warnings.push(`colonne « ${name} » (${labelPourWarn}) introuvable — ignorée`)
    return i
  }
  const iPupitre = idx(mapping.colonnePupitrePrincipal, 'pupitre principal')
  const iAdditionnels = idx(mapping.colonnePupitresAdditionnels, 'pupitres additionnels')
  const iInstrument = idx(mapping.colonneInstrument, 'instrument')
  const iLateralite = idx(mapping.colonneLateralite, 'latéralité')
  const iIndispos = idx(mapping.colonneIndispos, 'indispos')

  const personnes: Personne[] = []
  const seen = new Set<string>()

  for (let r = ligneEnTete + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue
    const brut = texte(row[iNom])
    if (!brut) continue
    const { nom, discriminant } = extraireDiscriminant(brut)
    // ⚠  N'IMPORTEZ PAS CE PATTERN DANS UN NOUVEL ADAPTATEUR.
    //
    // L'id est ici dérivé du nom+discriminant comme reliquat pré-Sujet A
    // (dedup naturelle intra-import : 2 lignes = même personne = même id).
    // Le renommage post-import côté UI n'affecte pas cet id (bind:value
    // sur `.nom` seul), donc les références restent cohérentes en
    // pratique.
    //
    // Pour tout NOUVEAU parseur / importeur, utiliser `nouvelIdPersonne()`
    // de `domain/model.ts` (UUID opaque, doctrine Sujet A). L'harmonisation
    // de ce fichier + la vraie dedup cross-import via `Map<slug, uuid>`
    // portée par la session sera traitée dans le Sujet C (écran de
    // relecture des identités). Pas d'heuristique Levenshtein silencieuse
    // — feedback Claude Desktop 2026-08-30, coût asymétrique d'une
    // fusion silencieuse vs un import refusé.
    const id = slug(discriminant ? `${nom} ${discriminant}` : nom)
    if (seen.has(id)) {
      warnings.push(`ligne ${r + 1} : ${brut} déjà présent — doublon ignoré`)
      continue
    }
    seen.add(id)

    // Instruments = pupitre principal + additionnels
    const instruments: Personne['instruments'] = []
    const pupitres: Pupitre[] = []
    const principal = iPupitre !== undefined ? texte(row[iPupitre]).toLowerCase() : ''
    if (principal) pupitres.push(principal)
    if (iAdditionnels !== undefined) {
      const add = texte(row[iAdditionnels])
        .split(/[,;]+/)
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
      for (const a of add) if (!pupitres.includes(a)) pupitres.push(a)
    }
    // Validation des pupitres contre l'ensemble reconnu (par défaut PUPITRES_DEFAULTS).
    // Auparavant tout string était accepté silencieusement → une typo `guitar` au
    // lieu de `guitare` créait un pupitre fantôme jamais utilisé par le solveur.
    for (const pup of pupitres) {
      if (!pupitresOk.has(pup)) {
        warnings.push(
          `ligne ${r + 1} (${brut}) : pupitre « ${pup} » non reconnu — attendu parmi ${[...pupitresOk].join(', ')}`,
        )
      }
    }
    if (pupitres.length === 0) {
      warnings.push(`ligne ${r + 1} (${brut}) : aucun pupitre déclaré — personne créée sans instrument`)
    }
    const precisionCommune = iInstrument !== undefined ? texte(row[iInstrument]) : ''
    for (const pup of pupitres) {
      const { precision } = precisionCommune
        ? pupitreDe(precisionCommune)
        : { precision: undefined }
      // Le pupitre déclaré par la colonne fait autorité — la precision issue
      // de la colonne Instrument vient l'étoffer, pas le remplacer.
      instruments.push({ pupitre: pup, precision: precision ?? undefined, lourd: false })
    }

    const rawLat = iLateralite !== undefined ? texte(row[iLateralite]).toLowerCase() : ''
    let lateralite: 'droitier' | 'gaucher' | undefined
    if (rawLat === 'droitier' || rawLat === 'droite' || rawLat === 'd') lateralite = 'droitier'
    else if (rawLat === 'gaucher' || rawLat === 'gauche' || rawLat === 'g') lateralite = 'gaucher'
    else if (rawLat) warnings.push(`ligne ${r + 1} : latéralité « ${rawLat} » non reconnue`)

    // La latéralité vit sur l'instrument batterie (sémantique
    // inversion de kit). Si la personne a une latéralité renseignée
    // mais pas de batterie, on la warn — l'info n'a pas de porteuse.
    if (lateralite) {
      const insBatterie = instruments.find((i) => i.pupitre === 'batterie')
      if (insBatterie) {
        insBatterie.lateralite = lateralite
      } else {
        warnings.push(
          `ligne ${r + 1} (${brut}) : latéralité « ${lateralite} » ignorée — pas d'instrument batterie déclaré`,
        )
      }
    }

    const indispos: Indispo[] = []
    if (iIndispos !== undefined) {
      const brutInd = texte(row[iIndispos])
      if (brutInd) {
        // Plusieurs indispos séparées par ; ou saut de ligne
        for (const chunk of brutInd.split(/[;\n]+/).map((s) => s.trim()).filter(Boolean)) {
          const ind = parserIndispoLibre(chunk)
          if (ind) indispos.push(ind)
        }
      }
    }

    personnes.push({
      id,
      nom,
      discriminant,
      instruments,
      role: 'musicien',
      indispos,
    })
  }

  return { personnes, warnings }
}
