import { detacherNomInstrument } from '../domain/legacy'
import type { LegacyGroupe } from '../domain/legacy'
import type { PosteCherche, Pupitre, RoleChant } from '../domain/model'

/**
 * Adapter du classeur Excel de l'association vers le format `LegacyGroupe`.
 * Prend un tableau 2D (rows × cols) déjà extrait d'un onglet Excel — la
 * lecture xlsx est traitée à part dans `excel-io.ts`.
 *
 * Structure attendue (par convention terrain, cf. brief §6/§11) :
 *   - 1 ligne d'en-tête (nom de colonnes)
 *   - 1 ligne par morceau
 *   - Colonnes usuelles : morceau, auteur, style, tonalité, responsable
 *   - Colonnes pupitres (chant, piano, basse, batterie, guitare, vents)
 *   - Cellules pupitre : `CHERCHE` = poste à pourvoir, `NON` = pas ce
 *     pupitre, sinon noms séparés par virgules, instrument entre
 *     parenthèses : `Colette (contrebasse)`
 *
 * Le mapping colonnes est fourni explicitement — pas de deviner-magique
 * pour éviter les silences. Un `MappingListe` peut être écrit une fois
 * pour un modèle de classeur, puis réutilisé.
 */

export interface MappingListe {
  /** Index de la ligne d'en-tête dans les rows (0-based). Défaut : 0. */
  ligneEnTete?: number
  /** Nom exact de la colonne du titre (ex. `Morceau`, `Titre`). */
  colonneMorceau: string
  colonneAuteur?: string
  colonneStyle?: string
  colonneTona?: string
  colonneResp?: string
  /** Colonne globale « Cherche » si l'asso l'utilise à la place de `CHERCHE` dans les cellules pupitre. */
  colonneCherche?: string
  /** Mapping pupitre → nom de colonne dans le classeur. */
  colonnesPupitres: Partial<Record<Pupitre, string>>
}

/**
 * Mapping par défaut aligné sur la convention Musiques Festives.
 * Descendu depuis `App.svelte` en 2026-08-27 (brief import unique § « prérequis
 * du classeur modèle ») pour que le générateur de modèle vive à la même source
 * que l'importeur — un renommage de colonne dans un lieu ne peut plus
 * désynchroniser le modèle qu'on distribue.
 */
