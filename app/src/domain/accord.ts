/**
 * Accord d'un nom, ou d'un groupe nom + adjectif, avec un nombre (#202).
 *
 * Convention tranchée par #196 et vérifiée à l'écran : singulier à 0 et à 1,
 * pluriel au-delà — « 0 musicien », « 1 groupe », « 12 groupes ».
 *
 * Pour une fraction affichée « x/y », l'accord suit le total `y` : c'est lui
 * qui dit combien de groupes l'écran évoque (« 0/1 groupe complet »,
 * « 1/13 groupes complets »).
 */
export function accord(n: number, singulier: string, pluriel = `${singulier}s`): string {
  return n > 1 ? pluriel : singulier
}
