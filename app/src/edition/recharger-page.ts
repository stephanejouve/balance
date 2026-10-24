/**
 * Recharge l'onglet. Isolé pour que les tests du bandeau puissent observer
 * le rechargement : jsdom ne laisse pas espionner `location.reload` (#216).
 */
export function rechargerPage(): void {
  window.location.reload()
}
