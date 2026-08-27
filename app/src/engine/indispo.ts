import type { Creneau } from '../domain/grille'
import type { Personne, Pupitre } from '../domain/model'

/**
 * Prédicat unifié : est-ce qu'une indisponibilité de la personne bloque
 * ce créneau, pour ces pupitres joués ?
 *
 * Auparavant dupliqué dans 5 modules (solver, verify, renforts, diagnostic,
 * manuel). Factorisé ici pour que la sémantique évolue en un seul endroit —
 * le fix intersection partielle (v0.1.2) aurait dû être appliqué 5 fois
 * sinon.
 *
 * Sémantique par cas :
 *   - `ind.jours` non vide : ne compte que si le créneau tombe un jour ciblé
 *   - `ind.roles` non vide : ne compte que si un des pupitres joués est ciblé
 *   - ni `debut` ni `fin`         → journée entière bloquée
 *   - `debut` seul                → match exact sur début de créneau (compat
 *                                    prototype : les fixtures legacy déclarent
 *                                    chaque tranche horaire concernée)
 *   - `debut` ET `fin`            → plage [debut, fin[ ; bloque si l'intersection
 *                                    avec [c.debut, c.fin[ est non vide (fix
 *                                    du bug d'intersection partielle : 08:30-09:30
 *                                    vs indispo 09:00-11:00 doit bloquer)
 */
export function indispoBloque(
  personne: Personne,
  creneau: Creneau,
  pupitres: Pupitre[],
): boolean {
  return personne.indispos.some((ind) => {
    if (ind.jours.length > 0 && !ind.jours.includes(creneau.date)) return false
    if (ind.roles.length > 0 && !pupitres.some((r) => ind.roles.includes(r))) return false
    if (!ind.debut && !ind.fin) return true
    if (ind.debut && !ind.fin) return creneau.debut === ind.debut
    // Intersection [creneau.debut, creneau.fin[ ∩ [ind.debut, ind.fin[ non vide.
    // Note : les early returns ci-dessus garantissent ind.debut && ind.fin ici.
    return creneau.debut < ind.fin! && ind.debut! < creneau.fin
  })
}
