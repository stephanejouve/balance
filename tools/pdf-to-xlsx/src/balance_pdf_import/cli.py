"""CLI `balance-pdf-import` — convertit N plannings PDF en 1 xlsx + audit."""
from __future__ import annotations

import sys
from pathlib import Path

import click
import yaml

from .audit import ecrire_audit
from .parser_planning import ResultatParsing, parser_pdf
from .writer_xlsx import ecrire_xlsx


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
def main(config_path: Path, pdfs: tuple[Path, ...], pdf_dir: Path | None,
         out_xlsx: Path, out_audit: Path | None, verbose: bool) -> None:
    """Convertit les planning PDF de l'organisateur Musiques Festives en xlsx
    d'import Balance."""
    with open(config_path) as f:
        config = yaml.safe_load(f)

    tous_pdfs = list(pdfs)
    if pdf_dir:
        tous_pdfs.extend(sorted(pdf_dir.rglob("*.pdf")))
    if not tous_pdfs:
        raise click.UsageError("Aucun PDF fourni — utiliser --pdf ou --pdf-dir.")

    resultat_global = ResultatParsing()
    for pdf in tous_pdfs:
        r = parser_pdf(pdf, config)
        if verbose:
            print(f"  {pdf.name:35s} → {len(r.seances):3d} séances, "
                  f"{len(r.non_classees)} non-classées", file=sys.stderr)
        resultat_global.seances.extend(r.seances)
        resultat_global.ignorees.extend(r.ignorees)
        resultat_global.non_classees.extend(r.non_classees)

    ecrire_xlsx(resultat_global.seances, out_xlsx)
    audit_path = out_audit or out_xlsx.with_suffix(".audit.txt")
    ecrire_audit(resultat_global, audit_path)

    print(f"✅ {len(resultat_global.seances)} séances → {out_xlsx}", file=sys.stderr)
    print(f"📋 rapport d'audit → {audit_path}", file=sys.stderr)
    if resultat_global.non_classees:
        print(f"⚠️  {len(resultat_global.non_classees)} cellules non classées "
              f"(voir rapport)", file=sys.stderr)


if __name__ == "__main__":
    main()
