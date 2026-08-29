"""Parseur A — planning journalier organisateur.

Un PDF = une page = une journée. Grille tableau à N colonnes (marge + salles)
et M lignes (créneaux). Les bordures du tableau sont dessinées dans le PDF —
on les utilise directement pour délimiter les cases, plutôt que d'inférer par
proximité de mots.

Sortie : liste de `Seance` — une par cellule reconnue comme séance. Les
cellules ignorées (Préparations, Combo, Jams…) et les cellules non classées
sont retournées séparément pour alimenter le rapport d'audit.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import pdfplumber


APOSTROPHES_TYPO = {"\u2019": "'", "\u2018": "'"}
HORAIRE_RE = re.compile(r"^\d{1,2}:\d{2}$")
TITRE_JOUR_RE = re.compile(
    r"^(?P<jour>DIMANCHE|LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI|SAMEDI)\s+"
    r"(?P<jj>\d{1,2})\s+(?P<mois>[A-Z]+)\s+(?P<aaaa>\d{4})$",
    re.IGNORECASE,
)
MOIS_FR = {
    "janvier": 1, "fevrier": 2, "février": 2, "mars": 3, "avril": 4,
    "mai": 5, "juin": 6, "juillet": 7, "aout": 8, "août": 8,
    "septembre": 9, "octobre": 10, "novembre": 11, "decembre": 12, "décembre": 12,
}


@dataclass
class Seance:
    """Une séance extraite d'une cellule de planning."""
    date: str          # ISO YYYY-MM-DD
    debut: str         # HH:MM
    fin: str | None    # HH:MM ou None (créneau à fin ouverte)
    salle: str
    morceau: str
    responsable: str | None
    type: str          # "Répétition", "Enregistrement", etc.
    source_page: int


@dataclass
class ResultatParsing:
    """Résultat d'une passe complète de parsing sur un PDF."""
    seances: list[Seance] = field(default_factory=list)
    ignorees: list[dict] = field(default_factory=list)
    non_classees: list[dict] = field(default_factory=list)
    date_page: str | None = None
    salles_detectees: list[str] = field(default_factory=list)
    creneaux_detectes: list[str] = field(default_factory=list)


def _norm(txt: str) -> str:
    for src, dst in APOSTROPHES_TYPO.items():
        txt = txt.replace(src, dst)
    return txt


def _extraire_date_titre(mots: list[dict]) -> str | None:
    """Le titre en haut de page est du type 'MERCREDI 26 AOUT 2026'."""
    en_haut = [m for m in mots if m["top"] < 60]
    en_haut.sort(key=lambda m: m["x0"])
    texte = " ".join(m["text"] for m in en_haut)
    m = TITRE_JOUR_RE.match(texte)
    if not m:
        return None
    mois = MOIS_FR.get(m.group("mois").lower())
    if not mois:
        return None
    return f"{m.group('aaaa')}-{mois:02d}-{int(m.group('jj')):02d}"


def _bordures_grille(page, marge_gauche_min=20, largeur_min_h=100, hauteur_min_v=30):
    """Extrait les bordures du tableau à partir de `page.lines`.

    Retourne (xs_verticales, ys_horizontales) — deux listes triées de coordonnées
    uniques, dédupliquées à 1px près.
    """
    v = sorted({round(l["x0"]) for l in page.lines
                if l["bottom"] - l["top"] > hauteur_min_v and l["x0"] > marge_gauche_min - 1})
    h = sorted({round(l["top"]) for l in page.lines
                if l["x1"] - l["x0"] > largeur_min_h})
    v = _dedup_proches(v)
    h = _dedup_proches(h)
    return v, h


def _dedup_proches(xs: list[float], seuil: float = 2.0) -> list[float]:
    """Fusionne les valeurs à moins de `seuil` d'écart."""
    out: list[float] = []
    for x in sorted(xs):
        if not out or (x - out[-1]) > seuil:
            out.append(x)
    return out