export const MAPPING_LISTE_DEFAUT: MappingListe = {
  colonneMorceau: 'Morceau',
  colonneAuteur: 'Auteur',
  colonneStyle: 'Style',
  colonneTona: 'Tona',
  colonneResp: 'Resp',
  colonneCherche: 'Cherche',
  colonnesPupitres: {
    chant: 'Chant',
    piano: 'Piano',
    basse: 'Basse',
    batterie: 'Batterie',
    guitare: 'Guitare',
    vents: 'Vents',
  },
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

function normaliserSeparateur(cellule: string): string[] {
  // séparateurs tolérés : virgule, point-virgule, retour à la ligne
  return cellule
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Rôles vocaux reconnus par le parseur de CHERCHE et de double parenthèse
 * membre. Miroir de `RoleChant` dans `domain/model.ts`. La reconnaissance
 * tolère les variantes orthographiques courantes (« chœurs », « choeurs »,
 * « choeur », « chœur ») mais l'output canonique est toujours l'un des 2
 * membres de `RoleChant`.
 */
const ROLES_CHANT_RECONNUS: Record<string, RoleChant> = {
  lead: 'lead',
  chœurs: 'choeurs',
  choeurs: 'choeurs',
  chœur: 'choeurs',
  choeur: 'choeurs',
}

/**
 * Parseur d'une cellule pupitre du type `CHERCHE N role?`. Retourne
 * `PosteCherche` typé si la cellule commence par CHERCHE, `null` sinon.
 *
 * Formes acceptées (case insensitive sur CHERCHE) :
 *   - `CHERCHE`             → { pupitre, nb: 1 }
 *   - `CHERCHE 3`           → { pupitre, nb: 3 }
 *   - `CHERCHE lead`        → { pupitre, nb: 1, role: 'lead' }
 *   - `CHERCHE 2 chœurs`    → { pupitre, nb: 2, role: 'choeurs' }
 *   - `CHERCHE chœurs 2`    → { pupitre, nb: 2, role: 'choeurs' } (ordre libre)
 *
 * Le rôle est retenu quel que soit le pupitre (pas de validation « role
 * seulement sur chant » — un jour un lead solo guitare peut avoir du sens,
 * spec Stéphane 2026-09-04). Le solveur applique la sémantique lead≠choeurs
 * uniquement sur les membres chant.
 */
function parseCherche(cellule: string, pupitre: Pupitre): PosteCherche | null {
  const upper = cellule.toUpperCase()
  if (upper !== 'CHERCHE' && !upper.startsWith('CHERCHE ') && !upper.startsWith('CHERCHE(')) {
    return null
  }
  // Retire le mot CHERCHE en tête, garde le reste (avec ponctuation tolérée)
  const reste = cellule.replace(/^CHERCHE\s*[(]?\s*/i, '').replace(/\)$/, '').trim()
  if (!reste) return { pupitre, nb: 1 }

  // Sépare les tokens : nombres, mots
  const tokens = reste.split(/[\s,]+/).filter(Boolean)
  let nb = 1
  let role: RoleChant | undefined
  for (const t of tokens) {
    const n = parseInt(t, 10)
    if (!isNaN(n) && n > 0) {
      nb = n
      continue
    }
    const roleFound = ROLES_CHANT_RECONNUS[t.toLowerCase()]
    if (roleFound) role = roleFound
    // Autres tokens ignorés (pas de warning bloquant — le rôle inconnu
    // dégrade en « pas de rôle » plutôt que rejeter le CHERCHE entier)
  }
  return { pupitre, nb, role }
}

/**
 * Parseur d'un membre avec double parenthèse : `Nom (Discriminant) (role)`.
 * Retourne le nom (avec discriminant conservé) et le rôle si détecté.
 *
 * Règle Stéphane 2026-09-04 (brief CHERCHE quantifié) : la parenthèse
 * finale est un rôle SI elle figure dans la liste connue (lead, chœurs),
 * SINON elle fait partie du nom. Cette règle évite le piège
 * `Pierre (SIG) (batterie)` où « (batterie) » avait fait fusionner les
 * homonymes (parseur pré-Sujet A). Ici « batterie » n'est pas un rôle
 * vocal reconnu → traité comme partie du nom (délégué à `decomposer`).
 *
 * Simple parenthèse `Nom (Discriminant)` : pas de rôle, comportement
 * inchangé, nom retourné tel quel.
 */
function parseMembreAvecRole(brut: string): { nom: string; role?: RoleChant } {
  const trimmed = brut.trim()
  // Cherche la parenthèse la plus à droite fermant à la fin
  const match = trimmed.match(/^(.+)\s*\(([^()]+)\)\s*$/)
  if (!match) return { nom: trimmed }
  const [, avant, dernierePar] = match
  const roleFound = ROLES_CHANT_RECONNUS[dernierePar.trim().toLowerCase()]
  if (roleFound) {
    return { nom: avant.trim(), role: roleFound }
  }
  // Pas un rôle reconnu → parenthèse fait partie du nom (discriminant ou
  // instrument, cf. règle Stéphane). Rendu inchangé.
  return { nom: trimmed }
}

export interface ExtractionListe {
  groupes: LegacyGroupe[]
  /** Avertissements non bloquants (colonne manquante, cellule ignorée…). */
  warnings: string[]
}

export function extraireListe(rows: Cellule[][], mapping: MappingListe): ExtractionListe {
  const warnings: string[] = []
  const ligneEnTete = mapping.ligneEnTete ?? 0
  if (rows.length <= ligneEnTete) {
    return { groupes: [], warnings: [`classeur vide (${rows.length} lignes, en-tête ligne ${ligneEnTete})`] }
  }
  const cols = indexerColonnes(rows[ligneEnTete])

  const cIdx = (name: string | undefined): number | undefined =>
    name ? cols.get(name) : undefined

  const iMorceau = cIdx(mapping.colonneMorceau)
  if (iMorceau === undefined) {
    return { groupes: [], warnings: [`colonne « ${mapping.colonneMorceau} » introuvable`] }
  }
  const iAuteur = cIdx(mapping.colonneAuteur)
  const iStyle = cIdx(mapping.colonneStyle)
  const iTona = cIdx(mapping.colonneTona)
  const iResp = cIdx(mapping.colonneResp)
  const iCherche = cIdx(mapping.colonneCherche)

  const pupitresIdx: Array<[Pupitre, number]> = []
  for (const [pup, colName] of Object.entries(mapping.colonnesPupitres) as Array<[Pupitre, string]>) {
    const i = cols.get(colName)
    if (i === undefined) warnings.push(`colonne pupitre « ${colName} » introuvable`)
    else pupitresIdx.push([pup, i])
  }

  const groupes: LegacyGroupe[] = []
  for (let r = ligneEnTete + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue
    const titre = texte(row[iMorceau])
    if (!titre) continue // ligne vide

    const membres: string[] = []
    /**
     * `postes_cherches` typés produits par ce parseur — remplace le
     * comptage naïf par répétition du pupitre dans `cherche` string.
     * Compteur agrégé par pupitre (une case `CHERCHE 3` sur vents et
     * une case `CHERCHE 2` sur vents dans la même colonne devraient être
     * additionnées, cas rare mais à ne pas silencer). Le champ `cherche`
     * string est conservé pour rétro-compat avec les producteurs qui ne
     * migreraient pas immédiatement — migrate.ts préfère `postes_cherches`
     * si présent.
     */
    const postesCherches: PosteCherche[] = []
    const cherchePupitres: string[] = []
    for (const [pup, i] of pupitresIdx) {
      const raw = texte(row[i])
      if (!raw) continue
      const upper = raw.toUpperCase()
      if (upper === 'NON') continue
      const posteCherche = parseCherche(raw, pup)
      if (posteCherche) {
        postesCherches.push(posteCherche)
        // Rétro-compat : on garde aussi l'ancienne string (répétée nb fois
        // pour préserver le comptage 1-par-1 que attend `extrairePostesCherchesString`
        // si ce producteur est un jour ignoré).
        for (let k = 0; k < posteCherche.nb; k++) cherchePupitres.push(pup)
        continue
      }
      for (const brut of normaliserSeparateur(raw)) {
        // Double parenthèse (rôle vocal) : détecté AVANT `detacherNomInstrument`
        // — un `Nom (Discriminant) (lead)` doit rester intact au niveau nom,
        // le rôle est extrait pour être posé sur `MembreGroupe.role` en aval.
        // On ré-encode le rôle dans la string via un séparateur non ambigu
        // pour que `migrate.ts::decomposer` puisse le récupérer sans casser
        // le pattern historique. Format : « Nom (Disc)§role§lead » (marker §
        // absent des saisies utilisateur).
        const { nom, role } = parseMembreAvecRole(brut)
        const nomAvecPupitre = (() => {
          const { instrument } = detacherNomInstrument(nom)
          return instrument ? nom : `${nom} (${pup})`
        })()
        const membreEncoded = role ? `${nomAvecPupitre}§role§${role}` : nomAvecPupitre
        membres.push(membreEncoded)
      }
    }

    const chercheLibre = iCherche !== undefined ? texte(row[iCherche]) : ''
    const chercheGlobal = chercheLibre ? normaliserSeparateur(chercheLibre) : []
    const cherche = [...cherchePupitres, ...chercheGlobal].join(', ')

    const auteur = iAuteur !== undefined ? texte(row[iAuteur]) : ''
    const m1 = auteur ? `${titre} / ${auteur}` : titre

    groupes.push({
      nom: titre,
      m1,
      m2: '',
      style: iStyle !== undefined ? texte(row[iStyle]) : '',
      ton: iTona !== undefined ? texte(row[iTona]) : '',
      resp: iResp !== undefined ? texte(row[iResp]) : '',
      membres,
      cherche,
      postes_cherches: postesCherches.length > 0 ? postesCherches : undefined,
    })
  }

  return { groupes, warnings }
}
