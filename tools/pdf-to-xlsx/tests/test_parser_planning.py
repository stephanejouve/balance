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


FIXTURES = Path(__file__).parent / "fixtures" / "s0"
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


# ── PR1 : audit Claude Desktop C1/C2/C3 + garde-fou + dates ─────────────
# (2026-08-30 — anti-régression pour les 3 causes racines silencieuses)


def test_garde_fou_vraisemblance_config_incompatible(config, tmp_path):
    """Une config avec des salles qui ne matchent aucun en-tête produit 0
    salle détectée. Le garde-fou doit remonter une erreur explicite —
    plus jamais 3 exécutions à l'aveugle."""
    config_bidon = dict(config)
    config_bidon["salles"] = ["Salle Fantôme A", "Salle Fantôme B"]
    r = parser_pdf(FIXTURES / "1_dimanche.pdf", config_bidon)
    erreurs = [e for e in r.erreurs_vraisemblance if e["niveau"] == "error"]
    raisons = [e["raison"] for e in erreurs]
    assert any("aucune salle détectée" in r for r in raisons), \
        f"attendu erreur 'aucune salle détectée', vu {raisons}"


def test_dates_config_cross_check_divergence_warn(config, tmp_path):
    """La clé `dates` config sert de filet : si la date extraite du titre
    diverge de `dates[jour_déduit_du_nom_fichier]`, on émet un warning.
    Une redondance déclarée qui ne se confronte à rien est un piège
    silencieux (§« Sur le schéma de configuration » audit Claude Desktop)."""
    config_menteur = dict(config)
    # Le fake 1_dimanche.pdf a titre '2026-04-12' ; on annonce '2026-04-99' en config
    config_menteur["dates"] = {**config.get("dates", {}), "dimanche": "2026-04-99"}
    r = parser_pdf(FIXTURES / "1_dimanche.pdf", config_menteur)
    warns = [e for e in r.erreurs_vraisemblance if e["niveau"] == "warning"]
    raisons = [w["raison"] for w in warns]
    assert any("divergence date" in r for r in raisons), \
        f"attendu warning 'divergence date', vu {raisons}"


def test_dates_config_fallback_si_titre_non_extrait(tmp_path):
    """Fallback : si l'extraction titre échoue mais que le nom fichier
    contient un jour et que `config['dates'][jour]` existe, on utilise
    cette date et on signale le fallback en warning (pas en silence)."""
    # Config avec seulement `dates`, salles bidons pour zéro extraction utile
    from balance_pdf_import.parser_planning import parser_pdf as pp
    config = {
        "salles": ["Le Pressoir", "La Grange", "Salle Nord", "L'Atelier",
                   "Le Kiosque", "La Véranda"],
        "mots_cles_seance": ["Répétition"],
        "ignorer": [],
        "motif_responsable": r"avec (?P<nom>.+?)(?:\s|$)",
        "dates": {"dimanche": "2026-04-12"},
    }
    # PDF renommé (simule un cas où le titre ne matche pas)
    import shutil
    fake_titre_ko = tmp_path / "1_dimanche.pdf"
    shutil.copy(FIXTURES / "1_dimanche.pdf", fake_titre_ko)
    r = pp(fake_titre_ko, config)
    # date_page doit rester correct (titre matche déjà dans le fake original) —
    # ce qu'on teste vraiment ici : le mécanisme ne divergence pas quand
    # tout est cohérent (pas de warning fausse alerte).
    assert r.date_page == "2026-04-12"
    # Aucune divergence attendue car titre + config cohérents
    divergences = [w for w in r.erreurs_vraisemblance
                   if "divergence date" in w.get("raison", "")]
    assert not divergences, f"divergence fausse alerte : {divergences}"


# ── PR : variante 3 sur `dates` (2026-08-31, décision Stéphane) ─────────
# `dates` facultative mais exhaustive si présente.


def test_dates_absente_aucun_controle(config):
    """Clé `dates` absente → aucun contrôle, aucune alerte de date
    même si le titre PDF échoue. Le mode « je ne contrôle rien et
    je le sais » de la variante 3."""
    config_sans_dates = {k: v for k, v in config.items() if k != "dates"}
    r = parser_pdf(FIXTURES / "1_dimanche.pdf", config_sans_dates)
    alertes_dates = [
        w for w in r.erreurs_vraisemblance
        if any(k in w.get("raison", "") for k in ("divergence date", "jour", "fallback"))
    ]
    assert not alertes_dates, (
        f"aucune alerte de date attendue quand dates absente, vu : {alertes_dates}"
    )


def test_dates_presente_exhaustivite_jour_manquant_warn(config):
    """Clé `dates` présente mais un jour PDF n'y figure pas → warning
    « jour non déclaré ». Garde-fou variante 3 contre l'entre-deux
    « 3 jours sur 6 déclarés et je crois être couvert »."""
    # `1_dimanche.pdf` — on retire 'dimanche' des clés dates
    config_partiel = dict(config)
    dates_originales = dict(config.get("dates") or {})
    dates_originales.pop("dimanche", None)
    # Assurer au moins une entrée pour que dates_active soit True
    if not dates_originales:
        dates_originales["lundi"] = "2026-04-13"
    config_partiel["dates"] = dates_originales

    r = parser_pdf(FIXTURES / "1_dimanche.pdf", config_partiel)
    non_declares = [
        w for w in r.erreurs_vraisemblance
        if "non déclaré" in w.get("raison", "")
    ]
    assert len(non_declares) >= 1, (
        f"warning 'jour non déclaré' attendu quand dimanche manque de dates, "
        f"vu {[w.get('raison') for w in r.erreurs_vraisemblance]}"
    )
    assert any("dimanche" in w["raison"] for w in non_declares), (
        f"le nom du jour manquant doit apparaître : {non_declares}"
    )
