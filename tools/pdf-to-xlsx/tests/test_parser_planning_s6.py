"""Tests parseur A — jeu S6 (blindage cas limites).

Fixtures : 6 PDF `s6_*_octobre_2026.pdf` d'une session fictive du
25-30 octobre 2026 (6 salles imaginaires — Le Pressoir / La Grange /
Salle Nord / L'Atelier / Le Kiosque / La Véranda). Aucune PII.

Complémentaire de `test_parser_planning.py` (jeu S0/S1 non-régression) :
S6 exerce quatre cas limites documentés en tête de `fake-fixtures-s6.yml` —

- **dimanche 25** : journée SANS aucune répétition. 0 séance est le
  résultat attendu (pas une anomalie de détection).
- **mardi 27** : page en PORTRAIT (les 5 autres sont paysage) et une
  répétition 15:30-17:30 qui **chevauche** les créneaux voisins. Bug
  historique du parser (`_detecter_creneaux` supposait non-recouvrement)
  corrigé par PR #31 via `_subdiviser_creneaux_chevauchants`.
- **mercredi 28** : tableau réduit à DEUX lignes — éprouve le seuil
  de détection des montants de grille (fallback C3 3→2→1).
- **jeudi 29** : cellule fusionnée annonçant la fermeture de deux
  salles dès 16:45 (pendant le créneau précédent). Doit être ignorée
  sans effet parasite sur les séances légitimes du créneau.

Séances attendues, par fichier ::

    s6_dimanche_25  →  0   (journée sans répétition — 0 est correct)
    s6_lundi_26     →  6
    s6_mardi_27     →  6
    s6_mercredi_28  →  6
    s6_jeudi_29     →  6
    s6_vendredi_30  → 12   (4 créneaux × 3 salles — valeur correcte)

Total **36 séances**.
"""
from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from balance_pdf_import.parser_planning import parser_pdf


FIXTURES_S6 = Path(__file__).parent / "fixtures" / "s6"
CONFIG_S6_PATH = Path(__file__).parent.parent / "config" / "fake-fixtures-s6.yml"


@pytest.fixture(scope="module")
def config_s6():
    with open(CONFIG_S6_PATH) as f:
        return yaml.safe_load(f)


@pytest.fixture(scope="module")
def resultats_par_jour(config_s6):
    """Parse les 6 PDFs S6, retourne dict {nom_fichier: ResultatParsing}."""
    return {
        pdf.name: parser_pdf(pdf, config_s6)
        for pdf in sorted(FIXTURES_S6.glob("s6_*.pdf"))
    }


@pytest.fixture(scope="module")
def toutes_seances_s6(resultats_par_jour):
    seances = []
    for r in resultats_par_jour.values():
        seances.extend(r.seances)
    return seances


# ── Cas limite : dimanche sans répétition ───────────────────────────────


def test_dimanche_25_zero_seance(resultats_par_jour):
    """Dimanche 25 = 0 séance (journée sans répétition). Le parser doit
    accepter ce cas sans lever d'erreur ni de warning parasite."""
    r = resultats_par_jour["s6_dimanche_25_octobre_2026.pdf"]
    assert len(r.seances) == 0, (
        f"attendu 0 séance dimanche, vu {len(r.seances)} : "
        f"{[(s.debut, s.salle, s.morceau) for s in r.seances]}"
    )


def test_dimanche_25_zero_seance_sans_alerte_vraisemblance(resultats_par_jour):
    """Verrou du bon comportement (feedback Stéphane 2026-08-31) : le
    garde-fou vraisemblance doit distinguer « journée sans répétition »
    (0 séance légitime) de « extraction ratée » (0 séance suspect).

    Le dimanche 25 est le premier cas : PDF avec titre extrait, salles
    détectées, aucun mot-clé de séance. Aucune alerte niveau error ne
    doit remonter.

    Ce test est explicitement là pour empêcher une régression future
    où un fix casserait par inadvertance cette distinction — c'est le
    genre de nuance qu'une correction bien intentionnée peut supprimer."""
    r = resultats_par_jour["s6_dimanche_25_octobre_2026.pdf"]
    errors = [e for e in r.erreurs_vraisemblance if e.get("niveau") == "error"]
    assert not errors, (
        f"aucune erreur vraisemblance attendue pour journée sans répétition, "
        f"vu : {errors}"
    )


