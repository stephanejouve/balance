import { z } from 'zod'
import type { PosteCherche } from './model'

/**
 * Format historique produit par le prototype `repartiteur_repetitions.html`.
 * Utilisé comme point d'entrée pour la migration : on lit le format existant
 * puis on convertit vers le modèle interne (à venir).
 *
 * Cf. `apero_mercredi.json` — session 5.
 */

export const LegacyGroupe = z.object({
  nom: z.string(),
  resp: z.string().default(''),
  ton: z.string().default(''),
  style: z.string().default(''),
  m1: z.string().default(''),
  m2: z.string().default(''),
  membres: z.array(z.string()).default([]),
  cherche: z.string().default(''),
  /**
   * Nouveau champ (2026-09-04, brief CHERCHE quantifié) : postes à
   * pourvoir avec quantité + rôle vocal facultatif. Rempli par le parseur
   * Excel (liste-adapter). Absent = producteur ancien qui n'a que
   * `cherche` string ; migrate.ts fait alors le fallback via parsing de
   * la string. Non parsé par Zod parse (utilisé via `z.unknown()` pour
   * éviter la dépendance forte entre schemas Legacy et canonique) — les
   * consommateurs le type-narrow via l'export type ci-dessous.
   */
  postes_cherches: z.array(z.unknown()).optional(),
})
export type LegacyGroupe = Omit<z.infer<typeof LegacyGroupe>, 'postes_cherches'> & {
  postes_cherches?: PosteCherche[]
}

export const LegacyIndispo = z.object({
  noms: z.array(z.string()),
  heures: z.array(z.string()),
  roles: z.array(z.string()).optional(),
  motif: z.string().default(''),
})
export type LegacyIndispo = z.infer<typeof LegacyIndispo>

export const LegacyInscriptions = z.object({
  groupes: z.array(LegacyGroupe),
  membresImposes: z.record(z.string(), z.array(z.string())).default({}),
  indispos: z.array(LegacyIndispo).default([]),
  identitesConnues: z.array(z.string()).default([]),
})
export type LegacyInscriptions = Omit<z.infer<typeof LegacyInscriptions>, 'groupes'> & {
  groupes: LegacyGroupe[]
}

export function parseLegacyInscriptions(raw: unknown): LegacyInscriptions {
  // Cast : le schema Zod produit `postes_cherches: unknown[]` (voir docstring
  // LegacyGroupe), le type exposé le narrow en `PosteCherche[]`. Les consommateurs
  // ne consomment ce champ que s'il est présent (fallback vers `cherche` string
  // sinon), donc le risque de type mismatch est cantonné à ce boundary.
  return LegacyInscriptions.parse(raw) as unknown as LegacyInscriptions
}

/**
 * Détache le nom et l'instrument d'une entrée membre du prototype.
 * Convention : le dernier segment entre parenthèses est un instrument si
 * il matche la liste connue, sinon il fait partie du nom (ex: `Pierre (SIG)`,
 * `Emmanuelle (B)` = distinguent des homonymes, pas des instruments).
 *
 * Port fidèle de `detache()` du prototype (repartiteur_repetitions.html).
 */
const INSTRUMENT_RE =
  /^(chant|voix|choeur|ch(oe|œ)ur|piano|clavier|orgue|basse|contrebasse|batterie|percussion|cajon|guitare|banjo|ukul|mandoline|vents?|sax|saxo|clarinette|fl(û|u)te|trompette|trombone|bugle|cor|tuba|harmonica|accord(é|e)on|violon|violoncelle|alto|harpe)/i

export interface NomInstrument {
  nom: string
  instrument: string
}

export function detacherNomInstrument(entree: string): NomInstrument {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ')
  const m = entree.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  if (m && INSTRUMENT_RE.test(norm(m[2]))) {
    return { nom: norm(m[1]), instrument: norm(m[2]) }
  }
  return { nom: norm(entree), instrument: '' }
}
