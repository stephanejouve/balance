/**
 * Vues utilitaires pour la sous-section « Classes par pupitre » de
 * l'Étape 1a — l'intervenant de chaque pupitre voit ses stagiaires
 * triés par engagement croissant, pour repérer ceux qui n'ont pas
 * encore su/senti s'engager sur un morceau (volontaire OU imposé).
 *
 * La définition de « engagement » vit dans `domain/engagement.ts` —
 * inclut à la fois groupes volontaires et morceaux imposés (fix
 * CD 7057 point 2). Le champ historique `nb_groupes` a été renommé
 * `nb_engagements` pour refléter la sémantique corrigée.
 */

import { comptageEngagements } from '../domain/engagement'
import type { Inscriptions, Personne } from '../domain/model'

export interface StagiaireDuPupitre {
  personne: Personne
  nb_engagements: number
}

/**
 * Retourne tous les stagiaires ayant ce pupitre (principal ou
 * additionnel), triés par engagement croissant (nb total groupes +
 * imposés) puis alphabétiquement pour engagement égal.
 */
export function classePourPupitre(
  pupitre: string,
  inscriptions: Inscriptions,
): StagiaireDuPupitre[] {
  const nbEngagementsParPid = comptageEngagements(inscriptions)
  return inscriptions.personnes
    .filter((p) => p.instruments.some((i) => i.pupitre === pupitre))
    .map((p) => ({
      personne: p,
      nb_engagements: nbEngagementsParPid.get(p.id) ?? 0,
    }))
    .sort((a, b) => {
      // (1) engagement croissant, (2) nom alpha français, (3) id (tie-break
      // absolu — verrouille le déterminisme pour tests futurs, nit P3 #4
      // review Leader PR #20).
      if (a.nb_engagements !== b.nb_engagements) return a.nb_engagements - b.nb_engagements
      const parNom = a.personne.nom.localeCompare(b.personne.nom, 'fr')
      if (parNom !== 0) return parNom
      return a.personne.id.localeCompare(b.personne.id)
    })
}
