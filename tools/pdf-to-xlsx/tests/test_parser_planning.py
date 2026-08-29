"""Tests parseur A — planning journalier.

Fixtures : les 6 PDF S5 2026 (dimanche → vendredi) + l'oracle xlsx corrigé
par Stéphane. L'oracle a 36 séances sur 12 morceaux ; le parseur doit
reproduire exactement ce compte, avec le bon mapping morceau/responsable.
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from balance_pdf_import.parser_planning import parser_pdf


FIXTURES = Path(__file__).parent / "fixtures"
CONFIG_PATH = Path(__file__).parent.parent / "config" / "s5-2026.yml"


@pytest.fixture
def config():
    with open(CONFIG_PATH) as f:
        return yaml.safe_load(f)


@pytest.fixture
def toutes_seances(config):
    seances = []
    for pdf in sorted(FIXTURES.glob("balance-pdf-*.pdf")):
        r = parser_pdf(pdf, config)
        seances.extend(r.seances)
    return seances


def test_total_seances_matche_brief(toutes_seances):
    assert len(toutes_seances) == 36


def test_douze_morceaux_distincts(toutes_seances):
    titres = {s.morceau for s in toutes_seances}
    assert len(titres) == 12


def test_mapping_morceau_responsable(toutes_seances, config):
    resp_par_titre: dict[str, set[str]] = {}
    for s in toutes_seances:
        if s.responsable:
            resp_par_titre.setdefault(s.morceau, set()).add(s.responsable)
    attendus = {
        "Woman": "François",
        "Lady Bird": "Thierry",
        "On That Morning": "Bertrand",
        "Have You Met Miss Jones": "Pierre",
        "La Ballade de Jim": "Cyrille",
        "Where or When": "Corinne",
        "Capitaine Abandonné": "Pierre",
        "Just a Song Before I Go": "Bertrand",
        "Avant Toi": "Corinne",
        "Fotografia": "François",
        "Débranche": "Cyrille",
        "Top of My Head": "Thierry",
    }
    for titre, resp in attendus.items():
        assert resp in resp_par_titre.get(titre, set()), (
            f"{titre} : responsable attendu {resp!r}, "
            f"vu {resp_par_titre.get(titre)}"
        )


def test_repartition_par_jour(toutes_seances):
    """Distribution des séances par date (source PDF, pas l'oracle)."""
    par_date: dict[str, int] = {}
    for s in toutes_seances:
        par_date[s.date] = par_date.get(s.date, 0) + 1
    assert par_date == {
        "2026-08-23": 3,   # dimanche
        "2026-08-24": 3,   # lundi
        "2026-08-25": 6,   # mardi
        "2026-08-26": 6,   # mercredi
        "2026-08-27": 6,   # jeudi
        "2026-08-28": 12,  # vendredi
    }


def test_creneau_bandeau_petit_dejeuner_ignore(config):
    """PETIT-DÉJEUNER pleine largeur ne doit produire aucune séance."""
    r = parser_pdf(FIXTURES / "balance-pdf-4-mercredi.pdf", config)
    matins = [s for s in r.seances if s.debut == "08:00"]
    assert matins == []


def test_bandeau_apero_concert_intervenants_masque_pas_les_seances_voisines(config):
    """Mardi 25/08 : bandeau APÉRO-CONCERT DES INTERVENANTS à 14:30-16:00
    ne doit PAS empêcher l'extraction des 3 séances des autres colonnes."""
    r = parser_pdf(FIXTURES / "balance-pdf-3-mardi.pdf", config)
    seances_14h30 = [s for s in r.seances if s.debut == "14:30"]
    titres = {s.morceau for s in seances_14h30}
    assert titres == {"Top of My Head", "Débranche", "Fotografia"}


def test_repetition_intervenants_ignoree(config):
    """Lundi 24/08 16:30-20:45 Le Garage = 'Répétition Intervenants' n'est
    pas un morceau du répertoire — doit être ignoré par la config."""
    r = parser_pdf(FIXTURES / "balance-pdf-2-lundi.pdf", config)
    for s in r.seances:
        assert "Intervenants" not in s.morceau, (
            f"'Intervenants' extrait comme séance : {s}"
        )


def test_word_boundary_evite_faux_positif_repetitions(config):
    """Dimanche 23/08 18:00-19:45 Les Clapiers contient 'Répétitions' (pluriel).
    Le matching \b évite d'en tirer une fausse séance avec morceau='s'."""
    r = parser_pdf(FIXTURES / "balance-pdf-1-dimanche.pdf", config)
    for s in r.seances:
        assert s.morceau != "s"
        assert len(s.morceau) >= 3


def test_apostrophe_typographique_normalisee(config):
    """Salles L'Étang / L'Espérance : apostrophe typo `’` U+2019 doit être
    normalisée en apostrophe droite dans les valeurs de salle extraites."""
    r = parser_pdf(FIXTURES / "balance-pdf-4-mercredi.pdf", config)
    salles = {s.salle for s in r.seances}
    for salle in salles:
        assert "\u2019" not in salle, f"apostrophe typo dans {salle!r}"


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
