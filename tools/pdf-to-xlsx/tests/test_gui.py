"""Smoke tests du module GUI — vérifie que le module s'importe, que la
détection du chemin de config par défaut marche. Ne teste PAS le
comportement UI runtime (tkinter demande une session graphique).

Skippé si tkinter n'est pas dispo sur l'env Python courant (macOS Homebrew
sans python-tk peut ne pas l'inclure) — la CI utilise `actions/setup-python@v5`
qui inclut tkinter, donc les tests tourneront là.
"""
from __future__ import annotations

from pathlib import Path

import pytest


try:
    import tkinter  # noqa: F401 — trigger le vrai import du binding _tkinter
    tkinter_available = True
except ImportError:
    tkinter_available = False

pytestmark = pytest.mark.skipif(
    not tkinter_available,
    reason="tkinter non disponible dans cet env Python "
           "(macOS Homebrew python@3.13+ nécessite `brew install python-tk@3.13`)",
)


def test_import_module_gui():
    from balance_pdf_import import gui
    assert hasattr(gui, "main")
    assert hasattr(gui, "App")


def test_chemin_config_defaut_trouve_fake_fixtures():
    from balance_pdf_import.gui import _chemin_config_defaut
    p = _chemin_config_defaut()
    assert p is not None, "config par défaut introuvable"
    assert p.exists()
    assert p.name == "fake-fixtures.yml"


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
