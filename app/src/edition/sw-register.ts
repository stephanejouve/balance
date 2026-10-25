/**
 * Enregistre le service worker + expose un événement `nouvelle-version`
 * quand un nouveau SW est installé et attend d'être activé.
 *
 * Marche uniquement sur `http(s)://` — sur `file://` navigator.serviceWorker
 * est undefined ou l'API refuse silencieusement. Dans ce cas, `enregistrer`
 * est un no-op et l'app compte sur le fallback fetch manuel
 * (`src/edition/mise-a-jour.ts`).
 */

export type OnNouvelleVersion = () => void

export async function enregistrer(
  onNouvelleVersion: OnNouvelleVersion,
  cheminSW: string = './sw.js',
): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return null
  }
  try {
    const reg = await navigator.serviceWorker.register(cheminSW)
    // Un SW déjà en attente ⇒ nouvelle version prête tout de suite.
    if (reg.waiting) {
      onNouvelleVersion()
    }
    reg.addEventListener('updatefound', () => {
      const nouveau = reg.installing
      if (!nouveau) return
      nouveau.addEventListener('statechange', () => {
        // 'installed' avec un controller existant ⇒ le SW attend l'activation
        // (donc c'est une mise à jour, pas la 1ʳᵉ install).
        if (nouveau.state === 'installed' && navigator.serviceWorker.controller) {
          onNouvelleVersion()
        }
      })
    })
    return reg
  } catch {
    return null
  }
}

/**
 * Issue de `preparerRechargement` :
 * - `pret`  : recharger servira la nouvelle version ;
 * - `delai` : le nouveau SW n'a pas pris la main dans le délai. Il peut
 *   encore la prendre : l'appelant garde l'écoute de `controllerchange`
 *   (#216, mesuré en production à 30 s pour un délai de 15 s) ;
 * - `echec` : `update()` a levé, la vérification n'a pas eu lieu.
 */
export type IssueRechargement = 'pret' | 'delai' | 'echec'

/**
 * #205 : avant de recharger, s'assurer que le rechargement servira bien la
 * nouvelle version. La navigation passe par le cache du SW : un clic fait
 * pendant que le nouveau SW s'installe ressert l'ancienne version, et le
 * bandeau revient (review Leader). On demande donc la mise à jour, puis on
 * attend que le nouveau SW prenne le contrôle (`skipWaiting` +
 * `clients.claim` émettent `controllerchange`).
 *
 * `pret` quand recharger servira la nouvelle version : pas de SW (le
 * document est revalidé au réseau), aucun SW en cours d'installation, ou
 * nouveau SW aux commandes. `echec` si la mise à jour lève, `delai` si la
 * séquence entière, update() compris, dépasse le délai. Dans ces deux cas
 * l'appelant ne doit pas recharger tout de suite.
 */
export async function preparerRechargement(
  sw: ServiceWorkerContainer | undefined = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
  delaiMs: number = 15000,
): Promise<IssueRechargement> {
  if (!sw) return 'pret'
  // Un seul délai pour toute la séquence, update() compris : sur un réseau
  // qui ne répond plus, le fetch de sw.js peut pendre bien au-delà de 15 s,
  // et le bouton resterait « Installation… » (review Leader #209).
  let minuteur: ReturnType<typeof setTimeout> | undefined
  let prise: (() => void) | undefined
  const delai = new Promise<IssueRechargement>((resolve) => {
    minuteur = setTimeout(() => resolve('delai'), delaiMs)
  })
  const attente = (async (): Promise<IssueRechargement> => {
    const reg = await sw.getRegistration()
    if (!reg) return 'pret'
    try {
      await reg.update()
    } catch {
      return 'echec'
    }
    if (!reg.installing && !reg.waiting) return 'pret'
    return new Promise<IssueRechargement>((resolve) => {
      prise = () => resolve('pret')
      sw.addEventListener('controllerchange', prise, { once: true })
    })
  })()
  try {
    return await Promise.race([attente, delai])
  } finally {
    clearTimeout(minuteur)
    if (prise) sw.removeEventListener('controllerchange', prise)
  }
}
