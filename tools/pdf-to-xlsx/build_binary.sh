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

CONFIG_INCLUDE="config/fake-fixtures.yml:config"

echo "▶ Build CLI (balance-pdf-import) …"
"$PYINSTALLER" \
  --noconfirm --clean --onedir \
  --name balance-pdf-import \
  --add-data "$CONFIG_INCLUDE" \
  src/balance_pdf_import/cli.py

echo ""
echo "▶ Build GUI (balance-pdf-import-gui) …"
"$PYINSTALLER" \
  --noconfirm --clean --onedir --windowed \
  --name balance-pdf-import-gui \
  --add-data "$CONFIG_INCLUDE" \
  src/balance_pdf_import/gui.py

echo ""
echo "✅ Build terminé — voir dist/"
ls -la dist/