def _detecter_salles(mots: list[dict], colonnes_x: list[float],
                     salles_attendues: list[str]) -> dict[int, str]:
    """Associe chaque colonne (index dans `colonnes_x`) à un nom de salle.

    Utilise le mot le plus proche du centre de la colonne, dans la 1ʳᵉ ligne
    du tableau (en-tête).
    """
    if len(colonnes_x) < 2:
        return {}
    ligne_entete_y = _detecter_top_entete(mots, colonnes_x, salles_attendues)
    if ligne_entete_y is None:
        return {}
    par_colonne: dict[int, str] = {}
    for i in range(len(colonnes_x) - 1):
        x0, x1 = colonnes_x[i], colonnes_x[i + 1]
        mots_col = [m for m in mots
                    if x0 <= (m["x0"] + m["x1"]) / 2 < x1
                    and abs(m["top"] - ligne_entete_y) < 3]
        mots_col.sort(key=lambda m: m["x0"])
        for salle in salles_attendues:
            morceaux = salle.split()
            if not mots_col:
                continue
            if _norm(mots_col[0]["text"]) == morceaux[0]:
                par_colonne[i] = salle
                break
    return par_colonne


def _detecter_top_entete(mots, colonnes_x, salles_attendues):
    """Cherche le top y où on trouve le plus de 1ers-mots de salles."""
    premiers = {salle.split()[0] for salle in salles_attendues}
    candidats: dict[int, int] = {}
    for m in mots:
        if _norm(m["text"]) in premiers:
            bucket = round(m["top"] / 2)
            candidats[bucket] = candidats.get(bucket, 0) + 1
    if not candidats:
        return None
    best_bucket = max(candidats, key=candidats.get)
    return best_bucket * 2


def _detecter_creneaux(mots: list[dict], marge_gauche_x: float,
                       ys_bordures: list[float]) -> list[dict]:
    """Extrait les créneaux horaires depuis la colonne de gauche.

    Un créneau = `HH:MM` seul, ou `HH:MM - HH:MM` (les 3 mots peuvent être
    fragmentés). Chaque créneau est encadré par une paire de bordures
    horizontales tracées dans le PDF (`ys_bordures`) — c'est ces bornes qui
    délimitent la case, PAS le top du texte horaire (qui est aligné avec le
    milieu de la case).

    Retourne liste de dicts {label, y_haut, y_bas, debut, fin}.
    """
    from collections import defaultdict
    gauche = [m for m in mots if m["x0"] < marge_gauche_x]
    lignes = defaultdict(list)
    for m in gauche:
        lignes[round(m["top"] / 3)].append(m)
    out = []
    for _, mots_l in lignes.items():
        mots_l.sort(key=lambda m: m["x0"])
        textes = [m["text"] for m in mots_l]
        if not textes or not HORAIRE_RE.match(textes[0]):
            continue
        top = mots_l[0]["top"]
        y_haut, y_bas = _bracket_borne(top, ys_bordures)
        debut = textes[0]
        fin = None
        label = debut
        if len(textes) >= 3 and textes[1] == "-" and HORAIRE_RE.match(textes[2]):
            fin = textes[2]
            label = f"{debut}-{fin}"
        out.append({
            "label": label,
            "y_haut": y_haut,
            "y_bas": y_bas,
            "debut": debut,
            "fin": fin,
        })
    return sorted(out, key=lambda c: c["y_haut"])


def _bracket_borne(y: float, ys: list[float]) -> tuple[float, float]:
    """Encadre `y` dans les bordures triées `ys` : retourne (borne_haute, borne_basse).

    Fallback si `ys` vide ou `y` hors intervalle : (y-5, y+30).
    """
    if not ys:
        return (y - 5, y + 30)
    for i in range(len(ys) - 1):
        if ys[i] <= y < ys[i + 1]:
            return (ys[i], ys[i + 1])
    if y < ys[0]:
        return (max(0, y - 5), ys[0])
    return (ys[-1], y + 30)