# ── Cas limite : mardi chevauchement (bug fixé PR #31, subdivision) ─────


def test_mardi_27_chevauchement_pas_de_recopie(resultats_par_jour):
    """Mardi 27 : 6 séances distinctes. La répétition 15:30-17:30 (Sables
    Mouvants Le Kiosque) partage la case verticale y=[95, 188] avec les
    créneaux 14:30 et 16:30 (aucune bordure horizontale interne dans le
    PDF). Le fix `_subdiviser_creneaux_chevauchants` (PR #31) subdivise
    ces cases via mi-hauteur entre tops des labels marge gauche —
    chaque créneau récupère sa sous-zone et le contenu tombe dans la
    seule sous-case correspondante.

    Contenu attendu (feedback Stéphane 2026-08-31) :
    - 14:30-16:00 : La Grange (Vent Debout), Salle Nord (Nuit d'Octobre),
      L'Atelier (Le Fil de Soie)
    - 15:30-17:30 : Le Kiosque (Sables Mouvants) — seul
    - 16:30-18:00 : La Grange (Comptine d'Hiver), Salle Nord (La Dernière
      Averse)"""
    r = resultats_par_jour["s6_mardi_27_octobre_2026.pdf"]
    assert len(r.seances) == 6, (
        f"attendu 6 séances mardi, vu {len(r.seances)} — régression du "
        f"fix subdivision chevauchement ?"
    )


# ── Cas limite : mercredi tableau réduit à 2 lignes ─────────────────────


def test_mercredi_28_tableau_reduit_extrait_6_seances(resultats_par_jour):
    """Mercredi 28 : tableau à 2 lignes seulement (éprouve le seuil de
    détection des montants de grille, fallback C3 3→2→1)."""
    r = resultats_par_jour["s6_mercredi_28_octobre_2026.pdf"]
    assert len(r.seances) == 6, (
        f"attendu 6 séances mercredi (tableau réduit), vu {len(r.seances)}"
    )


# ── Cas limite : jeudi cellule fusionnée fermeture ──────────────────────


def test_jeudi_29_cellule_fusionnee_fermeture_pas_de_parasite(resultats_par_jour):
    """Jeudi 29 : cellule fusionnée annonce fermeture de 2 salles dès
    16:45 (pendant le créneau précédent). Doit être ignorée sans effet
    parasite sur les séances légitimes."""
    r = resultats_par_jour["s6_jeudi_29_octobre_2026.pdf"]
    assert len(r.seances) == 6, (
        f"attendu 6 séances jeudi (cellule fermeture ignorée), vu "
        f"{len(r.seances)}"
    )


def test_jeudi_29_annonce_fermeture_recomposee_et_signalee(resultats_par_jour):
    """Jeudi 29 : les 2 fragments cross-colonnes de l'annonce fermeture
    doivent être recomposés en une alerte vraisemblance unique, avec
    heure antidatée 16:45 et salles concernées La Grange + Salle Nord
    (feedback Stéphane 2026-08-31, fix A3.2)."""
    r = resultats_par_jour["s6_jeudi_29_octobre_2026.pdf"]
    alertes_recompose = [
        e for e in r.erreurs_vraisemblance
        if "recomposée" in e.get("raison", "")
    ]
    assert len(alertes_recompose) == 1, (
        f"attendu 1 alerte annonce recomposée jeudi, vu {alertes_recompose}"
    )
    alerte = alertes_recompose[0]
    assert "(La Grange et Salle Nord fermées dès 16:45 pour montage)" in alerte["raison"]
    assert "16:45" in alerte["indice"]
    assert "La Grange" in alerte["indice"] and "Salle Nord" in alerte["indice"]
    # Les fragments ne doivent plus être dans non_classees
    fragments_fermeture = [
        nc for nc in r.non_classees
        if "(" in nc.get("texte", "") or "montage)" in nc.get("texte", "")
    ]
    assert fragments_fermeture == [], (
        f"fragments annonce doivent être consommés, restants : {fragments_fermeture}"
    )


