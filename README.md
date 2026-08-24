# Balance

Outil de répartition des répétitions musicales pour l'association (stages, sessions, concerts).

Le mot **Balance** vient du métier : c'est le réglage sonore qui précède un concert. Il dit
ce que fait l'outil : équilibrer les musiciens entre les groupes, les groupes entre les
salles.

## Cadre

- Cahier des charges : [`brief_balance.md`](brief_balance.md)
- Prototype de référence (HTML autonome hérité, validé sur données réelles) :
  [`repartiteur_repetitions.html`](repartiteur_repetitions.html)
- Jeu d'essai réel : [`apero_mercredi.json`](apero_mercredi.json) (session 5, 13 morceaux, 39 musiciens)

## Cible

Un **fichier HTML unique** (`balance.html`) ouvrable par double-clic sur PC, Mac ou depuis
clé USB. Zéro dépendance réseau à l'exécution (offline-first), zéro installation.

## Développement

Le nouveau projet vit dans [`app/`](app/) — Svelte + TypeScript + Vite. Le build produit
un fichier unique `dist/balance.html` avec tout inliné (JS, CSS, polices).

```bash
cd app
npm install
npm run dev       # dev server → http://localhost:5173/balance.html
npm run build     # → ../dist/balance.html
npm test          # vitest
```

## Structure

```
Balance/
├── repartiteur_repetitions.html    # prototype hérité (référence)
├── apero_mercredi.json             # jeu d'essai réel
├── brief_balance.md                # cahier des charges
├── app/                            # nouvelle base (Svelte + TS + Vite)
│   ├── balance.html                # entrée
│   ├── src/domain/                 # modèle canonique, DSL grille, migration
│   ├── src/engine/                 # moteur : contraintes, vérification, solveur
│   └── docs/                       # règles UI, décisions
└── dist/                           # livrable single-file (git-ignoré)
```
