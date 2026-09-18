/**
 * Définition unique de « personne engagée dans la programmation ».
 *
 * CD 6990 anomalie 3 / CD 7057 point 2 : une personne citée dans un
 * morceau imposé est engagée au même titre qu'une personne inscrite
 * dans un groupe volontaire — le solveur ne peut pas la déplacer sans
 * casser la programmation. Historiquement (avant ce fix), seuls
 * `inscriptions.groupes` étaient comptés, avec 3 conséquences dans l'UI
 * et le moteur :
 *
 *   1. Pool d'arbitrage effectif (`engine/pool.ts`) : les personnes des
 *      imposés étaient considérées LIBRES → le filtre « candidat pour
 *      combler un poste cherché » les retenait à tort → suppression des
 *      transferts pourtant utiles, pool tombant à zéro sur jeux avec
 *      forte proportion d'imposés (25 postes cherches / 0 propositions
 *      sur le jeu de stress avec concert imposé — CD 7057).
 *   2. En-tête « X personne(s) — dont Y sans engagement » (App.svelte
 *      → Personnes.svelte) : Y sur-évalué.
 *   3. Alerte cohérence `stagiaire_orphelin` (domain/coherence.ts) :
 *      déclenchée sur des personnes qui SONT engagées (dans un imposé).
 *
 * Ce module centralise la définition pour éviter que les 3 sites
 * divergent au fil de leurs évolutions respectives.
 */

import type { Inscriptions } from './model'

/**
 * Compte cumulé d'engagements par personne = (nombre de groupes citant
 * la personne) + (nombre de morceaux imposés citant la personne).
 *
 * Une personne dans 2 groupes ET 1 imposé compte pour 3. Utile pour
 * les vues UI qui trient par engagement croissant (« libres d'abord »).
 *
 * Dédup intra-source : si le même groupe ou impose cite deux fois la
 * même personne (données abîmées), on ne double pas le count pour cette
 * source (Set autour de `membres`).
 */
export function comptageEngagements(inscriptions: Inscriptions): Map<string, number> {
  const m = new Map<string, number>()
  for (const g of inscriptions.groupes) {
    const unique = new Set(g.membres.map((mem) => mem.personne_id))
    for (const pid of unique) m.set(pid, (m.get(pid) ?? 0) + 1)
  }
  for (const imp of inscriptions.imposes) {
    const unique = new Set(imp.membres)
    for (const pid of unique) m.set(pid, (m.get(pid) ?? 0) + 1)
  }
  return m
}

/**
 * Prédicat rapide : la personne est-elle engagée dans au moins un
 * groupe OU un morceau imposé ? Suffit pour les usages où le count
 * exact n'est pas utile (filtres, alertes, badge « libre »).
 */
export function estEngage(personneId: string, inscriptions: Inscriptions): boolean {
  for (const g of inscriptions.groupes) {
    if (g.membres.some((m) => m.personne_id === personneId)) return true
  }
  for (const imp of inscriptions.imposes) {
    if (imp.membres.includes(personneId)) return true
  }
  return false
}