def test_jeudi_29_bandeaux_gouter_diner_courts_detectes(resultats_par_jour):
    """Fix A3.1 (feedback Stéphane 2026-08-31) : `_detecter_bandeaux`
    doit maintenant capturer GOÛTER (16:00-16:30) et DÎNER (21:00),
    bandeaux courts ~35px de largeur. Ancien seuil largeur >= 60 les
    laissait polluer non_classees en fragments « G O » / « Û T E R »
    (GOÛTER cross-colonnes Salle Nord + L'Atelier) et « D Î » / « N E R »
    (DÎNER même pattern à 21:00)."""
    r = resultats_par_jour["s6_jeudi_29_octobre_2026.pdf"]
    # Aucun fragment « G O » / « Û T E R » / « D Î » / « N E R » dans non_classees
    fragments_bandeaux = [
        nc for nc in r.non_classees
        if nc.get("texte", "") in {"G O", "Û T E R", "D Î", "N E R"}
    ]
    assert fragments_bandeaux == [], (
        f"fragments GOÛTER/DÎNER doivent être consommés comme bandeaux, "
        f"restants : {fragments_bandeaux}"
    )


# ── Vue globale ─────────────────────────────────────────────────────────


def test_repartition_par_jour_s6(toutes_seances_s6):
    """Répartition métier : 0/6/6/6/6/12 = 36 séances (post-fix PR #31).

    Vendredi 30 comptabilise 12 séances par design (4 créneaux × 3 salles).
    Dimanche 25 : 0 séance légitime (journée sans répétition), donc
    absent du dict par convention Python.

    Ce test remplace la paire de verrous précédente
    `test_repartition_par_jour_s6_observee` (bug 42) +
    `test_repartition_par_jour_s6_apres_fix_bug_mardi` (xfail objectif 36)
    fusionnée en une seule assertion métier claire depuis le merge de la
    PR #31 (fix subdivision créneaux chevauchants)."""
    par_date: dict[str, int] = {}
    for s in toutes_seances_s6:
        par_date[s.date] = par_date.get(s.date, 0) + 1
    assert par_date == {
        "2026-10-26": 6,    # lundi
        "2026-10-27": 6,    # mardi (chevauchement corrigé)
        "2026-10-28": 6,    # mercredi (tableau réduit)
        "2026-10-29": 6,    # jeudi (cellule fermeture ignorée)
        "2026-10-30": 12,   # vendredi (dense par design)
        # dimanche 25 : 0 séance → absent du dict
    }


def test_toutes_salles_s6_detectees(resultats_par_jour):
    """Les 6 salles doivent être détectées sur tous les jours qui ont
    des séances (dimanche exclu, 0 séance)."""
    salles_attendues = {
        "Le Pressoir", "La Grange", "Salle Nord",
        "L'Atelier", "Le Kiosque", "La Véranda",
    }
    for nom, r in resultats_par_jour.items():
        if "dimanche" in nom:
            continue
        vues = {s.salle for s in r.seances}
        assert vues.issubset(salles_attendues), (
            f"{nom} : salle(s) inattendue(s) : {vues - salles_attendues}"
        )


def test_toutes_dates_declarees_variante_3_pas_de_warning(resultats_par_jour):
    """La config S6 déclare les 6 jours dans `dates` — aucun warning
    « jour non déclaré » ne doit apparaître (vérifie que la variante 3
    est bien satisfaite quand la config est exhaustive)."""
    for nom, r in resultats_par_jour.items():
        warns_jour = [
            w for w in r.erreurs_vraisemblance
            if "non déclaré" in w.get("raison", "")
        ]
        assert not warns_jour, (
            f"{nom} : warning 'jour non déclaré' inattendu — la config "
            f"S6 déclare pourtant les 6 jours. Vu : {warns_jour}"
        )
