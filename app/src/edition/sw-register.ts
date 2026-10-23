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
 * #205 : avant de recharger, s'assurer que le rechargement servira bien la
 * nouvelle version. La navigation passe par le cache du SW : un clic fait
 * pendant que le nouveau SW s'installe ressert l'ancienne version, et le
 * bandeau revient (review Leader). On demande donc la mise à jour, puis on
 * attend que le nouveau SW prenne le contrôle (`skipWaiting` +
 * `clients.claim` émettent `controllerchange`).
 *
 * Retourne `true` quand recharger servira la nouvelle version : pas de SW
 * (le document est revalidé au réseau), aucun SW en cours d'installation,
 * ou nouveau SW aux commandes. Retourne `false` si la mise à jour échoue
 * ou n'aboutit pas dans le délai : l'appelant ne doit pas recharger.
 */
export async function preparerRechargement(
  sw: ServiceWorkerContainer | undefined = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined,
  delaiMs: number = 15000,
): Promise<boolean> {
  if (!sw) return true
  const reg = await sw.getRegistration()
  if (!reg) return true
  try {
    await reg.update()
  } catch {
    return false
  }
  if (!reg.installing && !reg.waiting) return true
  return new Promise((resolve) => {
    const prise = () => {
      clearTimeout(minuteur)
      resolve(true)
    }
    const minuteur = setTimeout(() => {
      sw.removeEventListener('controllerchange', prise)
      resolve(false)
    }, delaiMs)
    sw.addEventListener('controllerchange', prise, { once: true })
  })
}
