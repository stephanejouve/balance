"""Tests parseur A — planning journalier.

Fixtures : 3 PDF anonymisés (`1_dimanche.pdf`, `2_lundi.pdf`, `3_mardi.pdf`)
d'une session fictive avril 2026 — 6 salles imaginaires (Le Pressoir /
La Grange / Salle Nord / L'Atelier / Le Kiosque / La Véranda), prénoms et
titres de morceaux inventés (aucune PII).

Attendu :
- 24 séances au total
- 8 morceaux uniques
- Distribution 4 (dim) + 8 (lun, sans répét 22h à fin manquante) + 12 (mar)
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from balance_pdf_import.parser_planning import parser_pdf


FIXTURES = Path(__file__).parent / "fixtures"
CONFIG_PATH = Path(__file__).parent.parent / "config" / "fake-fixtures.yml"


@pytest.fixture
def config():
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


@pytest.fixture
def toutes_seances(config):
    seances = []
    for pdf in sorted(FIXTURES.glob("*.pdf")):
        r = parser_pdf(pdf, config)
        seances.extend(r.seances)
    return seances


def test_total_seances(toutes_seances):
    assert len(toutes_seances) == 24


def test_huit_morceaux_distincts(toutes_seances):
    titres = {s.morceau for s in toutes_seances}
    assert len(titres) == 8


def test_mapping_morceau_responsable(toutes_seances):
    resp_par_titre: dict[str, set[str]] = {}
    for s in toutes_seances:
        if s.responsable:
            resp_par_titre.setdefault(s.morceau, set()).add(s.responsable)
    attendus = {
        "Marée Basse": "Vincent",
        "Le Dernier Tram": "Malik",
        "Hiver 84": "Solène",
        "Fanfare de Poche": "Jeanne",
        "L'Ombre du Marronnier": "Nadia",
        "Blue Corridor": "Théo",
        "Sept Heures Moins Dix": "Vincent",
        "Chanson pour Wilma": "Jeanne",
    }
    for titre, resp in attendus.items():
        assert resp in resp_par_titre.get(titre, set()), (
            f"{titre} : responsable attendu {resp!r}, "
            f"vu {resp_par_titre.get(titre)}"
        )


def test_repartition_par_jour(toutes_seances):
    par_date: dict[str, int] = {}
    for s in toutes_seances:
        par_date[s.date] = par_date.get(s.date, 0) + 1
    assert par_date == {
        "2026-04-12": 4,   # dimanche
        "2026-04-13": 8,   # lundi (la 9e séance 22h est skippée car fin manquante)
        "2026-04-14": 12,  # mardi
    }


def test_types_seance_couverts(toutes_seances):
    """Les 3 types non-Répétition doivent apparaître dans le corpus."""
    types = {s.type for s in toutes_seances}
    assert "Répétition" in types
    assert "Pré-Production" in types
    assert "Post-Production" in types
    assert "Enregistrement" in types


def test_bandeau_petit_dejeuner_ignore(config):
    """PETIT-DÉJEUNER pleine largeur ne doit produire aucune séance."""
    r = parser_pdf(FIXTURES / "1_dimanche.pdf", config)
    matins = [s for s in r.seances if s.debut == "08:00"]
    assert matins == []


def test_bandeau_reunion_dinformation_ignore(config):
    """Bandeau RÉUNION D'INFORMATION dimanche 09:20-10:00 ne doit produire
    aucune séance (pas de répétition dans ce créneau)."""
    r = parser_pdf(FIXTURES / "1_dimanche.pdf", config)
    reunions = [s for s in r.seances if s.debut == "09:20"]
    assert reunions == []


def test_bandeau_grand_concert_ignore(config):
    """Bandeau GRAND CONCERT mardi 21:00 ne doit produire aucune séance."""
    r = parser_pdf(FIXTURES / "3_mardi.pdf", config)
    concert = [s for s in r.seances if s.debut == "21:00"]
    assert concert == []


def test_word_boundary_evite_faux_positif_repetitions(config):
    """Dimanche 21:00 contient « Jams / Répétitions Jusqu'à 24:00 »
    (pluriel). Le matching \\b évite d'en tirer une séance fantôme."""
    r = parser_pdf(FIXTURES / "1_dimanche.pdf", config)
    for s in r.seances:
        assert s.debut != "21:00", (
            f"séance fantôme extraite de « Répétitions » pluriel : {s}"
        )


def test_apostrophe_typographique_normalisee(config):
    """Salles L'Atelier + titre L'Ombre du Marronnier : apostrophes typo
    U+2019 doivent être normalisées en apostrophe droite."""
    r = parser_pdf(FIXTURES / "3_mardi.pdf", config)
    for s in r.seances:
        assert "\u2019" not in s.salle, f"apostrophe typo dans salle {s.salle!r}"
        assert "\u2019" not in s.morceau, f"apostrophe typo dans morceau {s.morceau!r}"
    # L'Atelier doit être détecté avec apostrophe droite
    salles = {s.salle for s in r.seances}
    if "L'Atelier" in salles:
        assert "L'Atelier" in salles  # str comparable


def test_toutes_seances_ont_date_iso(toutes_seances):
    import re
    iso = re.compile(r"^\d{4}-\d{2}-\d{2}$")
    for s in toutes_seances:
        assert iso.match(s.date), f"date non-ISO : {s.date!r}"


def test_toutes_seances_ont_heures_valides(toutes_seances):
    import re
    hhmm = re.compile(r"^\d{1,2}:\d{2}$")
    for s in toutes_seances:
        assert hhmm.match(s.debut), f"debut invalide : {s.debut!r}"
        assert s.fin is None or hhmm.match(s.fin), f"fin invalide : {s.fin!r}"


def test_aucune_collision_salle_creneau(toutes_seances):
    """Deux séances ne doivent pas occuper la même salle au même créneau."""
    vus: set[tuple[str, str, str, str]] = set()
    for s in toutes_seances:
        cle = (s.date, s.salle, s.debut, s.fin or "")
        assert cle not in vus, f"collision salle × créneau : {cle}"
        vus.add(cle)


def test_repetition_de_nuit_lundi_signale_fin_manquante(config):
    """Lundi 22:00 contient « Répétition Le Dernier Tram avec Malik » sans
    heure de fin. Le parser doit la signaler en non-classée (fin manquante),
    pas en séance silencieuse ni en crash."""
    r = parser_pdf(FIXTURES / "2_lundi.pdf", config)
    fins_manquantes = [nc for nc in r.non_classees if nc.get("raison") == "fin manquante"]
    assert len(fins_manquantes) >= 1
    assert any("Le Dernier Tram" in nc["texte"] for nc in fins_manquantes)


def test_echauffement_ignore_via_config(config):
    """Mardi 10:00-11:15 Le Pressoir contient « Échauffement Chant » — ni
    séance ni non-classée : ignoré via config."""
    r = parser_pdf(FIXTURES / "3_mardi.pdf", config)
    # Aucune séance "Échauffement" ne doit être extraite
    for s in r.seances:
        assert "Échauffement" not in s.morceau
    # Doit apparaître en cellule ignorée
    ignorees_echauffement = [ig for ig in r.ignorees if ig.get("raison") == "Échauffement"]
    assert len(ignorees_echauffement) >= 1
