import { z } from 'zod'

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
})
export type LegacyGroupe = z.infer<typeof LegacyGroupe>

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
export type LegacyInscriptions = z.infer<typeof LegacyInscriptions>

export function parseLegacyInscriptions(raw: unknown): LegacyInscriptions {
  return LegacyInscriptions.parse(raw)
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
