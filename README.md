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

## Concepts clés

### Pupitre vs precision

Chaque musicien déclare un ou plusieurs **instruments**. Chaque instrument a
deux champs :

- **`pupitre`** — la catégorie que le solveur connaît. 6 par défaut, éditables
  par lieu : `chant`, `piano`, `basse`, `batterie`, `guitare`, `vents`.
- **`precision`** — le libellé exact de l'instrument, facultatif.

**Règle simple** : *si le pupitre décrit déjà bien l'instrument, laisse la
precision vide*. Utilise-la quand le pupitre est trop large (les « vents »
regroupent bois, cuivres, saxos…) ou quand tu veux distinguer une variante
(contrebasse vs basse électrique).

| Cas | Pupitre | Precision |
|---|---|---|
| Un pianiste standard | `piano` | *(vide)* |
| Un guitariste standard | `guitare` | *(vide)* |
| Une contrebassiste | `basse` | `contrebasse` |
| Un clarinettiste basse | `vents` | `clarinette basse` |
| Un saxophoniste alto | `vents` | `sax alto` |
| Une flûtiste | `vents` | `flûte traversière` |

**Comment c'est utilisé** :

- **Par le solveur** : uniquement le `pupitre`. Deux musiciens qui partagent un
  pupitre sont interchangeables du point de vue placement. Les indisponibilités
  ciblées par rôle (« indispo en chant à 9h ») travaillent aussi au niveau
  pupitre — pas de ciblage plus fin en v1.
- **Par les humains** : la `precision` s'affiche partout où on parle du
  musicien — chips membres, feuille de route imprimée, exports CSV et XLSX.
  Le musicien sait *quel* instrument amener.

**Cas typique — une personne polyvalente** :

```json
{
  "nom": "Prune",
  "instruments": [
    { "pupitre": "piano" },
    { "pupitre": "basse", "precision": "contrebasse" }
  ]
}
```

Le solveur voit deux compétences (piano, basse). L'affichage montre « Prune
au piano » ou « Prune à la contrebasse » selon le morceau.

À l'import Excel, la precision est remplie automatiquement quand un nom entre
parenthèses ne matche pas un pupitre standard : `Cédric (sax sop)` devient
`pupitre: vents, precision: "sax sop"`.

### Format du classeur Excel d'entrée

Balance lit un onglet nommé **`Liste`** dans le classeur `.xlsx`. Convention
héritée de la feuille papier utilisée sur place — une ligne par morceau, une
colonne par pupitre.

**Colonnes attendues** (le mapping par défaut peut être adapté) :

| Colonne | Rôle | Obligatoire |
|---|---|---|
| `Morceau` | Titre du morceau | ✓ |
| `Auteur` | Auteur / compositeur | facultatif |
| `Style` | Genre (Jazz, Rock, Latin…) | facultatif |
| `Tona` | Tonalité (`C`, `Bb`, `A-`…) | facultatif |
| `Resp` | Responsable du groupe | facultatif |
| `Cherche` | Postes à pourvoir en libellé libre | facultatif |
| `Chant`, `Piano`, `Basse`, `Batterie`, `Guitare`, `Vents` | Un pupitre chacune | au moins un |

**Ce qu'on met dans une cellule pupitre** :

- **vide** — pas de personne à ce pupitre pour ce morceau (par défaut)
- **`NON`** — explicitement pas ce pupitre (équivalent à vide, plus lisible)
- **`CHERCHE`** — poste à pourvoir → apparaîtra dans `postes_cherches`, les
  renforts compatibles seront suggérés dans l'UI
- **Un nom** — la personne joue à ce pupitre : `Alice`, `Éric`
- **Plusieurs noms** séparés par virgules — plusieurs personnes au même pupitre :
  `Emma, Bianca` (deux chanteuses)
- **Nom + instrument entre parenthèses** — precise l'instrument :
  `Colette (contrebasse)` → pupitre `basse`, precision `contrebasse`
- **Nom + discriminant entre parenthèses (non-instrument)** — pour distinguer
  des homonymes : `Pierre (SIG)` et `Pierre (L)` sont deux personnes différentes

