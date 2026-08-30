"""Wrapper d'entrée CLI pour PyInstaller — voir entry_gui.py pour le
raisonnement (imports relatifs vs top-level script)."""

from balance_pdf_import.cli import main

if __name__ == "__main__":
    main()
