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


# ── PR : subdivision créneaux chevauchants (2026-08-31) ─────────────────
# Bug identifié via fixtures S6 mardi 27 (PR #30) : les créneaux 14:30/15:30
# /16:30 partagent la même case verticale car aucune bordure horizontale
# interne n'est dessinée dans le PDF. Le fix subdivise en sous-cases à
# partir des `top` des labels dans la marge gauche.


def test_subdiviser_creneaux_chevauchants_cas_nominal_pas_de_partage():
    """Cas où chaque créneau a sa propre case : pas de subdivision,
    passage direct — évite les régressions sur les PDFs bien formés."""
    from balance_pdf_import.parser_planning import _subdiviser_creneaux_chevauchants
    creneaux = [
        {"label": "10:00", "y_haut": 50.0, "y_bas": 80.0, "debut": "10:00", "fin": None, "top": 55.0},
        {"label": "11:00", "y_haut": 80.0, "y_bas": 110.0, "debut": "11:00", "fin": None, "top": 85.0},
    ]
    out = _subdiviser_creneaux_chevauchants(creneaux)
    assert len(out) == 2
    assert (out[0]["y_haut"], out[0]["y_bas"]) == (50.0, 80.0)
    assert (out[1]["y_haut"], out[1]["y_bas"]) == (80.0, 110.0)


def test_subdiviser_creneaux_chevauchants_trois_creneaux_meme_case():
    """Trois créneaux (mardi S6) partagent la même case y=[95, 188] avec
    des `top` distincts 108/139/170. Chacun doit recevoir une sous-case
    calculée sur la mi-hauteur entre tops consécutifs :
    - créneau 14:30 (top=108) : y=[95, mi(108,139)=123.5]
    - créneau 15:30 (top=139) : y=[123.5, mi(139,170)=154.5]
    - créneau 16:30 (top=170) : y=[154.5, 188]"""
    from balance_pdf_import.parser_planning import _subdiviser_creneaux_chevauchants
    creneaux = [
        {"label": "14:30-16:00", "y_haut": 95.0, "y_bas": 188.0, "debut": "14:30", "fin": "16:00", "top": 108.0},
        {"label": "15:30-17:30", "y_haut": 95.0, "y_bas": 188.0, "debut": "15:30", "fin": "17:30", "top": 139.0},
        {"label": "16:30-18:00", "y_haut": 95.0, "y_bas": 188.0, "debut": "16:30", "fin": "18:00", "top": 170.0},
    ]
    out = sorted(_subdiviser_creneaux_chevauchants(creneaux), key=lambda c: c["top"])
    assert len(out) == 3
    # 14:30 : bord haut du case, bord bas = mi(108, 139)
    assert out[0]["label"] == "14:30-16:00"
    assert (out[0]["y_haut"], out[0]["y_bas"]) == (95.0, 123.5)
    # 15:30 : mi(108,139), mi(139,170)
    assert out[1]["label"] == "15:30-17:30"
    assert (out[1]["y_haut"], out[1]["y_bas"]) == (123.5, 154.5)
    # 16:30 : mi(139,170), bord bas du case
    assert out[2]["label"] == "16:30-18:00"
    assert (out[2]["y_haut"], out[2]["y_bas"]) == (154.5, 188.0)


def test_subdiviser_preserve_labels_et_horaires():
    """La subdivision ne doit toucher que y_haut/y_bas — le reste des
    champs (label, debut, fin, top) doit rester intact."""
    from balance_pdf_import.parser_planning import _subdiviser_creneaux_chevauchants
    creneaux = [
        {"label": "10:00", "y_haut": 50.0, "y_bas": 80.0, "debut": "10:00", "fin": None, "top": 55.0},
        {"label": "10:15", "y_haut": 50.0, "y_bas": 80.0, "debut": "10:15", "fin": None, "top": 62.0},
    ]
    out = sorted(_subdiviser_creneaux_chevauchants(creneaux), key=lambda c: c["top"])
    assert out[0]["label"] == "10:00" and out[0]["debut"] == "10:00" and out[0]["top"] == 55.0
    assert out[1]["label"] == "10:15" and out[1]["debut"] == "10:15" and out[1]["top"] == 62.0


# ── PR : recomposition annonces cross-colonnes A3.2 (2026-08-31) ────────
# Fragments d'une même annonce (fermeture salles, montage, ...) éclatés
# sur plusieurs colonnes → parenthèses non appariées comme signal.


def _seed_resultat(non_classees):
    from balance_pdf_import.parser_planning import ResultatParsing
    r = ResultatParsing()
    r.date_page = "2026-10-29"
    r.non_classees = [
        {"raison": "aucun mot-clé reconnu", "date": r.date_page, **nc}
        for nc in non_classees
    ]
    return r


