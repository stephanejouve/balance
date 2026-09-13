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
