"""Rapport d'audit — accompagne le xlsx produit, liste les éléments qui
demandent une relecture humaine.

Non négociable (brief §6) :
- blocs non classés (texte reconnu mais aucune règle ne matche)
- séances sans heure de fin
- titres dans `Proposés` absents de `Liste`, et inverse
- collisions salle × créneau

Doctrine post-audit Stéphane (2026-08-30) : « un import qui perd des
données sans le dire est pire qu'un import qui échoue ». Le rapport
doit être **déterministe** (mêmes entrées → mêmes octets — pour pouvoir
comparer 2 exécutions au hachage), **complet** (tout ce qui n'est pas
compris apparaît, avec la cellule d'origine), et **explicite** sur ce
qui a été traité (fichiers réellement lus, avec compteurs par fichier).
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from pathlib import Path

from .parser_planning import ResultatParsing, Seance


@dataclass
class TraceFichier:
    """Empreinte d'un fichier PDF traité — écrite en tête du rapport
    pour permettre à l'user de constater immédiatement quels fichiers
    ont été lus, combien de pages, combien de séances extraites.

    Motivation A1 audit : trois exécutions Stéphane avec 3 corpus
    différents ont produit des rapports au hachage identique parce
    qu'aucun log ne permettait de vérifier ce qui avait vraiment été
    ouvert. Cette trace supprime cette classe de bug.
    """
    nom: str
    chemin: str
    pages: int
    seances: int
    date_detectee: str | None


def _collisions_salle_creneau(seances: list[Seance]) -> list[tuple[str, str, str, list[str]]]:
    """Retourne (date, salle, creneau_label, [morceaux]) où plus d'une séance
    occupe la même salle au même créneau. Tri déterministe."""
    par_slot: dict[tuple[str, str, str], list[str]] = {}
    for s in seances:
        cle = (s.date, s.salle, f"{s.debut}-{s.fin or '?'}")
        par_slot.setdefault(cle, []).append(s.morceau)
    return sorted(
        ((d, s, c, sorted(m)) for (d, s, c), m in par_slot.items() if len(m) > 1),
    )


def _compter_par_morceau(seances: list[Seance]) -> list[tuple[str, int]]:
    """Compte les séances par morceau, tri décroissant puis alpha."""
    cpt = Counter(s.morceau for s in seances)
    return sorted(cpt.items(), key=lambda kv: (-kv[1], kv[0]))


def ecrire_audit(
    resultat: ResultatParsing,
    chemin_sortie: Path,
    fichiers_traites: list[TraceFichier] | None = None,
    config_est_demo: bool = False,
    config_chemin: str | None = None,
) -> None:
    """Écrit le rapport d'audit. Doctrine « déterministe + complet + explicite ».

    :param resultat: agrégat de tous les PDFs parsés.
    :param chemin_sortie: fichier .audit.txt à créer.
    :param fichiers_traites: liste ordonnée des PDFs réellement ouverts
        (avec pages + séances par fichier). Journalisé en tête du rapport.
    :param config_est_demo: si vrai, un bandeau MODE DÉMONSTRATION apparaît
        en tout début de rapport (fix A1 : distinguer démonstration et
        traitement réel).
    :param config_chemin: chemin du YAML utilisé — affiché pour trace.
    """
    lignes: list[str] = []

    if config_est_demo:
        lignes.append("!" * 70)
        lignes.append("!  MODE DÉMONSTRATION — la configuration chargée est fake-fixtures  !")
        lignes.append("!  Les salles / mots-clés attendus ne correspondent pas à une vraie  !")
        lignes.append("!  session ; toute divergence avec les PDFs fournis produit 0 séance.  !")
        lignes.append("!" * 70)
        lignes.append("")

    lignes.append("═" * 70)
    lignes.append("RAPPORT D'AUDIT — balance-pdf-import")
    lignes.append("═" * 70)
    lignes.append("")

    if config_chemin:
        lignes.append(f"Config chargée   : {config_chemin}")
    if fichiers_traites is not None:
        lignes.append(f"Fichiers traités : {len(fichiers_traites)}")
    lignes.append(f"Séances extraites          : {len(resultat.seances)}")
    lignes.append(f"Cellules ignorées          : {len(resultat.ignorees)}")
    lignes.append(f"Cellules non classées      : {len(resultat.non_classees)}")
    if resultat.erreurs_vraisemblance:
        nb_err = sum(1 for e in resultat.erreurs_vraisemblance if e["niveau"] == "error")
        nb_warn = sum(1 for e in resultat.erreurs_vraisemblance if e["niveau"] == "warning")
        lignes.append(
            f"Alertes vraisemblance      : {len(resultat.erreurs_vraisemblance)} "
            f"({nb_err} erreur(s), {nb_warn} warning(s))"
        )

    sans_fin = [s for s in resultat.seances if not s.fin]
    # Nb séances sans fin réelles (dans la sortie) + nb séances écartées
    # pour fin manquante (dans non_classees). Le total « fin manquante »
    # doit couvrir les deux — fix A4.
    fins_manquantes_non_classees = [
        nc for nc in resultat.non_classees if nc.get("raison") == "fin manquante"
    ]
    lignes.append(
        f"Séances sans heure de fin  : "
        f"{len(sans_fin) + len(fins_manquantes_non_classees)} "
        f"({len(sans_fin)} extraites, {len(fins_manquantes_non_classees)} écartées)"
    )

    collisions = _collisions_salle_creneau(resultat.seances)
    lignes.append(f"Collisions salle × créneau : {len(collisions)}")
    lignes.append("")

    if resultat.erreurs_vraisemblance:
        # Fix garde-fou vraisemblance (audit Stéphane + Claude Desktop 2026-08-30) :
        # PDF non-vide mais l'extraction n'a rien produit d'attendu (0 salle,
        # 0 créneau, pas de date). Le rapport doit rendre ça immédiatement
        # visible — c'est ce qui aurait évité les 3 exécutions à l'aveugle.
        lignes.append("─── ⚠  Alertes vraisemblance (PDF non-vide, extraction suspecte) ──")
        for err in sorted(
            resultat.erreurs_vraisemblance,
            key=lambda e: (e.get("fichier") or "", e.get("page", 0), e.get("raison") or ""),
        ):
            fichier = err.get("fichier", "?")
            page = err.get("page", "?")
            niveau = err.get("niveau", "?").upper()
            raison = err.get("raison", "?")
            indice = err.get("indice", "")
            lignes.append(f"  [{niveau}] {fichier} page {page} : {raison}")
            if indice:
                lignes.append(f"           indice : {indice}")
        lignes.append("")

    if fichiers_traites:
        lignes.append("─── Fichiers PDF traités ────────────────────────────────────────────")
        total_seances = sum(f.seances for f in fichiers_traites)
        for f in fichiers_traites:
            date = f.date_detectee or "?"
            lignes.append(
                f"  {f.nom:35s} pages={f.pages} séances={f.seances:3d} date={date}"
            )
        lignes.append(
            f"  {'TOTAL':35s} pages={sum(f.pages for f in fichiers_traites)} "
            f"séances={total_seances}"
        )
        lignes.append("")

    if sans_fin or fins_manquantes_non_classees:
        lignes.append("─── Séances sans heure de fin ─────────────────────────────────────")
        for s in sorted(sans_fin, key=lambda s: (s.date, s.debut, s.salle)):
            lignes.append(f"  {s.date} {s.debut}-? {s.salle} « {s.morceau} » (conservée)")
        for nc in sorted(
            fins_manquantes_non_classees,
            key=lambda nc: (nc.get("date", ""), nc.get("creneau", ""), nc.get("salle", "")),
        ):
            date = nc.get("date", "?")
            creneau = nc.get("creneau", "?")
            salle = nc.get("salle", "?")
            texte = nc.get("texte", "")[:80]
            lignes.append(f"  {date} {creneau} {salle} « {texte} » (écartée)")
        lignes.append("")

    if collisions:
        lignes.append("─── Collisions salle × créneau ─────────────────────────────────────")
        for d, s, c, ms in collisions:
            lignes.append(f"  {d} {s} {c} : {', '.join(ms)}")
        lignes.append("")

    if resultat.non_classees:
        lignes.append("─── Cellules non classées (aucun mot-clé reconnu) ───────────────────")
        # Tri déterministe : par date, créneau, salle, texte (fix A2).
        non_classees_triees = sorted(
            resultat.non_classees,
            key=lambda nc: (
                nc.get("date") or "",
                nc.get("creneau") or "",
                nc.get("salle") or "",
                nc.get("texte") or "",
            ),
        )
        for nc in non_classees_triees:
            date = nc.get("date", "?")
            creneau = nc.get("creneau", "?")
            salle = nc.get("salle", "?")
            texte = nc.get("texte", "")[:80]
            raison = nc.get("raison", "?")
            lignes.append(f"  {date} {creneau} {salle:14s} [{raison}] « {texte} »")
        lignes.append("")

    if resultat.ignorees:
        lignes.append("─── Cellules ignorées volontairement (config) ──────────────────────")
        cpt = Counter(ig["raison"] for ig in resultat.ignorees)
        # Tri déterministe : par nb décroissant puis raison alpha.
        for raison, n in sorted(cpt.items(), key=lambda kv: (-kv[1], kv[0])):
            lignes.append(f"  {n:3d} × {raison}")
        lignes.append("")

    par_morceau = _compter_par_morceau(resultat.seances)
    if par_morceau:
        lignes.append("─── Comptage séances par morceau ───────────────────────────────────")
        for morceau, n in par_morceau:
            lignes.append(f"  {n:3d} × {morceau}")
        lignes.append("")

    lignes.append("─── Détail des séances extraites ────────────────────────────────────")
    for s in sorted(resultat.seances, key=lambda s: (s.date, s.debut, s.salle, s.morceau)):
        resp = f" ({s.responsable})" if s.responsable else ""
        lignes.append(f"  {s.date} {s.debut}-{s.fin or '?'} {s.salle:14s} « {s.morceau} »{resp}")

    chemin_sortie.write_text("\n".join(lignes) + "\n", encoding="utf-8")
