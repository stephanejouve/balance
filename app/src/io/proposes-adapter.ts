import { detacherNomInstrument } from '../domain/legacy'
import type { Impose, Personne, Seance } from '../domain/model'
import { slug } from '../domain/model'

/**
 * Adapter du classeur Excel de l'association — onglet `Proposés` —
 * vers le modèle canonique `Impose[]` (morceaux proposés par l'intervenant
 * pour le concert du vendredi).
 *
 * Convention terrain :
 *   - une ligne par séance
 *   - colonne `Morceau` obligatoire (titre) ; plusieurs lignes avec le
 *     même titre se regroupent en un seul `Impose` (mêmes membres)
 *   - colonne `Membres` obligatoire : noms séparés par virgules — même
 *     format que l'onglet `Liste` (discriminants `(B)`, instruments
 *     entre parenthèses `Colette (contrebasse)`)
 *   - colonnes `Date` (AAAA-MM-JJ), `Début` (HH:MM), `Fin` (HH:MM)
 *     obligatoires
 *   - colonne `Salle` facultative (nom informatif)
 *
 * Les membres sont résolus contre `personnesConnues` (matching par slug
 * du nom + discriminant). Un membre inconnu produit un warning et est
 * ignoré — l'utilisateur doit d'abord importer l'onglet `Stagiaires`
 * ou `Liste` pour peupler le référentiel de personnes.
 */

export interface MappingProposes {
  ligneEnTete?: number
  colonneMorceau: string
  colonneMembres: string
  colonneDate: string
  colonneDebut: string
  colonneFin: string
  colonneSalle?: string
}

export const MAPPING_PROPOSES_DEFAUT: MappingProposes = {
  ligneEnTete: 0,
  colonneMorceau: 'Morceau',
  colonneMembres: 'Membres',
  colonneDate: 'Date',
  colonneDebut: 'Début',
  colonneFin: 'Fin',
  colonneSalle: 'Salle',
}

type Cellule = unknown

