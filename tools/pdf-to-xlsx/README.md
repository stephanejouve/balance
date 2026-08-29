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

## Application graphique (GUI)

Pour un usage non-technique, une petite fenêtre tkinter est fournie :

```bash
.venv/bin/balance-pdf-import-gui
```

Fenêtre 640×540 avec 3 zones : sélection des PDFs (ou dossier), config
YAML (par défaut celui embarqué à côté du binaire), fichier xlsx de
sortie. Bouton « Générer le xlsx » + zone log.

## Binaires standalone (téléchargeables)

Pour distribuer l'outil à un utilisateur qui ne veut pas installer
Python, un workflow GitHub Actions (`release-pdf-import.yml`) package
la GUI en binaire standalone via PyInstaller sur les 3 OS (macOS, Windows,
Linux). Déclenché sur tag `pdf-import-v*`.

Build local :

```bash
./build_binary.sh
```

**Note macOS** : les binaires ne sont pas signés Apple. À la 1ʳᵉ
utilisation, Gatekeeper affiche un warning — passer par System
Preferences → Security & Privacy → « Ouvrir quand même ».

## Tests

```bash
.venv/bin/pytest --basetemp=/tmp/pytest-<user>
```

Sur macOS Homebrew, tkinter peut ne pas être dispo dans le venv (les
tests GUI seront skippés) — installer `python-tk@3.13` via brew ou
utiliser le Python officiel python.org qui inclut tkinter par défaut.
La CI Ubuntu/setup-python inclut tkinter, tous les tests tournent
là-bas.
