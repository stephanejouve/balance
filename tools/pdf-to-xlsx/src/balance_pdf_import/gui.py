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

from .parser_planning import ResultatParsing, parser_pdf, verifier_morceaux_attendus
from .writer_xlsx import ecrire_xlsx
from .audit import TraceFichier, ecrire_audit
from .cli import est_config_demo


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

        # Bandeau démonstration : quand la config chargée est fake-fixtures,
        # l'affiche visiblement rouge/orange pour que l'user ne prenne pas
        # une exécution démo pour un traitement réel (fix A1 audit Stéphane).
        # `wraplength` évite la troncature horizontale sur la largeur 640
        # de la fenêtre (constaté macOS 11 : « STRATION — config … »).
        self.bandeau_demo = tk.Label(
            self.root,
            text="",
            bg="#dc2626",
            fg="white",
            font=("", 12, "bold"),
            pady=6,
            wraplength=610,
            justify="center",
        )
        # `pack_forget` par défaut — affiché seulement si mode démo.

        self.cadre_pdf = tk.LabelFrame(self.root, text="1. PDFs planning à importer", padx=8, pady=8)
        self.cadre_pdf.pack(fill="both", expand=True, **pad)

        boutons_pdf = tk.Frame(self.cadre_pdf)
        boutons_pdf.pack(fill="x")
        tk.Button(boutons_pdf, text="Ajouter des PDFs…", command=self._ajouter_pdfs).pack(side="left")
        tk.Button(boutons_pdf, text="Ajouter un dossier…", command=self._ajouter_dossier).pack(side="left", padx=6)
        tk.Button(boutons_pdf, text="Vider la liste", command=self._vider).pack(side="right")

        self.liste_pdfs = tk.Listbox(self.cadre_pdf, height=6)
        self.liste_pdfs.pack(fill="both", expand=True, pady=(6, 0))

        cadre_conf = tk.LabelFrame(self.root, text="2. Configuration YAML", padx=8, pady=8)
        cadre_conf.pack(fill="x", **pad)
        self.entry_config = tk.Entry(cadre_conf, textvariable=self.config_path)
        self.entry_config.pack(side="left", fill="x", expand=True)
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

        self._rafraichir_bandeau_demo()
        # `after_idle` : l'Entry doit être realized pour que xview_moveto
        # prenne effet — sinon le scroll est ignoré au premier affichage.
        self.root.after_idle(lambda: self.entry_config.xview_moveto(1.0))

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
            # Chemin dans .app bundle très long — scroller à la fin pour
            # afficher le nom du fichier plutôt que le préfixe /Applications/…
            self.entry_config.xview_moveto(1.0)
            self._rafraichir_bandeau_demo()

    def _rafraichir_bandeau_demo(self):
        """Affiche/masque le bandeau MODE DÉMONSTRATION selon la config
        actuellement sélectionnée. Ré-appelé quand l'user change de
        config file via `_choisir_config` (fix A1)."""
        cp = self.config_path.get()
        if cp and est_config_demo(Path(cp)):
            self.bandeau_demo.configure(
                text=(
                    "⚠  MODE DÉMONSTRATION — config fake-fixtures.yml "
                    "(les vraies salles ne matcheront pas — charge ta config réelle)"
                ),
            )
            # `before=self.cadre_pdf` garantit la position en tête absolue.
            # Le comment précédent (« side='top' suffit ») était faux : pack
            # empile dans l'ordre d'insertion, pas selon la position visuelle.
            # Constaté macOS 11 — bandeau finissait au ras du bas, hors fenêtre.
            self.bandeau_demo.pack(fill="x", side="top", before=self.cadre_pdf)
        else:
            self.bandeau_demo.pack_forget()

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
            fichiers_traites: list[TraceFichier] = []
            for pdf in self.pdfs:
                r = parser_pdf(pdf, config)
                for err in r.erreurs_vraisemblance:
                    err.setdefault("fichier", pdf.name)
                fichiers_traites.append(TraceFichier(
                    nom=pdf.name,
                    chemin=str(pdf),
                    pages=r.nb_pages,
                    seances=len(r.seances),
                    date_detectee=r.date_page,
                ))
                self._logger(
                    f"  {pdf.name} → {r.nb_pages} page(s), {len(r.seances)} séance(s), "
                    f"{len(r.non_classees)} non-classée(s) — date détectée : {r.date_page or '?'}"
                )
                for err in r.erreurs_vraisemblance:
                    self._logger(
                        f"    ⚠ {err['niveau'].upper()} : {err['raison']}"
                        + (f" ({err['indice']})" if err.get('indice') else "")
                    )
                resultat.seances.extend(r.seances)
                resultat.ignorees.extend(r.ignorees)
                resultat.non_classees.extend(r.non_classees)
                resultat.erreurs_vraisemblance.extend(r.erreurs_vraisemblance)

            # Vérification cross-PDF morceaux attendus vs vus (config facultative).
            alertes_morceaux = verifier_morceaux_attendus(resultat.seances, config)
            for a in alertes_morceaux:
                self._logger(
                    f"    ⚠ {a['niveau'].upper()} : {a['raison']}"
                    + (f" ({a['indice']})" if a.get('indice') else "")
                )
            resultat.erreurs_vraisemblance.extend(alertes_morceaux)

            cfg_path = Path(self.config_path.get())
            demo = est_config_demo(cfg_path)

            # Fix A1 : refuse produire un xlsx vide si l'user a fourni des PDFs.
            if len(resultat.seances) == 0:
                # On écrit quand même l'audit (avec liste des fichiers) — l'user
                # peut diagnostiquer sans avoir à relancer.
                ecrire_audit(
                    resultat, out_audit,
                    fichiers_traites=fichiers_traites,
                    config_est_demo=demo,
                    config_chemin=str(cfg_path),
                )
                self._logger(
                    f"❌ 0 séance extraite sur {len(self.pdfs)} PDF — xlsx non produit."
                )
                self._logger(f"📋 audit tout de même écrit → {out_audit}")
                messagebox.showerror(
                    "Aucune séance extraite",
                    f"0 séance extraite sur {len(self.pdfs)} PDF.\n\n"
                    f"Cause probable : la config chargée ({cfg_path.name}) ne "
                    f"correspond pas aux PDFs fournis (salles attendues, mots-clés).\n\n"
                    f"Le rapport d'audit a été écrit tout de même pour diagnostic :\n"
                    f"{out_audit}",
                )
                return

            ecrire_xlsx(resultat.seances, out_xlsx)
            ecrire_audit(
                resultat, out_audit,
                fichiers_traites=fichiers_traites,
                config_est_demo=demo,
                config_chemin=str(cfg_path),
            )

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
