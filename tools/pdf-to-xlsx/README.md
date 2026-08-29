# balance-pdf-import

Convertit les planning PDF de l'organisateur Musiques Festives en xlsx d'import
Balance.

## Contexte

Balance charge ses données via un classeur `.xlsx` (onglets `Liste`, `Stagiaires`,
`Proposés`, `Mode d'emploi`). L'organisateur diffuse en amont un jeu de PDF —
un par jour de session — qui contient déjà une bonne partie de ces données.

Cet outil produit le xlsx d'import à partir des PDF, sans jamais inventer de
donnée : cellule vide + entrée dans le rapport d'audit.

## Installation

```bash
cd tools/pdf-to-xlsx
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
```

## Usage

```bash
balance-pdf-import \
  --config config/s5-2026.yml \
  --pdf ~/pdfs/*.pdf \
  --out balance-S5-2026.xlsx \
  --audit audit-S5-2026.txt
```

## Contrat de sortie

- **`Liste`** : une ligne par titre distinct, `Morceau` et `Resp` renseignés.
  Colonnes pupitres vides — l'import n'invente pas.
- **`Stagiaires`** : vide (aucun PDF ne donne pupitres, instruments, indispos).
- **`Proposés`** : une ligne par séance — `Morceau`, `Date` (ISO), `Début`,
  `Fin`, `Salle`.
- **`Mode d'emploi`** : recopié depuis le template.

## Rapport d'audit

À côté du xlsx, un fichier texte liste :

- blocs non classés (texte reconnu mais aucune règle ne matche)
- séances sans heure de fin
- titres dans `Proposés` absents de `Liste` (et inverse)
- collisions salle × créneau

## Tests

```bash
.venv/bin/pytest
```
