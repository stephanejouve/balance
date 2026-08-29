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
