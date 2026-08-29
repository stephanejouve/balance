"""Rapport d'audit — accompagne le xlsx produit, liste les éléments qui
demandent une relecture humaine.

Non négociable (brief §6) :
- blocs non classés (texte reconnu mais aucune règle ne matche)
- séances sans heure de fin
- titres dans `Proposés` absents de `Liste`, et inverse
- collisions salle × créneau
"""
from __future__ import annotations

from collections import Counter
from pathlib import Path

from .parser_planning import ResultatParsing, Seance


def _collisions_salle_creneau(seances: list[Seance]) -> list[tuple[str, str, str, list[str]]]:
    """Retourne (date, salle, creneau_label, [morceaux]) où plus d'une séance
    occupe la même salle au même créneau."""
    par_slot: dict[tuple[str, str, str], list[str]] = {}
    for s in seances:
        cle = (s.date, s.salle, f"{s.debut}-{s.fin or '?'}")
        par_slot.setdefault(cle, []).append(s.morceau)
    return [(d, s, c, m) for (d, s, c), m in par_slot.items() if len(m) > 1]


def ecrire_audit(resultat: ResultatParsing, chemin_sortie: Path) -> None:
    lignes: list[str] = []
    lignes.append("═" * 70)
    lignes.append("RAPPORT D'AUDIT — balance-pdf-import")
    lignes.append("═" * 70)
    lignes.append("")

    lignes.append(f"Séances extraites          : {len(resultat.seances)}")
    lignes.append(f"Cellules ignorées          : {len(resultat.ignorees)}")
    lignes.append(f"Cellules non classées      : {len(resultat.non_classees)}")

    sans_fin = [s for s in resultat.seances if not s.fin]
    lignes.append(f"Séances sans heure de fin  : {len(sans_fin)}")

    collisions = _collisions_salle_creneau(resultat.seances)
    lignes.append(f"Collisions salle × créneau : {len(collisions)}")
    lignes.append("")

    if sans_fin:
        lignes.append("─── Séances sans heure de fin ─────────────────────────────────────")
        for s in sans_fin:
            lignes.append(f"  {s.date} {s.debut}-? {s.salle} « {s.morceau} »")
        lignes.append("")

    if collisions:
        lignes.append("─── Collisions salle × créneau ─────────────────────────────────────")
        for d, s, c, ms in collisions:
            lignes.append(f"  {d} {s} {c} : {', '.join(ms)}")
        lignes.append("")

    if resultat.non_classees:
        lignes.append("─── Cellules non classées (aucun mot-clé reconnu) ───────────────────")
        for nc in resultat.non_classees:
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
        for raison, n in cpt.most_common():
            lignes.append(f"  {n:3d} × {raison}")
        lignes.append("")

    lignes.append("─── Détail des séances extraites ────────────────────────────────────")
    for s in sorted(resultat.seances, key=lambda s: (s.date, s.debut, s.salle)):
        resp = f" ({s.responsable})" if s.responsable else ""
        lignes.append(f"  {s.date} {s.debut}-{s.fin or '?'} {s.salle:14s} « {s.morceau} »{resp}")

    chemin_sortie.write_text("\n".join(lignes) + "\n", encoding="utf-8")
