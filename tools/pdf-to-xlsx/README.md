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
# Un ou plusieurs PDFs par flag répété
balance-pdf-import \
  --config config/fake-fixtures.yml \
  --pdf ~/pdfs/1_dimanche.pdf --pdf ~/pdfs/2_lundi.pdf \
  --out balance.xlsx \
  --audit balance.audit.txt

# Ou : shell glob
balance-pdf-import --config config/fake-fixtures.yml \
  --pdf ~/pdfs/*.pdf --out balance.xlsx

# Ou : dossier complet (récursif, trié par nom)
balance-pdf-import --config config/fake-fixtures.yml \
  --pdf-dir ~/pdfs/ --out balance.xlsx
```

Pour une vraie session, dupliquer `config/fake-fixtures.yml` et adapter
`session`, `dates`, `salles` (les 6 noms qui apparaissent en en-tête de
colonnes dans les PDFs), et éventuellement `ignorer` (mots-clés locaux
comme « Échauffement », « Promenade », etc.).

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
