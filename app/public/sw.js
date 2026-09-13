// Service worker Balance — cache-first minimaliste pour balance.html.
//
// L'app étant single-file HTML, le SW ne cache que ce fichier + le
// manifest de version. Objectifs :
//   1. Servir balance.html hors ligne au 2ᵉ chargement (déjà obtenu par
//      le HTTP cache navigator, mais SW garantit).
//   2. Détecter l'arrivée d'une nouvelle version : quand le contenu de
//      ce fichier change (SW_VERSION incrémenté au build via
//      __APP_VERSION__), le browser installe un nouveau SW et emit
//      `updatefound` — l'app affiche un bandeau.
//
// Ne fonctionne que sur http(s):// — file:// n'exécute pas de SW.
// L'app a un fallback fetch manuel dans src/edition/mise-a-jour.ts.

// __APP_VERSION__ est remplacé au build par vite (define).
const SW_VERSION = '__APP_VERSION__'
const CACHE_NOM = `balance-${SW_VERSION}`
const RESSOURCES = ['./', './balance.html', './index.html']

self.addEventListener('install', (evt) => {
  evt.waitUntil(
    caches.open(CACHE_NOM).then((cache) =>
      Promise.all(
        RESSOURCES.map((r) =>
          cache.add(r).catch(() => {
            // ressource optionnelle : on tolère l'échec (ex. balance.html
            // absent en dev, index.html seule en pages)
          }),
        ),
      ),
    ),
  )
  self.skipWaiting()
})

self.addEventListener('activate', (evt) => {
  evt.waitUntil(
    caches.keys().then((noms) =>
      Promise.all(noms.filter((n) => n !== CACHE_NOM).map((n) => caches.delete(n))),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (evt) => {
  const req = evt.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  // On ne cache que les ressources same-origin et notre balance.html.
  if (url.origin !== self.location.origin) return

  // Requête de NAVIGATION (mode === 'navigate') — cas spécial, ne peut pas
  // partager la logique cache-first des sous-ressources. Incident production
  // 2026-09-12 (issue #108) : quand l'utilisateur appelle une URL de
  // répertoire SANS barre finale (ex. `/balance` au lieu de `/balance/`),
  // le serveur répond 301 vers la variante avec barre. Le SW cache-first
  // naïf cherchait `/balance` dans son cache (qui ne contient que `./` =
  // `/balance/`), ne trouvait rien, puis appelait `fetch(req)` avec le
  // Request original — dont `redirect === 'manual'` par défaut pour une
  // navigation. La Response résultante était de type `opaqueredirect`, que
  // le browser ne suivait pas correctement à travers `respondWith` — 404.
  //
  // Le fix : pour les navigations, refaire un `fetch(url, {redirect: 'follow'})`
  // qui suit les redirections comme le browser le ferait nativement. En cas
  // d'échec réseau (offline), retomber sur `balance.html` du cache — c'est
  // notre app shell, elle sait démarrer sans connexion.
  //
  // Cas non-régression naturel : ouvrir `/balance` sans barre finale dans
  // un browser où ce SW est enregistré. Attendu = redirection puis 200,
  // pas 404. Cf CD msg 6714 (2026-09-13 14:45).
  if (req.mode === 'navigate') {
    evt.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached
        // Nouvelle Request avec redirect: 'follow' — le browser suit
        // proprement les 301/302 avant de nous rendre la Response finale.
        return fetch(url.href, {
          credentials: 'same-origin',
          redirect: 'follow',
        }).catch(() =>
          // Fallback offline : `caches.match` peut retourner undefined si
          // l'app-shell n'est pas en cache (première visite offline, install
          // interrompu). `respondWith(undefined)` = erreur SW pour le browser
          // — on rend explicitement une Response d'erreur, laquelle affichera
          // la page d'erreur navigateur au lieu de briser le respondWith
          // (nit N1 review Leader PR #114).
          caches.match('./balance.html').then((fb) => fb || Response.error()),
        )
      }),
    )
    return
  }

  evt.respondWith(
    caches.match(req).then((cached) => cached || fetch(req)),
  )
})
