"""CLI `balance-pdf-import` — convertit N plannings PDF en 1 xlsx + audit."""
from __future__ import annotations

import sys
from pathlib import Path

import click
import yaml

from .audit import TraceFichier, ecrire_audit
from .parser_planning import ResultatParsing, parser_pdf
from .writer_xlsx import ecrire_xlsx


def est_config_demo(config_path: Path) -> bool:
    """Détecte si la config chargée est celle de démonstration
    (`fake-fixtures*.yml` embarqué dans le bundle PyInstaller ou dans
    le repo dev).

    Motivation A1 audit : la GUI charge silencieusement fake-fixtures.yml
    comme défaut, si l'user oublie de charger sa propre config ses PDFs
    réels donnent 0 séance (salles ne matchent pas) et l'audit produit
    un rapport apparent-mais-faux. On rend l'usage démo explicite.

    Pattern préfixe (`startswith("fake-fixtures")`) plutôt qu'égalité
    exacte : couvre `fake-fixtures.yml` (jeu S0/S1) ET `fake-fixtures-s6.yml`
    (jeu S6 blindage), livrés côte à côte dans le repo. Tout futur jeu
    de test devra suivre la même convention de nommage.
    """
    return config_path.name.startswith("fake-fixtures") and config_path.suffix in {".yml", ".yaml"}


@click.command()
@click.option("--config", "config_path", required=True, type=click.Path(exists=True, path_type=Path),
              help="Fichier YAML de config (mots-clés, ignorer, salles attendues).")
@click.option("--pdf", "pdfs", multiple=True, type=click.Path(exists=True, path_type=Path),
              help="PDF(s) planning à importer. Passer plusieurs fois pour importer "
                   "plusieurs jours. Alternative : --pdf-dir pour un dossier complet.")
@click.option("--pdf-dir", "pdf_dir", type=click.Path(exists=True, file_okay=False, path_type=Path),
              help="Dossier contenant les PDFs à importer — tous les *.pdf sont pris "
                   "récursivement, triés par nom. Combinable avec --pdf.")
@click.option("--out", "out_xlsx", required=True, type=click.Path(path_type=Path),
              help="Fichier xlsx de sortie (format import Balance).")
@click.option("--audit", "out_audit", type=click.Path(path_type=Path),
              help="Fichier texte du rapport d'audit. Par défaut : <out>.audit.txt")
@click.option("--verbose", "-v", is_flag=True, help="Affiche le résumé par PDF sur stderr.")
@click.option("--autoriser-zero-seance", is_flag=True,
              help="Produit un xlsx même si 0 séance extraite (défaut : refuse — fix A1).")
def main(config_path: Path, pdfs: tuple[Path, ...], pdf_dir: Path | None,
         out_xlsx: Path, out_audit: Path | None, verbose: bool,
         autoriser_zero_seance: bool) -> None:
    """Convertit les planning PDF de l'organisateur Musiques Festives en xlsx
    d'import Balance."""
    with open(config_path) as f:
        config = yaml.safe_load(f)

    tous_pdfs = sorted(pdfs, key=lambda p: p.name)
    if pdf_dir:
        # On ne re-trie pas l'union pour préserver l'ordre user si --pdf explicites.
        tous_pdfs = tous_pdfs + sorted(pdf_dir.rglob("*.pdf"), key=lambda p: p.name)
    if not tous_pdfs:
        raise click.UsageError("Aucun PDF fourni — utiliser --pdf ou --pdf-dir.")

    demo = est_config_demo(config_path)
    if demo:
        print(
            "⚠️  MODE DÉMONSTRATION — config fake-fixtures.yml chargée. "
            "Les PDFs fournis ne matcheront probablement pas les salles attendues.",
            file=sys.stderr,
        )

    resultat_global = ResultatParsing()
    fichiers_traites: list[TraceFichier] = []
    for pdf in tous_pdfs:
        r = parser_pdf(pdf, config)
        # Annote chaque erreur de vraisemblance avec le nom du fichier pour
        # que le rapport d'audit puisse pointer précisément le PDF fautif.
        for err in r.erreurs_vraisemblance:
            err.setdefault("fichier", pdf.name)
        fichiers_traites.append(TraceFichier(
            nom=pdf.name,
            chemin=str(pdf),
            pages=r.nb_pages,
            seances=len(r.seances),
            date_detectee=r.date_page,
        ))
        if verbose:
            marqueur = ""
            if r.erreurs_vraisemblance:
                errs = sum(1 for e in r.erreurs_vraisemblance if e["niveau"] == "error")
                warns = sum(1 for e in r.erreurs_vraisemblance if e["niveau"] == "warning")
                marqueur = f" ⚠  {errs} erreur(s) + {warns} warning(s) vraisemblance"
            print(f"  {pdf.name:35s} pages={r.nb_pages} séances={len(r.seances):3d} "
                  f"non-classées={len(r.non_classees)}{marqueur}", file=sys.stderr)
        resultat_global.seances.extend(r.seances)
        resultat_global.ignorees.extend(r.ignorees)
        resultat_global.non_classees.extend(r.non_classees)
        resultat_global.erreurs_vraisemblance.extend(r.erreurs_vraisemblance)

    # Fix A1 : refuse produire un xlsx vide si l'user a fourni des PDFs.
    # Un échec bruyant vaut mieux qu'un résultat plausible et faux.
    if len(resultat_global.seances) == 0 and not autoriser_zero_seance:
        # On produit quand même l'audit — il contient le décompte par fichier,
        # utile pour diagnostiquer (« 6 PDFs lus, 0 séance = config
        # incompatible ? bonne config chargée ? »).
        audit_path = out_audit or out_xlsx.with_suffix(".audit.txt")
        ecrire_audit(
            resultat_global,
            audit_path,
            fichiers_traites=fichiers_traites,
            config_est_demo=demo,
            config_chemin=str(config_path),
        )
        print(
            f"❌ 0 séance extraite sur {len(tous_pdfs)} PDF(s) — xlsx non produit.\n"
            f"   Rapport d'audit écrit : {audit_path}\n"
            f"   Cause probable : la config chargée ({config_path.name}) ne matche pas les PDFs.\n"
            f"   Pour forcer la production d'un xlsx vide : --autoriser-zero-seance",
            file=sys.stderr,
        )
        raise click.exceptions.Exit(code=2)

    ecrire_xlsx(resultat_global.seances, out_xlsx)
    audit_path = out_audit or out_xlsx.with_suffix(".audit.txt")
    ecrire_audit(
        resultat_global,
        audit_path,
        fichiers_traites=fichiers_traites,
        config_est_demo=demo,
        config_chemin=str(config_path),
    )

    print(f"✅ {len(resultat_global.seances)} séances → {out_xlsx}", file=sys.stderr)
    print(f"📋 rapport d'audit → {audit_path}", file=sys.stderr)
    if resultat_global.non_classees:
        print(f"⚠️  {len(resultat_global.non_classees)} cellules non classées "
              f"(voir rapport)", file=sys.stderr)


if __name__ == "__main__":
    main()
