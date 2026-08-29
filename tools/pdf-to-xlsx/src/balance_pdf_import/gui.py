"""Mini-GUI tkinter pour `balance-pdf-import` — fenêtre standalone qui
permet à un utilisateur non-technique de convertir ses PDFs planning en
xlsx d'import Balance, sans ouvrir de terminal.

Design volontairement minimal :
- 1 zone : sélection des PDFs (bouton « Ajouter des PDFs » + liste)
- 1 zone : sélection de la config YAML (bouton « Choisir la config »)
- 1 zone : sélection du xlsx de sortie
- 1 bouton principal : « Générer »
- 1 zone de log qui affiche le résumé + lien vers le rapport d'audit

Pas de drag & drop natif — tkinter n'en propose pas sans dépendance externe
(`tkinterdnd2`) et les `filedialog` natifs marchent partout out of the box.
"""
from __future__ import annotations

import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

import yaml

from .parser_planning import ResultatParsing, parser_pdf
from .writer_xlsx import ecrire_xlsx
from .audit import ecrire_audit


CONFIG_INTEGRE = "fake-fixtures.yml"


def _chemin_config_defaut() -> Path | None:
    """Cherche `config/fake-fixtures.yml` à côté du binaire ou dans le repo.

    Quand le binaire est produit par PyInstaller, `sys._MEIPASS` pointe vers
    le dossier d'extraction du bundle où les datas sont copiées. En dev, on
    remonte depuis le fichier source jusqu'au dossier `config/`.
    """
    if hasattr(sys, "_MEIPASS"):
        p = Path(sys._MEIPASS) / "config" / CONFIG_INTEGRE
        if p.exists():
            return p
    dev = Path(__file__).resolve().parents[2] / "config" / CONFIG_INTEGRE
    if dev.exists():
        return dev
    return None


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        root.title("Balance — Import PDF → xlsx")
        root.geometry("640x540")

        self.config_path = tk.StringVar()
        self.output_path = tk.StringVar()
        self.pdfs: list[Path] = []

        default = _chemin_config_defaut()
        if default:
            self.config_path.set(str(default))

        self._construire_ui()

    def _construire_ui(self):
        pad = {"padx": 12, "pady": 6}

        cadre_pdf = tk.LabelFrame(self.root, text="1. PDFs planning à importer", padx=8, pady=8)
        cadre_pdf.pack(fill="both", expand=True, **pad)

        boutons_pdf = tk.Frame(cadre_pdf)
        boutons_pdf.pack(fill="x")
        tk.Button(boutons_pdf, text="Ajouter des PDFs…", command=self._ajouter_pdfs).pack(side="left")
        tk.Button(boutons_pdf, text="Ajouter un dossier…", command=self._ajouter_dossier).pack(side="left", padx=6)
        tk.Button(boutons_pdf, text="Vider la liste", command=self._vider).pack(side="right")

        self.liste_pdfs = tk.Listbox(cadre_pdf, height=6)
        self.liste_pdfs.pack(fill="both", expand=True, pady=(6, 0))

        cadre_conf = tk.LabelFrame(self.root, text="2. Configuration YAML", padx=8, pady=8)
        cadre_conf.pack(fill="x", **pad)
        tk.Entry(cadre_conf, textvariable=self.config_path).pack(side="left", fill="x", expand=True)
        tk.Button(cadre_conf, text="Choisir…", command=self._choisir_config).pack(side="right", padx=(6, 0))

        cadre_out = tk.LabelFrame(self.root, text="3. Fichier xlsx de sortie", padx=8, pady=8)
        cadre_out.pack(fill="x", **pad)
        tk.Entry(cadre_out, textvariable=self.output_path).pack(side="left", fill="x", expand=True)
        tk.Button(cadre_out, text="Enregistrer sous…", command=self._choisir_output).pack(side="right", padx=(6, 0))

        self.bouton_go = tk.Button(
            self.root, text="Générer le xlsx",
            command=self._generer, height=2,
            bg="#3b82f6", fg="white", font=("", 12, "bold"),
            activebackground="#2563eb", activeforeground="white",
        )
        self.bouton_go.pack(fill="x", padx=12, pady=(0, 4))

        cadre_log = tk.LabelFrame(self.root, text="Log", padx=8, pady=8)
        cadre_log.pack(fill="both", expand=False, **pad)
        self.log = tk.Text(cadre_log, height=6, wrap="word", state="disabled")
        self.log.pack(fill="both", expand=True)

    def _ajouter_pdfs(self):
        fichiers = filedialog.askopenfilenames(
            title="Choisir un ou plusieurs PDFs",
            filetypes=[("PDF", "*.pdf")],
        )
        for f in fichiers:
            p = Path(f)
            if p not in self.pdfs:
                self.pdfs.append(p)
                self.liste_pdfs.insert("end", p.name)

    def _ajouter_dossier(self):
        dossier = filedialog.askdirectory(title="Choisir un dossier contenant des PDFs")
        if not dossier:
            return
        for p in sorted(Path(dossier).rglob("*.pdf")):
            if p not in self.pdfs:
                self.pdfs.append(p)
                self.liste_pdfs.insert("end", p.name)

    def _vider(self):
        self.pdfs.clear()
        self.liste_pdfs.delete(0, "end")

    def _choisir_config(self):
        f = filedialog.askopenfilename(
            title="Configuration YAML",
            filetypes=[("YAML (*.yml)", "*.yml"), ("YAML (*.yaml)", "*.yaml"), ("Tous", "*.*")],
        )
        if f:
            self.config_path.set(f)

    def _choisir_output(self):
        f = filedialog.asksaveasfilename(
            title="Enregistrer le xlsx généré",
            defaultextension=".xlsx",
            filetypes=[("Excel", "*.xlsx")],
            initialfile="balance.xlsx",
        )
        if f:
            self.output_path.set(f)

    def _logger(self, msg: str):
        self.log.configure(state="normal")
        self.log.insert("end", msg + "\n")
        self.log.see("end")
        self.log.configure(state="disabled")
        self.root.update()

    def _generer(self):
        if not self.pdfs:
            messagebox.showwarning("PDFs manquants", "Ajoute au moins un PDF avant de générer.")
            return
        if not self.config_path.get() or not Path(self.config_path.get()).exists():
            messagebox.showwarning("Config manquante", "Choisis un fichier YAML de configuration.")
            return
        if not self.output_path.get():
            messagebox.showwarning("Sortie manquante", "Choisis où enregistrer le xlsx généré.")
            return

        try:
            with open(self.config_path.get()) as f:
                config = yaml.safe_load(f)
        except Exception as e:
            messagebox.showerror("Config invalide", f"Impossible de lire la config YAML :\n{e}")
            return

        out_xlsx = Path(self.output_path.get())
        out_audit = out_xlsx.with_suffix(".audit.txt")

        self.bouton_go.configure(state="disabled")
        try:
            self._logger(f"Lecture de {len(self.pdfs)} PDF…")
            resultat = ResultatParsing()
            for pdf in self.pdfs:
                r = parser_pdf(pdf, config)
                self._logger(f"  {pdf.name} → {len(r.seances)} séances, {len(r.non_classees)} non-classées")
                resultat.seances.extend(r.seances)
                resultat.ignorees.extend(r.ignorees)
                resultat.non_classees.extend(r.non_classees)

            ecrire_xlsx(resultat.seances, out_xlsx)
            ecrire_audit(resultat, out_audit)

            self._logger(f"✅ {len(resultat.seances)} séances → {out_xlsx}")
            self._logger(f"📋 rapport d'audit → {out_audit}")
            if resultat.non_classees:
                self._logger(f"⚠️  {len(resultat.non_classees)} cellules non classées — voir rapport")
            messagebox.showinfo(
                "Terminé",
                f"{len(resultat.seances)} séances générées.\n\n"
                f"xlsx : {out_xlsx}\n"
                f"audit : {out_audit}",
            )
        except Exception as e:
            self._logger(f"❌ Erreur : {e}")
            messagebox.showerror("Erreur de génération", str(e))
        finally:
            self.bouton_go.configure(state="normal")


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
