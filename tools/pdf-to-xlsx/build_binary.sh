#!/usr/bin/env bash
# Build local du binaire standalone via PyInstaller.
#
# Sortie : dist/balance-pdf-import/ (dossier avec exécutable + deps)
#          dist/balance-pdf-import-gui/ (idem pour la GUI tkinter)
#
# Pour macOS, l'app .app est dist/balance-pdf-import-gui.app.
#
# Usage :
#   cd tools/pdf-to-xlsx
#   ./build_binary.sh
#
# Prérequis :
#   python3 -m venv .venv
#   .venv/bin/pip install -e '.[dev,build]'
#
# ── Anti-divergence config (incident Stéphane 2026-08-31) ─────────────────
# Le fichier config embarqué dans le bundle est un exemplaire séparé de
# celui du dépôt. Si l'user l'édite en place (test rapide dans le .app),
# les deux divergent silencieusement — et un futur build pourrait embarquer
# une version obsolète, produisant « un résultat plausible obtenu avec des
# paramètres qui ne sont pas ceux qu'on croit ».
#
# Ce script :
# 1. Copie explicitement `config/fake-fixtures.yml` depuis le dépôt à
#    chaque build via `--add-data`. `--noconfirm --clean` détruit toute
#    version bundle existante avant recopie.
# 2. Verrouille en lecture seule (`chmod 444`) tous les fichiers config
#    du bundle après build — l'user qui tente d'éditer le fichier bundle
#    voit immédiatement « fichier read-only », symptôme visible.
# 3. Vérifie le SHA post-build : bundle config == source dépôt (fail-hard
#    si divergence — filet contre régression du script lui-même).

set -euo pipefail

VENV="${VENV:-.venv}"
if [ ! -d "$VENV" ]; then
  echo "⚠️  venv absent — crée-le avec : python3 -m venv $VENV && $VENV/bin/pip install -e '.[dev,build]'"
  exit 1
fi

PY="$VENV/bin/python"
PYINSTALLER="$VENV/bin/pyinstaller"

if ! [ -x "$PYINSTALLER" ]; then
  echo "⚠️  pyinstaller non installé — $VENV/bin/pip install '.[build]'"
  exit 1
fi

CONFIG_SRC="config/fake-fixtures.yml"
CONFIG_INCLUDE="${CONFIG_SRC}:config"

if [ ! -f "$CONFIG_SRC" ]; then
  echo "❌ source config absente : $CONFIG_SRC"
  exit 1
fi

echo "▶ Build CLI (balance-pdf-import) …"
"$PYINSTALLER" \
  --noconfirm --clean --onedir \
  --name balance-pdf-import \
  --add-data "$CONFIG_INCLUDE" \
  --paths src \
  entry_cli.py

echo ""
echo "▶ Build GUI (balance-pdf-import-gui) …"
"$PYINSTALLER" \
  --noconfirm --clean --onedir --windowed \
  --name balance-pdf-import-gui \
  --add-data "$CONFIG_INCLUDE" \
  --paths src \
  entry_gui.py

# ── Verrouillage anti-édition-en-place ────────────────────────────────────
echo ""
echo "▶ Verrouillage read-only des configs bundle (dissuasion édition en place)"

SHA_SRC=$(shasum -a 256 "$CONFIG_SRC" | awk '{print $1}')
BUNDLE_CONFIGS=(
  "dist/balance-pdf-import/_internal/config"
  "dist/balance-pdf-import-gui/_internal/config"
  "dist/balance-pdf-import-gui.app/Contents/Frameworks/config"
)
for cfg_dir in "${BUNDLE_CONFIGS[@]}"; do
  [ -d "$cfg_dir" ] || continue
  for f in "$cfg_dir"/*.yml "$cfg_dir"/*.yaml; do
    [ -f "$f" ] || continue
    SHA_BUNDLE=$(shasum -a 256 "$f" | awk '{print $1}')
    if [ "$SHA_BUNDLE" != "$SHA_SRC" ]; then
      echo "❌ divergence SHA détectée : $f"
      echo "   source  : $SHA_SRC"
      echo "   bundle  : $SHA_BUNDLE"
      echo "   → régression du script de build (à corriger avant merge)"
      exit 1
    fi
    chmod 444 "$f"
    echo "   verrouillé : $f (SHA $SHA_SRC)"
  done
done

echo ""
echo "✅ Build terminé — voir dist/"
ls -la dist/
