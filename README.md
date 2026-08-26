# Balance

**Balance** est un outil de répartition automatique des répétitions musicales pour
un stage ou une session — répond à la question : *qui répète où, et quand ?*

Le mot vient du métier : c'est le réglage sonore qui précède un concert. Il dit
ce que fait l'outil : équilibrer les musiciens entre les groupes, les groupes
entre les salles.

## Ce qu'il fait

- Répartit N groupes × M répétitions dans les créneaux et salles disponibles
- Sans jamais convoquer deux fois la même personne au même moment
- Sans doubler une salle, en respectant sa jauge et ses restrictions horaires
- En respectant les indisponibilités déclarées (avec ciblage par rôle : « Alice
  indisponible pour le chant à 9h mais reste dispo pour son piano »)
- Avec plusieurs préférences pondérées activables : espacement 12h entre répés,
  équilibre diurne/tardif, marge d'occupation, etc.
- Sort trois vues du planning : par groupe, par salle, par musicien
- Inclut un conducteur du spectacle avec minutage, mouvements de plateau,
  inversions de kit et programmation par style

## Cible technique

Un **fichier HTML unique** (`balance.html`) ouvrable par double-clic sur PC, Mac
ou depuis clé USB. Zéro dépendance réseau à l'exécution (offline-first), zéro
installation. Import Excel `.xlsx` en entrée, export CSV/XLSX/impression en
sortie, sauvegarde d'état en JSON pour reprise.

## Développement

Le projet vit dans [`app/`](app/) — Svelte 5 + TypeScript + Vite. Le build
produit un fichier unique `dist/balance.html` avec tout inliné (JS, CSS,
polices `@fontsource`).

```bash
cd app
npm install
npm run dev       # dev server → http://localhost:5173/balance.html
npm run build     # → ../dist/balance.html (~1.4 Mo)
npm test          # vitest — 94 tests
```

## Structure

```
Balance/
├── repartiteur_repetitions.html    # prototype hérité (référence historique)
├── apero_mercredi.json             # jeu d'essai (données anonymisées)
├── brief_balance.md                # cahier des charges
├── LICENSE                         # MIT
├── app/                            # base Svelte + TS + Vite
│   ├── balance.html                # entrée
│   ├── src/domain/                 # modèle canonique Zod + DSL grille + migration
│   ├── src/engine/                 # solveur + vérif + contraintes + diagnostic
│   ├── src/io/                     # import Excel/CSV + exports
│   ├── src/edition/                # 8 composants de saisie
│   ├── src/vues/                   # 6 composants de rendu (dont Concert, Carte)
│   └── docs/                       # règles UI, décisions produit
└── dist/                           # livrable single-file (git-ignoré)
```

## Licence

MIT — voir [`LICENSE`](LICENSE).

Le jeu d'essai `apero_mercredi.json` a été anonymisé (prénoms fictifs) — la
structure originale (polyvalence, homonymes discriminés, indisponibilités par
rôle) est préservée pour continuer à couvrir les cas de test réels.
