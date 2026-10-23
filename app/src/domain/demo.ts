import type { IsoDate } from './model'

/**
 * Dates de la session de démo, relatives à une référence (#195).
 *
 * Avant : figées au 24-28/08/2026. Passé ces dates, `?demo=apero`
 * affichait « Session terminée — aucun créneau » : l'exemple rempli que le
 * guide promet était inatteignable sans `?maintenant=`, un paramètre
 * qu'aucun visiteur ne connaît.
 *
 * Le jour de la semaine est conservé (lecture Leader) : début le lundi,
 * butoir apéro le MERCREDI (l'échéance s'appelle `apero_mercredi`), fin le
 * vendredi — écarts de 0, 2 et 4 jours, ceux de la démo d'origine.
 *
 * - Sans `?maintenant=` : le lundi suivant, STRICTEMENT après aujourd'hui
 *   (arbitrage CD) : un lundi ouvre la démo de la semaine d'après, pas une
 *   session déjà entamée. La démo est entièrement à venir, et ne se périme plus.
 * - Avec `?maintenant=` : le lundi de SA semaine. `maintenant=2026-08-24T08:00`
 *   ou `2026-08-27T08:00` redonnent exactement la démo d'origine (24-28/08),
 *   donc tous les montages de smoke et de test restent valables.
 */
export function datesSessionDemo(
  reference: Date,
  referenceFixee: boolean,
): { date_debut: IsoDate; date_butoir: IsoDate; date_fin: IsoDate } {
  const jour = new Date(reference.getFullYear(), reference.getMonth(), reference.getDate())
  const depuisLundi = (jour.getDay() + 6) % 7 // lundi = 0 … dimanche = 6
  const decalage = referenceFixee ? -depuisLundi : 7 - depuisLundi
  const lundi = new Date(jour.getFullYear(), jour.getMonth(), jour.getDate() + decalage)
  const iso = (n: number): IsoDate => {
    const d = new Date(lundi.getFullYear(), lundi.getMonth(), lundi.getDate() + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` as IsoDate
  }
  return { date_debut: iso(0), date_butoir: iso(2), date_fin: iso(4) }
}
