"""Wrapper d'entrée pour PyInstaller — évite l'ImportError sur les
imports relatifs du package `balance_pdf_import`.

PyInstaller compilé avec le fichier source direct
(`src/balance_pdf_import/gui.py`) lance le script comme top-level, ce
qui fait échouer les `from .parser_planning import ...`. Un wrapper
qui fait un import absolu depuis la racine du package fixe le
problème sans dénaturer le package lui-même (qui garde ses imports
relatifs propres pour usage `pip install`).

Utilisé aussi par `build_binary.sh` et le workflow release-pdf-import.yml.
"""

from balance_pdf_import.gui import main

if __name__ == "__main__":
    main()