function texte(c: Cellule): string {
  if (c == null) return ''
  if (typeof c === 'string') return c.trim()
  if (c instanceof Date) {
    // Excel renvoie parfois un Date pour les colonnes date/heure
    const y = c.getUTCFullYear()
    const m = String(c.getUTCMonth() + 1).padStart(2, '0')
    const d = String(c.getUTCDate()).padStart(2, '0')
    const hh = String(c.getUTCHours()).padStart(2, '0')
    const mm = String(c.getUTCMinutes()).padStart(2, '0')
    // Heuristique : minuit UTC → suppose date pure ; sinon date-heure
    if (hh === '00' && mm === '00') return `${y}-${m}-${d}`
    return `${hh}:${mm}`
  }
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

/** Normalise une date au format ISO AAAA-MM-JJ. Accepte AAAA-MM-JJ,
 *  JJ/MM/AAAA, JJ-MM-AAAA. Renvoie la chaîne brute si non reconnue. */
export function normaliserDate(brut: string): string {
  const t = brut.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t
  const fr = t.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (fr) {
    const j = fr[1].padStart(2, '0')
    const m = fr[2].padStart(2, '0')
    return `${fr[3]}-${m}-${j}`
  }
  return t
}

/** Normalise une heure au format HH:MM. Accepte HH:MM, HHhMM, HHh, H:MM. */
export function normaliserHeure(brut: string): string {
  const t = brut.trim()
  if (/^\d{2}:\d{2}$/.test(t)) return t
  const m = t.match(/^(\d{1,2})[h:.]?(\d{0,2})$/)
  if (!m) return t
  const hh = String(parseInt(m[1], 10)).padStart(2, '0')
  const mm = m[2] ? String(parseInt(m[2], 10)).padStart(2, '0') : '00'
  return `${hh}:${mm}`
}

function idPersonne(nom: string, discriminant: string): string {
  return slug(discriminant ? `${nom} ${discriminant}` : nom)
}

/** Extrait un nom + discriminant d'une chaîne type `Emma (B)` ou `Karl`. */
function extraireDiscriminant(brut: string): { nom: string; discriminant: string } {
  const m = brut.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (!m) return { nom: brut.trim(), discriminant: '' }
  const contenu = m[2].trim()
  // Un contenu type "(contrebasse)" est un instrument, pas un discriminant.
  // On applique la même règle que liste-adapter via `detacherNomInstrument`.
  const { instrument } = detacherNomInstrument(brut)
  if (instrument) return { nom: brut.trim(), discriminant: '' }
  return { nom: m[1].trim(), discriminant: `(${contenu})` }
}

export interface ExtractionProposes {
  imposes: Impose[]
  warnings: string[]
}

export function extraireProposes(
  rows: Cellule[][],
  mapping: MappingProposes,
  personnesConnues: readonly Personne[],
): ExtractionProposes {
  const warnings: string[] = []
  const ligneEnTete = mapping.ligneEnTete ?? 0
  if (rows.length <= ligneEnTete) {
    return {
      imposes: [],
      warnings: [`classeur vide (${rows.length} lignes, en-tête ligne ${ligneEnTete})`],
    }
  }
  const cols = indexerColonnes(rows[ligneEnTete])
  const requis: Array<[keyof MappingProposes, string]> = [
    ['colonneMorceau', mapping.colonneMorceau],
    ['colonneMembres', mapping.colonneMembres],
    ['colonneDate', mapping.colonneDate],
    ['colonneDebut', mapping.colonneDebut],
    ['colonneFin', mapping.colonneFin],
  ]
  for (const [_, name] of requis) {
    if (cols.get(name) === undefined) {
      return { imposes: [], warnings: [`colonne « ${name} » introuvable`] }
    }
  }
  const iMorceau = cols.get(mapping.colonneMorceau)!
  const iMembres = cols.get(mapping.colonneMembres)!
  const iDate = cols.get(mapping.colonneDate)!
  const iDebut = cols.get(mapping.colonneDebut)!
  const iFin = cols.get(mapping.colonneFin)!
  const iSalle = mapping.colonneSalle ? cols.get(mapping.colonneSalle) : undefined

  // Index des personnes par id résolu (slug de nom + discriminant)
  const idsConnus = new Set(personnesConnues.map((p) => p.id))

  // Fusion par titre morceau — 1 Impose = N séances
  const imposesParTitre = new Map<string, Impose>()

  for (let r = ligneEnTete + 1; r < rows.length; r++) {
    const row = rows[r]
    if (!row) continue
    const titre = texte(row[iMorceau])
    if (!titre) continue

    const date = normaliserDate(texte(row[iDate]))
    const debut = normaliserHeure(texte(row[iDebut]))
    const fin = normaliserHeure(texte(row[iFin]))
    if (!date || !debut || !fin) {
      warnings.push(`ligne ${r + 1} (${titre}) : date/début/fin incomplet — séance ignorée`)
      continue
    }

    const seance: Seance = { date, debut, fin }
    const salle = iSalle !== undefined ? texte(row[iSalle]) : ''
    if (salle) seance.salle_id = salle

    let imp = imposesParTitre.get(titre)
    if (!imp) {
      // Membres : à parser à la 1ʳᵉ occurrence du titre uniquement
      const brutMembres = texte(row[iMembres])
      const noms = brutMembres
        .split(/[,;\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
      const membres: string[] = []
      for (const nom of noms) {
        const { nom: n, discriminant } = extraireDiscriminant(nom)
        const id = idPersonne(n, discriminant)
        if (!idsConnus.has(id)) {
          warnings.push(
            `ligne ${r + 1} (${titre}) : membre « ${nom} » inconnu — importe d'abord l'onglet Liste ou Stagiaires`,
          )
          continue
        }
        membres.push(id)
      }
      imp = {
        id: `propose-${slug(titre)}`,
        morceau: titre,
        membres,
        seances: [],
      }
      imposesParTitre.set(titre, imp)
    }
    imp.seances.push(seance)
  }

  return { imposes: [...imposesParTitre.values()], warnings }
}