**Exemple concret** (colonnes ordinaires + les 6 pupitres) :

| Morceau | Auteur | Style | Tona | Resp | Chant | Piano | Basse | Batterie | Guitare | Vents |
|---|---|---|---|---|---|---|---|---|---|---|
| Love | Nat King Cole | Jazz |  | Emma | Emma (B), Bianca (B) | Prune | Rose | CHERCHE | Cyril | Serge |
| Autumn Leaves | Cosma | Jazz | Bb | Karl | Léa | Karl | Prune (contrebasse) | Zoltan (SIG) | NON | Cédric (sax alto) |
| Boys Don't Cry | The Cure | Rock |  | Adrien | Adrien, Damien | Hector | Fabien | Gaspard | Basile |  |

Ce que Balance en tire, pour la première ligne :

- Morceau **Love**, style Jazz, responsable Emma
- 6 membres : Emma (B) au chant, Bianca (B) au chant, Prune au piano, Rose à
  la basse, Cyril à la guitare, Serge aux vents
- Poste **batterie** cherché → les batteurs libres seront suggérés en renforts
- `Emma (B)` et `Bianca (B)` = deux personnes distinctes (discriminants `(B)`
  différents ; utile parce que ce sont deux Emma / Beate homonymes dans
  d'autres morceaux)

Pour la troisième ligne, `Zoltan (SIG)` sera reconnu comme un homonyme de
`Zoltan (L)` s'il apparaît ailleurs — Balance les traite comme deux batteurs
différents.

**Cas d'usage typique** :

1. Tu duplicates ton classeur habituel, tu vérifies que l'onglet s'appelle
   `Liste` et que les colonnes matchent (renomme au besoin)
2. Dans Balance : **« Étape 1 · Source »** → **« Importer .xlsx (Liste)… »**
3. L'UI affiche le nombre de groupes lus + les éventuels avertissements
   (colonne manquante, cellule ambiguë)
4. Tu peux ensuite éditer inline dans **« Étape 1b · Inscriptions »** avant
   de lancer la répartition

### Import complémentaire — onglet `Stagiaires`

Cas d'usage : à l'inscription du stage, on veut charger la liste complète
des inscrits **avant** que les groupes soient composés. Ces stagiaires
apparaissent alors comme « libres » dans la vue Personnes et deviennent
automatiquement candidats aux renforts.

**Onglet Excel `Stagiaires`** — une ligne par personne :

| Colonne | Rôle |
|---|---|
| `Nom` (obligatoire) | Prénom + éventuel discriminant `(B)` pour distinguer un homonyme |
| `Pupitre` | Un pupitre parmi les 6 (`chant`, `piano`, `basse`, `batterie`, `guitare`, `vents`) |
| `Pupitres additionnels` | Optionnel, virgulés (`basse, guitare`) pour les polyvalents |
| `Instrument` | Optionnel, precision libre (`sax alto`, `contrebasse`) |
| `Latéralité` | `droitier` / `gaucher` (batteurs seulement) |
| `Indispos` | Format libre, plusieurs séparées par `;` |

**Format libre des indispos** : Balance extrait au mieux les jours de la
semaine FR (`lundi`, `mardi`…), les plages horaires (`9h-10h`, `14:30-16:00`)
et les pupitres cités (`chant`, `piano`…). Le texte brut est toujours
conservé pour relecture humaine. Exemples reconnus :

- `mercredi 09h-10h chant` → jour mercredi, plage 09:00-10:00, rôle chant
- `mardi 14:30 - 16:00` → jour mardi, plage 14:30-16:00
- `convalescence` → texte conservé sans horaire spécifique

**Workflow** :

1. Bouton **« Importer stagiaires .xlsx… »** dans la section Source
2. Fusion avec l'existant — les personnes déjà présentes (même id) sont
   ignorées et signalées
3. La vue Personnes montre les nouveaux stagiaires avec le badge « libre »
4. La vue Quotas devient immédiatement utile pour évaluer les tensions
   par pupitre (« combien de batteurs pour combien de groupes possibles ? »)

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
