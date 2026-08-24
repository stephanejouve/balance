import { detacherNomInstrument } from '../domain/legacy'
import type { LegacyGroupe } from '../domain/legacy'
import type { Pupitre } from '../domain/model'

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
    const cherchePupitres: string[] = []
    for (const [pup, i] of pupitresIdx) {
      const raw = texte(row[i])
      if (!raw) continue
      const upper = raw.toUpperCase()
      if (upper === 'NON') continue
      if (upper === 'CHERCHE' || upper.startsWith('CHERCHE ') || upper.startsWith('CHERCHE(')) {
        cherchePupitres.push(pup)
        continue
      }
      for (const nom of normaliserSeparateur(raw)) {
        // Distingue instrument reconnu (à conserver tel quel) d'un
        // discriminant type `Pierre (SIG)` (à compléter par le pupitre).
        const { instrument } = detacherNomInstrument(nom)
        membres.push(instrument ? nom : `${nom} (${pup})`)
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
    })
  }

  return { groupes, warnings }
}