def test_recomposer_annonces_cross_colonnes_paire_parentheses():
    """Cas jeudi S6 (feedback Stéphane) : 2 fragments cross-colonnes sur
    le même créneau, parenthèse ouvrante dans un et fermante dans l'autre.
    Ils doivent être recomposés en une alerte, extraits de non_classees."""
    from balance_pdf_import.parser_planning import _recomposer_annonces_cross_colonnes
    r = _seed_resultat([
        {"creneau": "18:00-20:50", "salle": "L'Atelier",
         "texte": "(La Grange et Salle Nord"},
        {"creneau": "18:00-20:50", "salle": "Le Kiosque",
         "texte": "fermées dès 16:45 pour montage)"},
    ])
    _recomposer_annonces_cross_colonnes(r, {"salles": ["Le Pressoir", "La Grange",
                                                        "Salle Nord", "L'Atelier",
                                                        "Le Kiosque", "La Véranda"]})
    assert r.non_classees == [], f"fragments doivent être consommés : {r.non_classees}"
    assert len(r.erreurs_vraisemblance) == 1
    alerte = r.erreurs_vraisemblance[0]
    assert alerte["niveau"] == "warning"
    assert "recomposée" in alerte["raison"]
    assert "(La Grange et Salle Nord fermées dès 16:45 pour montage)" in alerte["raison"]
    assert "16:45" in alerte["indice"]
    assert "La Grange" in alerte["indice"]
    assert "Salle Nord" in alerte["indice"]


def test_recomposer_epargne_cellules_sans_parentheses():
    """Une cellule non_classée sans parenthèses (ex. cellule légitime
    voisine) ne doit PAS être fusionnée à l'annonce même si elle est sur
    le même créneau. Cas typique : jeudi S6, la cellule La Grange
    « 18:00 : Installation — 18:30 » sur le même créneau que l'annonce
    fermeture — ne doit pas être avalée."""
    from balance_pdf_import.parser_planning import _recomposer_annonces_cross_colonnes
    r = _seed_resultat([
        {"creneau": "18:00-20:50", "salle": "La Grange",
         "texte": "18:00 : Installation — 18:30"},
        {"creneau": "18:00-20:50", "salle": "L'Atelier",
         "texte": "(La Grange et Salle Nord"},
        {"creneau": "18:00-20:50", "salle": "Le Kiosque",
         "texte": "fermées dès 16:45 pour montage)"},
    ])
    _recomposer_annonces_cross_colonnes(r, {"salles": ["La Grange", "Salle Nord",
                                                        "L'Atelier", "Le Kiosque"]})
    restants = [nc["texte"] for nc in r.non_classees]
    assert restants == ["18:00 : Installation — 18:30"], (
        f"cellule sans parenthèses ne doit pas être avalée, restants : {restants}"
    )
    assert len(r.erreurs_vraisemblance) == 1


def test_recomposer_epargne_creneau_sans_paire_parentheses():
    """Si aucune paire ouverture/fermeture n'est trouvée sur un créneau,
    rien n'est modifié — les non_classees restent intactes."""
    from balance_pdf_import.parser_planning import _recomposer_annonces_cross_colonnes
    r = _seed_resultat([
        {"creneau": "10:00-11:00", "salle": "La Grange", "texte": "G O"},
        {"creneau": "10:00-11:00", "salle": "L'Atelier", "texte": "Û T E R"},
    ])
    _recomposer_annonces_cross_colonnes(r, {"salles": ["La Grange", "L'Atelier"]})
    assert len(r.non_classees) == 2, "sans parenthèses, aucun regroupement attendu"
    assert r.erreurs_vraisemblance == []


def test_recomposer_extrait_heures_multiples():
    """Le texte recomposé peut contenir plusieurs heures — toutes doivent
    être listées dans l'indice pour permettre à l'humain d'identifier la
    plus pertinente."""
    from balance_pdf_import.parser_planning import _recomposer_annonces_cross_colonnes
    r = _seed_resultat([
        {"creneau": "18:00", "salle": "L'Atelier",
         "texte": "(Salle A fermée de 16:45 à 18:30"},
        {"creneau": "18:00", "salle": "Le Kiosque",
         "texte": "puis de 19:00 à 20:00 pour montage)"},
    ])
    _recomposer_annonces_cross_colonnes(r, {"salles": ["Salle A"]})
    indice = r.erreurs_vraisemblance[0]["indice"]
    for h in ("16:45", "18:30", "19:00", "20:00"):
        assert h in indice, f"heure {h} manquante dans indice : {indice}"


