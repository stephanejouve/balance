"""Smoke tests du module GUI — vérifie que le module s'importe, que la
détection du chemin de config par défaut marche. Ne teste PAS le
comportement UI runtime (tkinter demande une session graphique).

Skippé si tkinter n'est pas dispo sur l'env Python courant (macOS Homebrew
sans python-tk peut ne pas l'inclure ; images Linux minimales aussi) —
la CI GitHub Actions utilise `actions/setup-python@v5` qui inclut
tkinter, donc les tests tourneront là.
"""
from __future__ import annotations

from pathlib import Path

import pytest


try:
    import tkinter  # noqa: F401 — trigger le vrai import du binding _tkinter
    tkinter_available = True
except ImportError:
    tkinter_available = False

# Skip explicite INDIVIDUEL sur chaque test (feedback Stéphane 2026-08-31 :
# un exécuteur custom peut ne pas honorer le `pytestmark` module-level ;
# le décorateur individuel est plus visible ET plus portable). Cohérent
# avec le principe garde-fou vraisemblance : « un échec dont la cause
# n'est pas celle qu'on croit vaut moins qu'un silence assumé »).
_SKIP_SI_PAS_TKINTER = pytest.mark.skipif(
    not tkinter_available,
    reason="tkinter non disponible dans cet env Python "
           "(macOS Homebrew python@3.13+ nécessite `brew install python-tk@3.13` ; "
           "images Linux minimales : `apt-get install python3-tk`)",
)


@_SKIP_SI_PAS_TKINTER
def test_import_module_gui():
    from balance_pdf_import import gui
    assert hasattr(gui, "main")
    assert hasattr(gui, "App")


@_SKIP_SI_PAS_TKINTER
def test_chemin_config_defaut_trouve_fake_fixtures():
    from balance_pdf_import.gui import _chemin_config_defaut
    p = _chemin_config_defaut()
    assert p is not None, "config par défaut introuvable"
    assert p.exists()
    assert p.name == "fake-fixtures.yml"


@_SKIP_SI_PAS_TKINTER
def test_gui_headless_ne_crashe_pas_a_l_instanciation(monkeypatch):
    """En CI headless Ubuntu, il faut un DISPLAY (Xvfb). On skip proprement
    si tkinter refuse d'ouvrir un display — c'est attendu, pas un bug."""
    import tkinter as tk
    try:
        root = tk.Tk()
    except tk.TclError as e:
        pytest.skip(f"pas de display : {e}")

    from balance_pdf_import.gui import App
    app = App(root)
    assert app is not None
    assert app.pdfs == []
    root.destroy()
