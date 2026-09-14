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
  /**
   * Colonne « Durée (min) » — cap durée (CD 6902+6904). Facultative :
   * l'organisateur remplit Fin OU Durée (ou les deux). Si les deux sont
   * renseignées et cohérentes (`fin − debut = duree`), pas d'alarme.
   * Si divergentes, la durée l'emporte (canonique post-cap, CD 6885).
   */
  colonneDuree?: string
  colonneSalle?: string
}

export const MAPPING_PROPOSES_DEFAUT: MappingProposes = {
  ligneEnTete: 0,
  colonneMorceau: 'Morceau',
  colonneMembres: 'Membres',
  colonneDate: 'Date',
  colonneDebut: 'Début',
  colonneFin: 'Fin',
  colonneDuree: 'Durée (min)',
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

/**
 * Parse un entier strict (durée en minutes). Renvoie `undefined` si la
 * valeur n'est pas un entier positif ou nul. Tolère les espaces autour.
 */
function parseIntStrict(s: string): number | undefined {
  const trimmed = s.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  return Number(trimmed)
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
    // Cap durée : Fin devient facultative si Durée est présente.
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
  const iFin = cols.get(mapping.colonneFin)
  const iDuree = mapping.colonneDuree ? cols.get(mapping.colonneDuree) : undefined
  // Au moins une des deux colonnes Fin / Durée doit être présente.
  if (iFin === undefined && iDuree === undefined) {
    return {
      imposes: [],
      warnings: [
        `colonne « ${mapping.colonneFin} » ou « ${mapping.colonneDuree ?? 'Durée (min)'} » introuvable — au moins une des deux est requise pour délimiter les séances`,
      ],
    }
  }
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
    const finRaw = iFin !== undefined ? texte(row[iFin]) : ''
    const fin = finRaw ? normaliserHeure(finRaw) : undefined
    // Cap durée (CD 6902+6904) : colonne Durée facultative en minutes.
    const dureeRaw = iDuree !== undefined ? texte(row[iDuree]) : ''
    const duree_minutes = dureeRaw ? parseIntStrict(dureeRaw) : undefined

    if (!date || !debut) {
      warnings.push(`ligne ${r + 1} (${titre}) : date/début incomplet — séance ignorée`)
      continue
    }
    if (fin === undefined && duree_minutes === undefined) {
      warnings.push(
        `ligne ${r + 1} (${titre}) : ni Fin ni Durée renseignée — séance ignorée`,
      )
      continue
    }

    // Divergence fin ↔ durée : durée canonique (CD 6885 raison
    // structurelle). Pas d'alarme sur écart d'une minute — le cas
    // fréquent `18:00 → 19:00 + 60` est cohérent avec la formule
    // exclusive `fin − debut = duree` post-#134.
    let finCanonique: string
    if (fin !== undefined && duree_minutes !== undefined) {
      // Les deux présents. Vérif cohérence silencieuse : sinon la
      // durée l'emporte, `fin` recalculée.
      const [dh, dm] = debut.split(':').map(Number)
      const [fh, fm] = fin.split(':').map(Number)
      const dureeCalc = fh * 60 + fm - (dh * 60 + dm)
      if (dureeCalc !== duree_minutes) {
        // Recalcule fin depuis durée pour canoniser (silencieux).
        const finMin = dh * 60 + dm + duree_minutes
        finCanonique = `${String(Math.floor(finMin / 60) % 24).padStart(2, '0')}:${String(finMin % 60).padStart(2, '0')}`
      } else {
        finCanonique = fin
      }
    } else if (fin !== undefined) {
      finCanonique = fin
    } else {
      // Seule la durée est renseignée → dériver la fin.
      const [dh, dm] = debut.split(':').map(Number)
      const finMin = dh * 60 + dm + (duree_minutes as number)
      finCanonique = `${String(Math.floor(finMin / 60) % 24).padStart(2, '0')}:${String(finMin % 60).padStart(2, '0')}`
    }

    const seance: Seance = { date, debut, fin: finCanonique }
    if (duree_minutes !== undefined) seance.duree_minutes = duree_minutes
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
          // Cas 1 : aucun référentiel disponible (session vide + pas d'onglet
          // Liste/Stagiaires dans le classeur — typiquement l'import PDF de
          // Leader qui produit Proposés seul). Warning informatif : la personne
          // n'est pas une erreur de manip, elle est à créer/compléter côté
          // Stagiaires. Cas 2 : référentiel présent mais ce membre spécifique
          // manque — probable erreur d'orthographe côté saisie utilisateur.
          const message =
            idsConnus.size === 0
              ? `ligne ${r + 1} (${titre}) : membre « ${nom} » ne figure pas dans le fichier — à créer ou à compléter côté Stagiaires`
              : `ligne ${r + 1} (${titre}) : membre « ${nom} » non trouvé dans le référentiel de personnes chargées`
          warnings.push(message)
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
