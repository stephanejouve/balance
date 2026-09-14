import type { IsoDate } from './model'

/**
 * Parse un paramètre URL `?maintenant=YYYY-MM-DD[THH:MM]` en `Date` locale.
 *
 * Utilisé à l'initialisation d'App.svelte pour figer le présent que le
 * filtre `genererCreneaux(..., { maintenant })` consomme (CD msg 6777).
 *
 * Contrat :
 * - Format `YYYY-MM-DD` accepté (heure par défaut midi local, pour éviter
 *   les frontières matin/soir).
 * - Format `YYYY-MM-DDTHH:MM` accepté (heure explicite).
 * - Toute chaîne non parseable ou date invalide retourne `null` — le
 *   caller retombera sur `new Date()`.
 * - Fonction pure : accepte la chaîne brute (ou null/undefined),
 *   n'accède pas à `window`.
 */
export function parseMaintenantUrlParam(raw: string | null | undefined): Date | null {
  if (raw == null) return null
  const trimmed = raw.trim()
  // Format strict : `YYYY-MM-DD` ou `YYYY-MM-DDTHH:MM`. Le regex écarte
  // les chaînes que `new Date(...)` accepterait avec des règles surprises
  // (rollover mensuel, année seule qui devient 1er janvier, etc.).
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/)
  if (!match) return null
  const [, yStr, mStr, dStr, hStr, minStr] = match
  const y = Number(yStr)
  const mo = Number(mStr)
  const d = Number(dStr)
  const h = hStr !== undefined ? Number(hStr) : 12
  const min = minStr !== undefined ? Number(minStr) : 0
  const parsed = new Date(y, mo - 1, d, h, min)
  // Re-vérifie que les composants n'ont pas fait de rollover
  // (`2026-02-30` deviendrait `2026-03-02` silencieusement dans le
  // constructeur — on refuse pour ne pas laisser passer un faux présent).
  if (
    parsed.getFullYear() !== y ||
    parsed.getMonth() !== mo - 1 ||
    parsed.getDate() !== d ||
    parsed.getHours() !== h ||
    parsed.getMinutes() !== min
  ) {
    return null
  }
  return parsed
}

/**
 * Calcule le lendemain / la veille d'une date ISO en date-only (pas d'heure).
 * Utilise `Date.UTC` pour éviter les décalages de fuseau qui feraient sauter
 * un jour selon la timezone locale (aligné sur `joursDeSession` grille.ts).
 */
function offsetIso(iso: IsoDate, deltaJours: number): IsoDate {
  const [y, m, d] = iso.split('-').map(Number)
  const t = Date.UTC(y, m - 1, d) + deltaJours * 86_400_000
  const dv = new Date(t)
  return `${dv.getUTCFullYear()}-${String(dv.getUTCMonth() + 1).padStart(2, '0')}-${String(dv.getUTCDate()).padStart(2, '0')}` as IsoDate
}

/**
 * Détermine si une session chargée a ses dates entièrement passées et,
 * dans ce cas, propose une date de « rejeu » qui permet de re-simuler la
 * session complète.
 *
 * Contrat :
 *  - Retourne `null` si `dateFin >= aujourdhuiIso` — la session est en
 *    cours ou future, aucun rejeu à proposer. Le seuil inclut le jour
 *    même de fin (une session qui finit aujourd'hui reste rejouable en
 *    temps réel).
 *  - Retourne `{ dateFin, dateProposee }` sinon, où `dateProposee` est la
 *    veille de `dateDebut` — choisie pour que le filtre `maintenantKey`
 *    de `genererCreneaux` conserve TOUS les créneaux (le premier créneau
 *    du 1ᵉʳ jour tombe strictement après la veille à midi).
 *
 * Fonction pure, testable sans window ni Date.now(). Le caller est
 * responsable de composer `aujourdhuiIso` à partir de `new Date()` réelle
 * (pas de `maintenantFixe` — sinon proposition circulaire quand un
 * paramètre URL est déjà présent).
 *
 * Cadrage CD msg 6833 (2026-09-14). Le déclenchement est calculé au
 * chargement de la session ; le clic effectif reste à Stéphane.
 */
export function propositionRejouer(
  dateDebut: IsoDate,
  dateFin: IsoDate,
  aujourdhuiIso: IsoDate,
): { dateFin: IsoDate; dateProposee: IsoDate } | null {
  if (dateFin >= aujourdhuiIso) return null
  return { dateFin, dateProposee: offsetIso(dateDebut, -1) }
}