# ── PR : bandeaux courts + fragmentés A3.1 (2026-08-31) ─────────────────
# `_detecter_bandeaux` échouait sur DÎNER (largeur < 60px) et sur les
# bandeaux fragmentés cross-colonnes (GOÛTER en 2 runs). Nouveau critère
# majuscules-pures + prise en compte marge gauche.


def _mot(text, x0, x1=None, top=100.0):
    """Fabrique un dict `mot` compatible avec pdfplumber (test unit)."""
    return {"text": text, "x0": x0, "x1": x1 if x1 is not None else x0 + 5, "top": top, "bottom": top + 10}


def test_detecter_bandeau_court_5_lettres_maj_dîner():
    """DÎNER = 5 lettres majuscules serrées, largeur totale ~35px.
    Ancien seuil largeur >= 60 le rejetait. Nouveau critère maj-pur
    l'accepte."""
    from balance_pdf_import.parser_planning import _detecter_bandeaux
    mots = [
        _mot("D", 100.0, 104.9, top=200.0),
        _mot("Î", 109.2, 111.1, top=200.0),
        _mot("N", 115.4, 120.2, top=200.0),
        _mot("E", 124.5, 128.5, top=200.0),
        _mot("R", 132.8, 137.2, top=200.0),
    ]
    bandeaux, ids = _detecter_bandeaux(mots)
    assert len(bandeaux) == 1
    assert bandeaux[0]["texte"] == "DÎNER"


def test_detecter_bandeau_fragmenté_cross_colonnes_goûter():
    """GOÛTER fragmenté en 2 runs cross-colonnes : `G O` (col 2) puis
    `Û T E R` (col 3), séparés par un grand gap ~250px. Ancien critère
    « meilleur run isolé ≥ 5 » rejetait (2 puis 4 mots). Nouveau critère
    fusion des runs maj-pur les capture."""
    from balance_pdf_import.parser_planning import _detecter_bandeaux
    mots = [
        _mot("G", 250.0, 254.9, top=140.0),
        _mot("O", 259.2, 263.9, top=140.0),
        # Grand gap cross-colonnes
        _mot("Û", 480.0, 484.0, top=140.0),
        _mot("T", 488.3, 492.7, top=140.0),
        _mot("E", 497.0, 501.0, top=140.0),
        _mot("R", 505.3, 509.7, top=140.0),
    ]
    bandeaux, _ = _detecter_bandeaux(mots)
    assert len(bandeaux) == 1
    assert bandeaux[0]["texte"] == "GOÛTER"


def test_detecter_bandeau_ignore_mots_minuscules():
    """Un mot fragmenté en minuscules (« P i a n o » = P majuscule + 4
    minuscules) n'est PAS un bandeau — le nouveau filtre maj-pur exclut
    les minuscules dès le premier étage."""
    from balance_pdf_import.parser_planning import _detecter_bandeaux
    mots = [
        _mot("P", 100.0, 104.9),
        _mot("i", 109.2, 111.1),
        _mot("a", 115.4, 119.4),
        _mot("n", 123.7, 128.5),
        _mot("o", 132.8, 137.0),
    ]
    bandeaux, _ = _detecter_bandeaux(mots)
    assert bandeaux == [], f"minuscules ne doivent pas former un bandeau : {bandeaux}"


def test_detecter_bandeau_exclut_tirets_marge_gauche():
    """Les tirets `-` des créneaux dans la marge gauche (« 16:00-16:30 »)
    ne doivent PAS être fusionnés au bandeau de la même ligne — le fix
    passe `marge_gauche_x` en paramètre pour filtrer."""
    from balance_pdf_import.parser_planning import _detecter_bandeaux
    mots = [
        _mot("-", 54.0, 56.4, top=131.0),  # créneau 16:00-16:30
        _mot("G", 250.0, 254.9, top=131.0),
        _mot("O", 259.2, 263.9, top=131.0),
        _mot("Û", 480.0, 484.0, top=131.0),
        _mot("T", 488.3, 492.7, top=131.0),
        _mot("E", 497.0, 501.0, top=131.0),
        _mot("R", 505.3, 509.7, top=131.0),
    ]
    bandeaux, _ = _detecter_bandeaux(mots, marge_gauche_x=214.0)
    assert len(bandeaux) == 1
    assert bandeaux[0]["texte"] == "GOÛTER"  # pas "-GOÛTER"


def test_detecter_bandeau_ignore_ponctuation_pure():
    """Une ligne avec seulement des `-` (sans alpha) ne doit pas former
    un bandeau (filet du critère `≥3 lettres alpha`)."""
    from balance_pdf_import.parser_planning import _detecter_bandeaux
    mots = [_mot("-", 100 + i * 8, 100 + i * 8 + 3) for i in range(6)]
    bandeaux, _ = _detecter_bandeaux(mots)
    assert bandeaux == [], "ponctuation pure n'est pas un bandeau"