def _detecter_bandeaux(mots: list[dict]) -> tuple[list[dict], set[int]]:
    """Un bandeau = suite de mots courts (≤2 chars) au même top, espacés
    régulièrement (gap < 8px). Les bandeaux réels sont écrits lettre-par-lettre
    (`P E T I T - D É J E U N E R`) — le gap entre lettres consécutives est
    petit. Les fragments de cellules réelles (`?`, `or`, `En`) sont éparpillés
    et ont de gros gaps.

    Retourne (liste bandeaux détectés, set des ids Python des mots consommés).
    """
    from collections import defaultdict
    lignes = defaultdict(list)
    for m in mots:
        if len(m["text"]) <= 2:
            lignes[round(m["top"] / 2)].append(m)
    bandeaux, ids = [], set()
    for _, mots_l in lignes.items():
        if len(mots_l) < 5:
            continue
        mots_l.sort(key=lambda m: m["x0"])
        # Segmenter en runs de mots contigus (gap < 8px). Un vrai bandeau a
        # ses lettres à gap < 5-8px ; on prend le plus long run.
        run_courant = [mots_l[0]]
        meilleur_run = [mots_l[0]]
        for m in mots_l[1:]:
            gap = m["x0"] - run_courant[-1]["x1"]
            if gap < 8:
                run_courant.append(m)
            else:
                if len(run_courant) > len(meilleur_run):
                    meilleur_run = run_courant
                run_courant = [m]
        if len(run_courant) > len(meilleur_run):
            meilleur_run = run_courant
        if len(meilleur_run) < 5:
            continue
        largeur = meilleur_run[-1]["x1"] - meilleur_run[0]["x0"]
        if largeur < 60:
            continue
        texte = "".join(m["text"] for m in meilleur_run)
        bandeaux.append({
            "texte": texte,
            "top": meilleur_run[0]["top"],
            "x0": meilleur_run[0]["x0"],
            "x1": meilleur_run[-1]["x1"],
        })
        ids.update(id(m) for m in meilleur_run)
    return bandeaux, ids


SEUIL_BANDEAU_PLEINE_LARGEUR_PX = 300
"""Un bandeau plus large que cette valeur occupe le créneau entier
(PETIT-DÉJEUNER, DÎNER, GRAND CONCERT). En-deçà, il coexiste avec des
séances régulières dans les autres colonnes (APÉRO CONCERT DES INTERVENANTS
mardi ~200-300px). Calibré sur les PDF de la session S5 2026 — à revoir
si un futur PDF utilise une mise en page plus étroite."""


def _creneaux_masques_par_bandeau(creneaux, bandeaux) -> set[str]:
    """Retourne les labels de créneaux qui sont ENTIÈREMENT bandeaux (ex :
    PETIT-DÉJEUNER pleine largeur sans autre contenu).

    Un créneau est entièrement masqué quand un bandeau y couvre plus de
    `SEUIL_BANDEAU_PLEINE_LARGEUR_PX`. Les bandeaux plus étroits (ex :
    'APÉRO CONCERT DES INTERVENANTS' qui coexiste avec des séances dans
    d'autres colonnes le mardi/lundi) sont simplement filtrés au niveau mot
    via `ids_bandeau` mais laissent le reste du créneau exploitable.
    """
    masques = set()
    for c in creneaux:
        for b in bandeaux:
            if not (c["y_haut"] - 3 <= b["top"] < c["y_bas"]):
                continue
            if (b["x1"] - b["x0"]) > SEUIL_BANDEAU_PLEINE_LARGEUR_PX:
                masques.add(c["label"])
                break
    return masques


def _cellule_seance(texte: str, mots_cles: list[str], ignorer: list[str],
                    motif_resp: re.Pattern) -> dict:
    """Interprète le texte d'une cellule. Retourne :
    - {'type': 'seance', 'mot_cle': str, 'morceau': str, 'responsable': str|None}
    - {'type': 'ignore', 'raison': str}
    - {'type': 'inconnu', 'texte': str}

    Les mots-clés (`Répétition`, `Enregistrement`, …) sont matchés en tant que
    mot entier (word boundary) pour ne pas prendre `Répétitions` (le pluriel
    apparaît dans le PDF dimanche comme titre de bandeau générique).
    """
    for raison in ignorer:
        if re.search(rf"\b{re.escape(raison)}\b", texte):
            return {"type": "ignore", "raison": raison}
    for kw in mots_cles:
        m_kw = re.search(rf"\b{re.escape(kw)}\b", texte)
        if not m_kw:
            continue
        reste = texte[m_kw.end():].strip()
        m = motif_resp.search(reste)
        resp = m.group("nom").strip() if m else None
        morceau = reste[:m.start()].strip() if m else reste.strip()
        morceau = _nettoyer_titre(morceau)
        if not morceau:
            return {"type": "inconnu", "texte": texte}
        return {
            "type": "seance",
            "mot_cle": kw,
            "morceau": morceau,
            "responsable": resp,
        }
    return {"type": "inconnu", "texte": texte}


