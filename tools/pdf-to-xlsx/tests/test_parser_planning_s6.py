"""Tests parseur A — jeu S6 (blindage cas limites).

Fixtures : 6 PDF `s6_*_octobre_2026.pdf` d'une session fictive du
25-30 octobre 2026 (6 salles imaginaires — Le Pressoir / La Grange /
Salle Nord / L'Atelier / Le Kiosque / La Véranda). Aucune PII.

Complémentaire de `test_parser_planning.py` (jeu S0/S1 non-régression) :
S6 exerce quatre cas limites documentés en tête de `fake-fixtures-s6.yml` —

- **dimanche 25** : journée SANS aucune répétition. 0 séance est le
  résultat attendu (pas une anomalie de détection).
- **mardi 27** : page en PORTRAIT (les 5 autres sont paysage) et une
  répétition 15:30-17:30 qui **CHEVAUCHE** les créneaux voisins. Bug
  connu du parser : `_detecter_creneaux` suppose non-recouvrement,
  le contenu est recopié → 12 séances au lieu de 6. Documenté ici
  en `xfail` strict pour verrouiller le bug avant fix.
- **mercredi 28** : tableau réduit à DEUX lignes — éprouve le seuil
  de détection des montants de grille (fallback C3 3→2→1).
- **jeudi 29** : cellule fusionnée annonçant la fermeture de deux
  salles dès 16:45 (pendant le créneau précédent). Doit être ignorée
  sans effet parasite sur les séances légitimes du créneau.

Séances attendues, par fichier (récap Stéphane 2026-08-31) ::

    s6_dimanche_25  →  0   (journée sans répétition — 0 est correct)
    s6_lundi_26     →  6
    s6_mardi_27     →  6   ⚠ le parser en sort 12 (bug chevauchement)
    s6_mercredi_28  →  6
    s6_jeudi_29     →  6
    s6_vendredi_30  → 12   (4 créneaux × 3 salles — valeur correcte)

Total attendu **36**. Total observé **42** tant que le chevauchement
n'est pas corrigé (verrouillé en `xfail` strict ci-dessous, à lever
quand la PR « chevauchements horaires » corrigera `_detecter_creneaux`).
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


# ── Cas limite : mardi chevauchement (BUG CONNU, xfail strict) ──────────


@pytest.mark.xfail(
    strict=True,
    reason="bug chevauchement créneaux — _detecter_creneaux suppose "
           "non-recouvrement, la répétition 15:30-17:30 est recopiée sur "
           "les créneaux 14:30-16:00 et 16:30-18:00 → 12 séances au lieu "
           "de 6. À fixer dans PR dédiée « chevauchements horaires ».",
)
def test_mardi_27_chevauchement_pas_de_recopie(resultats_par_jour):
    """Mardi 27 attendu 6 séances distinctes. Le parser en produit 12
    (recouvrement 15:30-17:30 recopié sur 2 créneaux adjacents).

    Détail du bug (Stéphane 2026-08-31) : les 4 mêmes lignes 15:30-17:30
    sont recopiées à l'identique sur les créneaux 14:30, 15:30 et 16:30 :

        15:30-17:30  L'Atelier    Le Fil de Soie
        15:30-17:30  La Grange    Vent Debout
        15:30-17:30  Le Kiosque   Sables Mouvants
        15:30-17:30  Salle Nord   Nuit d'Octobre

    Attendu : **une seule** ligne 15:30-17:30 (Sables Mouvants, Le Kiosque
    seul). Les morceaux « Comptine d'Hiver » et « La Dernière Averse »,
    présents à 16:30 sur la feuille, sont écrasés par la recopie et
    disparaissent complètement."""
    r = resultats_par_jour["s6_mardi_27_octobre_2026.pdf"]
    assert len(r.seances) == 6, (
        f"attendu 6 séances mardi, vu {len(r.seances)} — recopie "
        f"chevauchement créneaux"
    )


def test_mardi_27_produit_effectivement_12_seances(resultats_par_jour):
    """Verrouillage du bug actuel : documenter noir sur blanc que le
    parser sort 12 séances aujourd'hui. Retirer ce test en même temps
    que l'`xfail` ci-dessus quand le bug chevauchement sera fixé."""
    r = resultats_par_jour["s6_mardi_27_octobre_2026.pdf"]
    assert len(r.seances) == 12, (
        f"comportement observé attendu 12, vu {len(r.seances)} — si ce "
        f"test échoue, le bug chevauchement est peut-être fixé : "
        f"vérifier et migrer test_mardi_27_chevauchement_pas_de_recopie "
        f"en test normal."
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


# ── Vue globale ─────────────────────────────────────────────────────────


def test_repartition_par_jour_s6_observee(toutes_seances_s6):
    """Verrouille le comportement OBSERVÉ actuel du parser : 42 séances.

    Composition : 0/6/12/6/6/12 (dim/lun/mar/mer/jeu/ven) — mardi 12
    au lieu de 6 attendu à cause du bug chevauchement. Vendredi 12 est
    normal (par design du jeu S6, journée dense à double occupation).

    Ce test échouera *volontairement* le jour où le bug mardi sera fixé.
    Signal : migrer la valeur 12 → 6 pour mardi et supprimer le test
    complémentaire `test_repartition_par_jour_s6_apres_fix_bug_mardi`.
    """
    par_date: dict[str, int] = {}
    for s in toutes_seances_s6:
        par_date[s.date] = par_date.get(s.date, 0) + 1
    assert par_date == {
        "2026-10-26": 6,    # lundi
        "2026-10-27": 12,   # mardi (bug chevauchement, 6 attendu)
        "2026-10-28": 6,    # mercredi (tableau réduit)
        "2026-10-29": 6,    # jeudi (cellule fermeture)
        "2026-10-30": 12,   # vendredi (dense par design, pas un bug)
        # dimanche 25 : 0 séance → absent du dict
    }


@pytest.mark.xfail(
    strict=True,
    reason="bug chevauchement mardi actif — voir "
           "test_mardi_27_chevauchement_pas_de_recopie",
)
def test_repartition_par_jour_s6_apres_fix_bug_mardi(toutes_seances_s6):
    """Répartition ATTENDUE finale : 0/6/6/6/6/12 = 36 séances.

    Verrouille l'objectif métier (mardi doit sortir 6, pas 12). Passera
    au vert le jour où le bug chevauchement sera corrigé — à ce moment,
    retirer `test_repartition_par_jour_s6_observee` (verrouillage bug)
    et lever l'`xfail` ici."""
    par_date: dict[str, int] = {}
    for s in toutes_seances_s6:
        par_date[s.date] = par_date.get(s.date, 0) + 1
    assert par_date == {
        "2026-10-26": 6,    # lundi
        "2026-10-27": 6,    # mardi (chevauchement corrigé)
        "2026-10-28": 6,    # mercredi
        "2026-10-29": 6,    # jeudi
        "2026-10-30": 12,   # vendredi
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
