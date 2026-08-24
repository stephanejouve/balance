# MF-RepSal

Outil de répartition des répétitions musicales pour l'association (stages, sessions, concerts).

## Cadre

- Cahier des charges : [`brief_repartiteur.md`](brief_repartiteur.md)
- Prototype de référence (HTML autonome hérité, validé sur données réelles) :
  [`repartiteur_repetitions.html`](repartiteur_repetitions.html)
- Jeu d'essai réel : [`apero_mercredi.json`](apero_mercredi.json) (session 5, 13 morceaux, 39 musiciens)

## Cible

Un **fichier HTML unique** ouvrable par double-clic sur PC, Mac ou depuis clé USB.
Zéro dépendance réseau à l'exécution (offline-first), zéro installation.

## Développement

Le nouveau projet vit dans [`app/`](app/) — Svelte + TypeScript + Vite. Le build
produit un fichier unique `dist/index.html` avec tout inliné (JS, CSS, polices).

```bash
cd app
npm install
npm run dev       # dev server (http://localhost:5173)
npm run build     # → ../dist/index.html
npm test          # vitest
```

## Structure

```
MF-RepSal/
├── repartiteur_repetitions.html    # prototype hérité (référence)
├── apero_mercredi.json             # jeu d'essai réel
├── brief_repartiteur.md            # cahier des charges
├── app/                            # nouvelle base (Svelte + TS + Vite)
└── dist/                           # livrable (single-file)
```