def _nettoyer_titre(t: str) -> str:
    """Enlève espaces multiples, retours ligne, apostrophes typo."""
    return _norm(" ".join(t.split()))


def parser_page(page, config: dict, numero_page: int = 1) -> ResultatParsing:
    """Parse une page de PDF (= une journée)."""
    resultat = ResultatParsing()
    mots = page.extract_words()
    resultat.date_page = _extraire_date_titre(mots)

    xs, ys = _bordures_grille(page)
    salles_col = _detecter_salles(mots, xs, config["salles"])
    resultat.salles_detectees = list(salles_col.values())

    marge_gauche_x = xs[1] if len(xs) > 1 else 140
    creneaux = _detecter_creneaux(mots, marge_gauche_x, ys)
    resultat.creneaux_detectes = [c["label"] for c in creneaux]

    bandeaux, ids_bandeau = _detecter_bandeaux(mots)
    labels_masques = _creneaux_masques_par_bandeau(creneaux, bandeaux)

    motif_resp = re.compile(config.get("motif_responsable", r"avec (?P<nom>.+?)(?:\s|$)"))

    if resultat.date_page is None:
        return resultat

    for cre in creneaux:
        if cre["label"] in labels_masques:
            continue
        y_haut, y_bas = cre["y_haut"], cre["y_bas"]

        for i_col, salle in salles_col.items():
            x0, x1 = xs[i_col], xs[i_col + 1]
            mots_case = [
                m for m in mots
                if id(m) not in ids_bandeau
                and x0 <= (m["x0"] + m["x1"]) / 2 < x1
                and y_haut <= m["top"] < y_bas
            ]
            if not mots_case:
                continue
            mots_case.sort(key=lambda m: (round(m["top"] / 4), m["x0"]))
            texte = _norm(" ".join(m["text"] for m in mots_case))

            interp = _cellule_seance(
                texte,
                config["mots_cles_seance"],
                config["ignorer"],
                motif_resp,
            )
            if interp["type"] == "seance":
                if not cre["fin"]:
                    resultat.non_classees.append({
                        "raison": "fin manquante",
                        "date": resultat.date_page,
                        "creneau": cre["label"],
                        "salle": salle,
                        "texte": texte,
                    })
                    continue
                resultat.seances.append(Seance(
                    date=resultat.date_page,
                    debut=cre["debut"],
                    fin=cre["fin"],
                    salle=salle,
                    morceau=interp["morceau"],
                    responsable=interp["responsable"],
                    type=interp["mot_cle"],
                    source_page=numero_page,
                ))
            elif interp["type"] == "ignore":
                resultat.ignorees.append({
                    "date": resultat.date_page,
                    "creneau": cre["label"],
                    "salle": salle,
                    "raison": interp["raison"],
                    "texte": texte,
                })
            else:
                resultat.non_classees.append({
                    "raison": "aucun mot-clé reconnu",
                    "date": resultat.date_page,
                    "creneau": cre["label"],
                    "salle": salle,
                    "texte": texte,
                })
    return resultat


def parser_pdf(chemin: Path, config: dict) -> ResultatParsing:
    """Parse un PDF de planning journalier (1 page = 1 journée).

    Le contrat "1 PDF = 1 journée" est structurel (chaque PDF S5 est un
    fichier par jour). Si un PDF multi-pages est fourni, chaque page est
    parsée mais seules les métadonnées de la dernière page (`date_page`,
    `salles_detectees`, `creneaux_detectes`) sont conservées — les séances
    sont bien toutes agrégées.
    """
    resultat_total = ResultatParsing()
    with pdfplumber.open(chemin) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            partiel = parser_page(page, config, numero_page=i)
            resultat_total.seances.extend(partiel.seances)
            resultat_total.ignorees.extend(partiel.ignorees)
            resultat_total.non_classees.extend(partiel.non_classees)
            resultat_total.date_page = partiel.date_page
            resultat_total.salles_detectees = partiel.salles_detectees
            resultat_total.creneaux_detectes = partiel.creneaux_detectes
    return resultat_total
