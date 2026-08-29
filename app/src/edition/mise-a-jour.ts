/**
 * Check-update Balance : détecte si une version plus récente du bundle
 * `balance.html` est publiée sur la vitrine GitHub Pages.
 *
 * Non-négociables :
 * - **Offline-safe** : si `navigator.onLine === false`, aucun fetch, aucun
 *   message d'erreur — l'app fonctionne exactement comme aujourd'hui.
 * - **Non-bloquant** : le check est asynchrone, ne bloque jamais le
 *   démarrage de l'app.
 * - **Dismiss persistant par version** : quand l'user ferme le bandeau
 *   pour une version distante donnée, on ne le ré-affiche pas pour cette
 *   même version. localStorage clé `balance:mise-a-jour:dismissed`.
 */

const URL_MANIFEST = 'https://stephanejouve.github.io/balance/version.json'
const TIMEOUT_FETCH_MS = 3000
const CLE_DISMISS = 'balance:mise-a-jour:dismissed'

export interface Manifest {
  version: string
  built_at?: string
  download_url?: string
}

export type EtatMiseAJour =
  | { statut: 'a-jour'; version_locale: string }
  | { statut: 'nouvelle-version'; version_locale: string; version_distante: string; url_telechargement: string }
  | { statut: 'offline' }
  | { statut: 'erreur'; motif: string }

/**
 * Compare 2 versions. Format supporté : `YYYYMMDD.HHMM` (timestamp UTC).
 * Retour : `distante > locale` ⇒ true.
 *
 * String compare fonctionne car le format est zero-padded lexicographique.
 */
export function versionEstPlusRecente(distante: string, locale: string): boolean {
  return distante > locale
}

/**
 * Lit la version distante depuis le manifest de la vitrine. Retourne
 * `null` sur erreur ou timeout — jamais throw.
 */
export async function lireManifestDistant(
  fetcher: typeof fetch = fetch,
  url: string = URL_MANIFEST,
): Promise<Manifest | null> {
  const controleur = new AbortController()
  const minuteur = setTimeout(() => controleur.abort(), TIMEOUT_FETCH_MS)
  try {
    const reponse = await fetcher(url, { signal: controleur.signal, cache: 'no-store' })
    if (!reponse.ok) return null
    const donnees = (await reponse.json()) as Manifest
    if (typeof donnees.version !== 'string' || !donnees.version) return null
    return donnees
  } catch {
    return null
  } finally {
    clearTimeout(minuteur)
  }
}

export function estDismissee(version_distante: string, stockage: Storage = localStorage): boolean {
  try {
    return stockage.getItem(CLE_DISMISS) === version_distante
  } catch {
    return false
  }
}

export function marquerDismissee(version_distante: string, stockage: Storage = localStorage): void {
  try {
    stockage.setItem(CLE_DISMISS, version_distante)
  } catch {
    // localStorage inaccessible (mode privé strict) — dismiss non-persistante,
    // OK, l'user re-verra le bandeau au prochain démarrage.
  }
}

/**
 * Point d'entrée : détermine l'état de mise à jour de l'app.
 *
 * @param version_locale - injectée par vite via `__APP_VERSION__`
 * @param navigator_ - injectable pour tests (défaut : `navigator` global)
 * @param fetcher - injectable pour tests (défaut : `fetch` global)
 */
export async function detecterMiseAJour(
  version_locale: string,
  navigator_: Pick<Navigator, 'onLine'> = navigator,
  fetcher: typeof fetch = fetch,
): Promise<EtatMiseAJour> {
  if (!navigator_.onLine) {
    return { statut: 'offline' }
  }
  const manifest = await lireManifestDistant(fetcher)
  if (!manifest) {
    return { statut: 'erreur', motif: 'manifest introuvable ou invalide' }
  }
  if (!versionEstPlusRecente(manifest.version, version_locale)) {
    return { statut: 'a-jour', version_locale }
  }
  return {
    statut: 'nouvelle-version',
    version_locale,
    version_distante: manifest.version,
    url_telechargement: manifest.download_url ?? 'https://stephanejouve.github.io/balance/balance.html',
  }
}
