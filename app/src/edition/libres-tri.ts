/**
 * Vues utilitaires pour la sous-section « Classes par pupitre » de
 * l'Étape 1a — l'intervenant de chaque pupitre voit ses stagiaires
 * triés par engagement croissant, pour repérer ceux qui n'ont pas
 * encore su/senti s'engager sur un morceau.
 */

import type { Inscriptions, Personne } from '../domain/model'

export interface StagiaireDuPupitre {
  personne: Personne
  nb_groupes: number
}

export function comptageGroupes(inscriptions: Inscriptions): Map<string, number> {
  const m = new Map<string, number>()
  for (const g of inscriptions.groupes) {
    for (const mem of g.membres) {
      m.set(mem.personne_id, (m.get(mem.personne_id) ?? 0) + 1)
    }
  }
  return m
}

/**
 * Retourne tous les stagiaires ayant ce pupitre (principal ou
 * additionnel), triés par engagement croissant (nb de groupes) puis
 * alphabétiquement pour engagement égal.
 */
export function classePourPupitre(
  pupitre: string,
  inscriptions: Inscriptions,
): StagiaireDuPupitre[] {
  const nbGroupesParPid = comptageGroupes(inscriptions)
  return inscriptions.personnes
    .filter((p) => p.instruments.some((i) => i.pupitre === pupitre))
    .map((p) => ({
      personne: p,
      nb_groupes: nbGroupesParPid.get(p.id) ?? 0,
    }))
    .sort((a, b) => {
      if (a.nb_groupes !== b.nb_groupes) return a.nb_groupes - b.nb_groupes
      return a.personne.nom.localeCompare(b.personne.nom, 'fr')
    })
}
