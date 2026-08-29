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
  evt.respondWith(
    caches.match(req).then((cached) => cached || fetch(req)),
  )
})
