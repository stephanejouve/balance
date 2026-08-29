"""Test end-to-end du CLI `balance-pdf-import` — de la ligne de commande
au xlsx sur disque + rapport d'audit."""
from __future__ import annotations

from pathlib import Path

from click.testing import CliRunner
from openpyxl import load_workbook

from balance_pdf_import.cli import main


FIXTURES = Path(__file__).parent / "fixtures"
CONFIG_PATH = Path(__file__).parent.parent / "config" / "s5-2026.yml"


def test_cli_end_to_end_produit_xlsx_et_audit(tmp_path):
    out_xlsx = tmp_path / "balance.xlsx"
    out_audit = tmp_path / "balance.audit.txt"

    args = ["--config", str(CONFIG_PATH), "--out", str(out_xlsx), "--audit", str(out_audit)]
    for pdf in sorted(FIXTURES.glob("balance-pdf-*.pdf")):
        args.extend(["--pdf", str(pdf)])

    result = CliRunner().invoke(main, args)
    assert result.exit_code == 0, f"CLI failed: {result.output}\n{result.exception}"
    assert out_xlsx.exists()
    assert out_audit.exists()

    wb = load_workbook(out_xlsx)
    assert wb["Proposés"].max_row == 37  # header + 36 séances
    assert wb["Liste"].max_row == 13     # header + 12 morceaux

    audit_txt = out_audit.read_text()
    assert "RAPPORT D'AUDIT" in audit_txt
    assert "Séances extraites          : 36" in audit_txt


def test_cli_signale_pdf_manquant(tmp_path):
    out_xlsx = tmp_path / "balance.xlsx"
    result = CliRunner().invoke(main, [
        "--config", str(CONFIG_PATH),
        "--pdf", "/tmp/does-not-exist.pdf",
        "--out", str(out_xlsx),
    ])
    assert result.exit_code != 0
