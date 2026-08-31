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
from collections import Counter, defaultdict
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
    nb_pages: int = 0
    # Garde-fou vraisemblance : erreurs de niveau page — le PDF est non-vide
    # (`nb_pages > 0`) mais l'extraction n'a pas produit ce qu'on en attend
    # (aucune salle détectée, aucun créneau, aucune date). Ne bloque pas la
    # sortie xlsx (au niveau CLI/GUI on décide selon `--autoriser-zero-seance`),
    # mais visible dans l'audit — ce qui aurait évité les 3 exécutions à
    # l'aveugle de Stéphane du 30/08 (audit A1 + Claude Desktop).
    erreurs_vraisemblance: list[dict] = field(default_factory=list)


def _norm(txt: str) -> str:
    for src, dst in APOSTROPHES_TYPO.items():
        txt = txt.replace(src, dst)
    return txt


def _extraire_date_titre(mots: list[dict]) -> str | None:
    """Le titre en haut de page est du type 'MERCREDI 26 AOUT 2026'.

    Fix C2 (audit Claude Desktop 2026-08-30) : on regroupe les mots par
    ligne (bucket top / 4) avant de matcher la regex. En format paysage,
    l'en-tête des salles se trouve dès 33 px du haut ; concaténer tout
    ce qui est < 60 px produisait une chaîne polluée
    ("MERCREDI 26 AOUT 2026 L'Étang Le Garage ...") que ni `match` ni
    `search` ne pouvaient matcher (regex ancrée `^...$`). On teste
    ligne par ligne, la première qui matche l'emporte.

    Seuil élargi à 120 px pour couvrir les titres dans les paysages
    denses ; le regroupement par ligne évite la pollution.
    """
    lignes: dict[int, list[dict]] = defaultdict(list)
    for mot in mots:
        if mot["top"] < 120:
            lignes[round(mot["top"] / 4)].append(mot)
    m = None
    for _, mots_ligne in sorted(lignes.items()):
        mots_ligne.sort(key=lambda x: x["x0"])
        texte = " ".join(x["text"] for x in mots_ligne)
        m = TITRE_JOUR_RE.match(texte)
        if m:
            break
    if not m:
        return None
    mois = MOIS_FR.get(m.group("mois").lower())
    if not mois:
        return None
    return f"{m.group('aaaa')}-{mois:02d}-{int(m.group('jj')):02d}"


def _bordures_grille(page, marge_gauche_min=20, largeur_min_h=100, hauteur_min_v=30):
    """Extrait les bordures du tableau à partir de `page.edges` (fallback
    `page.lines`).

    Retourne (xs_verticales, ys_horizontales) — deux listes triées de coordonnées
    uniques, dédupliquées à 1px près.

    Fix C1 (audit Claude Desktop 2026-08-30) : `page.lines` est vide quand
    le générateur dessine les bordures comme des **rectangles remplis**
    plutôt que des traits (cas de wkhtmltopdf et de la plupart des moteurs
    HTML→PDF). `page.edges` couvre les deux cas — traits ET côtés de
    rectangles. Sans ce fallback, un PDF wkhtml produit 0 verticale/
    horizontale → 0 cellule → 0 séance, en silence.

    Fix C3 (même audit) : les bordures verticales sont souvent dessinées
    **cellule par cellule** (leur hauteur suit la ligne du tableau) — le
    seuil `hauteur_min_v` élimine alors les tableaux aux lignes courtes.
    On retient les abscisses qui **se répètent** sur plusieurs lignes :
    un vrai montant de grille traverse plusieurs cellules ; un trait
    accidentel n'y figure qu'une fois.

    Fallback dégradé C3 : on essaie ≥3 occurrences, puis ≥2, puis ≥1
    avant de rendre une grille vide. Un PDF non-vide sans grille
    détectable est signalé en amont (garde-fou vraisemblance) plutôt
    que traité comme un résultat.
    """
    traits = page.edges or page.lines
    occurrences = Counter(
        round(l["x0"]) for l in traits
        if l["bottom"] - l["top"] > 5 and l["x0"] > marge_gauche_min - 1
    )
    v: list[int] = []
    for seuil_occ in (3, 2, 1):
        v = sorted(
            x for x, n in occurrences.items()
            if n >= seuil_occ or any(
                l["bottom"] - l["top"] > hauteur_min_v
                for l in traits if round(l["x0"]) == x
            )
        )
        if v:
            break
    h = sorted({round(l["top"]) for l in traits
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

    Pour chaque colonne, concatène les mots à la ligne d'en-tête et cherche
    la salle attendue qui matche exactement. Comparer sur la séquence
    complète évite l'ambiguïté quand plusieurs salles commencent par le
    même mot (`Le Pressoir` vs `Le Kiosque`, `La Grange` vs `La Véranda`).
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
        texte_col = " ".join(_norm(m["text"]) for m in mots_col)
        for salle in salles_attendues:
            if texte_col == salle:
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

    Retourne liste de dicts {label, y_haut, y_bas, debut, fin, top}.
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
            # `top` conservé pour la subdivision anti-chevauchement : quand
            # plusieurs créneaux partagent la même case (bordures internes
            # manquantes dans le PDF), on synthétise des sous-cases à partir
            # des tops des labels.
            "top": top,
        })
    creneaux = sorted(out, key=lambda c: c["top"])
    return _subdiviser_creneaux_chevauchants(creneaux)


def _subdiviser_creneaux_chevauchants(creneaux: list[dict]) -> list[dict]:
    """Quand plusieurs créneaux partagent la même case (bordures horizontales
    internes manquantes dans le PDF), subdivise en sous-cases à partir des
    `top` des labels dans la marge gauche.

    Cas de figure documenté (mardi S6, fixtures) : les créneaux 14:30-16:00,
    15:30-17:30 et 16:30-18:00 se recouvrent temporellement (répétition
    15:30-17:30 chevauchante). Le PDF les liste dans la marge à des `top`
    distincts (108, 139, 170) mais ne dessine aucune bordure horizontale
    entre eux — `_bracket_borne` retourne alors la même paire (y_case_haut,
    y_case_bas) pour les 3, et les mots du contenu sont pris en compte
    3 fois (une par créneau) → 12 séances au lieu de 6.

    Fix : pour un groupe de N créneaux partageant la même case, chaque
    créneau i reçoit y_haut = mi-hauteur (top_{i-1}, top_i) et y_bas =
    mi-hauteur (top_i, top_{i+1}) — les extrêmes conservent y_case_haut
    et y_case_bas. Le contenu à un top donné tombe alors dans la seule
    sous-case correspondante, la duplication disparaît.
    """
    from collections import defaultdict
    par_case: dict[tuple[float, float], list[dict]] = defaultdict(list)
    for c in creneaux:
        par_case[(c["y_haut"], c["y_bas"])].append(c)
    out: list[dict] = []
    for (y_case_h, y_case_b), groupe in par_case.items():
        if len(groupe) <= 1:
            out.extend(groupe)
            continue
        groupe.sort(key=lambda c: c["top"])
        tops = [c["top"] for c in groupe]
        for i, cre in enumerate(groupe):
            y_haut_sub = y_case_h if i == 0 else (tops[i - 1] + tops[i]) / 2
            y_bas_sub = y_case_b if i == len(groupe) - 1 else (tops[i] + tops[i + 1]) / 2
            cre = dict(cre)
            cre["y_haut"] = y_haut_sub
            cre["y_bas"] = y_bas_sub
            out.append(cre)
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
    """Parse une page de PDF (= une journée).

    Alimente `resultat.erreurs_vraisemblance` quand la page est non-vide
    mais que l'extraction n'a produit aucun élément attendu (0 salle,
    0 créneau, ou pas de date). Ce garde-fou (audit Stéphane +
    Claude Desktop du 30/08) évite que 0 séance soit silencieusement pris
    pour un résultat.
    """
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

    # Garde-fou vraisemblance — signalements avant même le parcours des
    # cellules. On collecte tout, on ne raise pas : le CLI/GUI décide de
    # la politique (échec bruyant vs xlsx vide autorisé).
    if len(mots) > 0:
        if resultat.date_page is None:
            resultat.erreurs_vraisemblance.append({
                "niveau": "warning",
                "raison": "date non détectée dans le titre de page",
                "page": numero_page,
                "indice": "vérifier que le titre respecte le format "
                          "'JOUR JJ MOIS AAAA' (ex. 'MERCREDI 26 AOUT 2026')",
            })
        if not salles_col:
            resultat.erreurs_vraisemblance.append({
                "niveau": "error",
                "raison": "aucune salle détectée",
                "page": numero_page,
                "indice": f"les noms de salles configurés "
                          f"({', '.join(config.get('salles', []))}) "
                          f"ne matchent pas les en-têtes de colonnes du PDF",
            })
        if not creneaux:
            resultat.erreurs_vraisemblance.append({
                "niveau": "error",
                "raison": "aucun créneau horaire détecté",
                "page": numero_page,
                "indice": "vérifier que la colonne de gauche contient bien "
                          "des horaires au format HH:MM ou HH:MM-HH:MM",
            })

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

    # Post-traitement : recomposition annonces cross-colonnes (A3.2).
    _recomposer_annonces_cross_colonnes(resultat, config)
    return resultat


# Regex : capture toutes les heures HH:MM ou HHhMM (utile pour extraire
# une heure « antidatée » dans une annonce type « fermées dès 16:45 »).
_HEURE_ANNONCE_RE = re.compile(r"\b\d{1,2}[h:]\d{2}\b")


def _recomposer_annonces_cross_colonnes(
    resultat: ResultatParsing, config: dict
) -> None:
    """Détecte les fragments cross-colonnes d'une même annonce écrite en
    cellule fusionnée dans le PDF, les recompose et signale l'annonce
    dans `erreurs_vraisemblance` avec un warning.

    Signal syntaxique retenu : **parenthèses non appariées**. Une cellule
    contenant `(` sans `)` et une cellule voisine (même créneau) contenant
    `)` sans `(` sont marqueurs d'une phrase continue coupée par la
    grille des colonnes. Ce critère est robuste — il n'exige pas de
    lister à l'avance les mots-clés d'annonce (fermeture, montage,
    installation, ...) qui varient d'une session à l'autre.

    Cas de figure documenté (jeudi S6, cellule fermeture antidatée) :

        L'Atelier   « (La Grange et Salle Nord »
        Le Kiosque  « fermées dès 16:45 pour montage) »

    → phrase recomposée : « (La Grange et Salle Nord fermées dès 16:45
    pour montage) », heure antidatée 16:45 (prime sur le créneau
    18:00-20:50), salles concernées : La Grange, Salle Nord.

    Effet sur `resultat` (mutation en place) :
    - Les fragments individuels sont retirés de `non_classees` (évite
      la pollution du rapport avec 3 lignes « aucun mot-clé reconnu »).
    - Un `warning` est ajouté à `erreurs_vraisemblance` avec le texte
      recomposé, l'heure antidatée éventuelle et la liste des salles
      nommées dans le texte.
    - Le fragment est **signalé**, pas traité en séance — l'humain
      valide/agit dans Balance selon la sémantique (fermeture, montage,
      installation, événement transverse, ...).
    """
    from collections import defaultdict
    salles_attendues = set(config.get("salles", []))

    # Grouper les non_classees par créneau
    par_creneau: dict[str, list[dict]] = defaultdict(list)
    for nc in resultat.non_classees:
        if nc.get("raison") == "aucun mot-clé reconnu":
            par_creneau[nc.get("creneau", "?")].append(nc)

    fragments_consommes: list[dict] = []
    for creneau_label, ncs in par_creneau.items():
        # Trouver les fragments avec parenthèses non appariées
        ouvertures = [nc for nc in ncs if "(" in nc["texte"] and ")" not in nc["texte"]]
        fermetures = [nc for nc in ncs if ")" in nc["texte"] and "(" not in nc["texte"]]
        if not ouvertures or not fermetures:
            continue
        # V1 : associer directement première ouverture + dernière fermeture.
        # Les fragments sans parenthèses ne sont PAS inclus — ils peuvent
        # être des cellules légitimes voisines (ex. jeudi S6 : la cellule
        # « 18:00 : Installation — 18:30 » de La Grange est légitime,
        # aucune raison de la fusionner à l'annonce fermeture). Si un futur
        # cas nécessite un fragment intermédiaire (annonce sur 3 colonnes
        # ouv/milieu/ferm), on raffinera par tri x0.
        ouverture = ouvertures[0]
        fermeture = fermetures[-1]
        # Recomposer le texte (ouverture + fermeture uniquement)
        texte_recompose = f"{ouverture['texte']} {fermeture['texte']}"
        # Extraire toutes les heures trouvées (l'user identifie l'heure
        # métier pertinente — antidatée, échéance, ...). Une heure typique
        # d'annonce est « fermées dès HH:MM » ; regex `dès (HH:MM)`
        # capturerait plus précisément mais reste FR-only.
        heures_trouvees = _HEURE_ANNONCE_RE.findall(texte_recompose)
        # Extraire salles nommées (substring simple)
        salles_nommees = sorted(s for s in salles_attendues if s in texte_recompose)
        # Signaler l'annonce
        raison = f"annonce cross-colonnes recomposée : « {texte_recompose} »"
        indice_parts = []
        if heures_trouvees:
            indice_parts.append(f"heures dans le texte : {', '.join(heures_trouvees)}")
        if salles_nommees:
            indice_parts.append(f"salles nommées : {', '.join(salles_nommees)}")
        indice_parts.append(
            f"créneau porteur : {creneau_label} — vérifier manuellement "
            f"(fermeture, montage, événement transverse, ...)"
        )
        resultat.erreurs_vraisemblance.append({
            "niveau": "warning",
            "raison": raison,
            "indice": " ; ".join(indice_parts),
        })
        # Marquer les fragments consommés (ouverture + fermeture seulement)
        fragments_consommes.append(ouverture)
        fragments_consommes.append(fermeture)

    # Retirer les fragments consommés de non_classees
    if fragments_consommes:
        consommes_ids = {id(f) for f in fragments_consommes}
        resultat.non_classees = [
            nc for nc in resultat.non_classees if id(nc) not in consommes_ids
        ]


# Regex robuste : on ne peut pas utiliser `\b` car en Python `_` est un
# word-character donc `\b` ne matche pas dans `1_dimanche.pdf` (entre `_`
# et `d` il n'y a pas de boundary). On borne explicitement avec
# non-lettre ou début/fin de chaîne.
_JOUR_DANS_NOM_RE = re.compile(
    r"(?:^|[^a-zA-Zà-ÿ])(dimanche|lundi|mardi|mercredi|jeudi|vendredi|samedi)"
    r"(?:$|[^a-zA-Zà-ÿ])",
    re.IGNORECASE,
)


def _deduire_jour_depuis_nom(nom_fichier: str) -> str | None:
    """Extrait le nom de jour depuis le nom du fichier (`3_mardi.pdf` → 'mardi').

    Utilisé comme fallback pour lookup dans `config['dates']` quand
    l'extraction titre échoue (voir `parser_pdf`)."""
    m = _JOUR_DANS_NOM_RE.search(nom_fichier)
    return m.group(1).lower() if m else None


def parser_pdf(chemin: Path, config: dict) -> ResultatParsing:
    """Parse un PDF de planning journalier (1 page = 1 journée).

    Le contrat "1 PDF = 1 journée" est structurel (chaque PDF S5 est un
    fichier par jour). Si un PDF multi-pages est fourni, chaque page est
    parsée mais seules les métadonnées de la dernière page (`date_page`,
    `salles_detectees`, `creneaux_detectes`) sont conservées — les séances
    sont bien toutes agrégées.

    **Utilisation de `config['dates']`** (audit Claude Desktop 2026-08-30 +
    décision Stéphane 2026-08-31 sur variante 3) : la clé `dates: {mercredi:
    2026-08-26, ...}` est **facultative mais exhaustive si présente**.

    - **clé absente** : aucun contrôle, aucune alerte — le titre du PDF fait
      foi. Utile pour prototypage ou usage ponctuel où l'on n'a pas encore
      formalisé le calendrier de la session.
    - **clé présente** : trois contrôles complémentaires :
      1. **cross-check** : titre PDF extrait et date diverge de
         `dates[jour_déduit_du_nom_fichier]` → warning « divergence date ».
      2. **fallback** : titre PDF non extrait mais jour déclaré dans `dates`
         → utilisation de `dates[jour]` pour peupler `date_page` + warning.
      3. **exhaustivité** : jour PDF rencontré (déduit du nom) mais absent
         des clés de `dates` → warning « jour non déclaré ». C'est le
         garde-fou de la variante 3 : évite l'entre-deux « j'ai déclaré
         3 jours sur 6 et je crois être couvert ». Soit on ne contrôle
         rien et on le sait (clé absente), soit on contrôle tout.

    Motivation du croisement (pas de suppression pure) : la chaîne d'entrée
    terrain visée par le brief Balance §15 est **photo tableau → transcription
    IA → PDF → parser**. Une date mal transcrite produit un PDF impeccablement
    formé et faux — le parser seul ne peut pas la détecter. La config `dates`
    est une source **indépendante** (saisie humaine à l'avance, hors chaîne
    IA), et c'est ce qui donne sa valeur au croisement — deux chemins
    distincts vers la même information.
    """
    resultat_total = ResultatParsing()
    dates_config = config.get("dates") or {}
    dates_active = bool(dates_config)
    jour_deduit = _deduire_jour_depuis_nom(chemin.name)
    date_config = dates_config.get(jour_deduit) if jour_deduit else None

    with pdfplumber.open(chemin) as pdf:
        resultat_total.nb_pages = len(pdf.pages)
        for i, page in enumerate(pdf.pages, start=1):
            partiel = parser_page(page, config, numero_page=i)
            resultat_total.seances.extend(partiel.seances)
            resultat_total.ignorees.extend(partiel.ignorees)
            resultat_total.non_classees.extend(partiel.non_classees)
            resultat_total.erreurs_vraisemblance.extend(partiel.erreurs_vraisemblance)
            resultat_total.date_page = partiel.date_page
            resultat_total.salles_detectees = partiel.salles_detectees
            resultat_total.creneaux_detectes = partiel.creneaux_detectes

    if not dates_active:
        # Clé absente : aucun contrôle. Cohérent avec la variante 3.
        return resultat_total

    # Exhaustivité : jour PDF rencontré mais absent des clés `dates`. Détecte
    # l'entre-deux dangereux où l'user croit avoir déclaré ses dates alors
    # qu'il en manque (avant la variante 3, silence total sur ces jours).
    if jour_deduit and jour_deduit not in dates_config:
        resultat_total.erreurs_vraisemblance.append({
            "niveau": "warning",
            "fichier": chemin.name,
            "raison": f"jour '{jour_deduit}' déduit du nom fichier non déclaré "
                      f"dans config['dates'] (clés présentes : "
                      f"{sorted(dates_config.keys())})",
            "indice": "ajouter la date attendue pour bénéficier du cross-check, "
                      "ou retirer complètement la clé 'dates' pour désactiver "
                      "tous les contrôles",
        })
        return resultat_total

    # Confrontation date titre vs date config (une redondance qui ne se
    # confronte à rien = source d'erreur silencieuse).
    date_config_iso = str(date_config) if date_config else None
    if resultat_total.date_page and date_config_iso and \
            resultat_total.date_page != date_config_iso:
        resultat_total.erreurs_vraisemblance.append({
            "niveau": "warning",
            "fichier": chemin.name,
            "raison": f"divergence date — PDF titre dit '{resultat_total.date_page}' "
                      f"mais config['dates']['{jour_deduit}'] dit '{date_config_iso}'",
            "indice": "l'un des deux est faux — vérifier le PDF (titre) ou la config",
        })
    # Fallback : titre non extrait mais on peut déduire du nom + config.
    if resultat_total.date_page is None and date_config_iso:
        resultat_total.date_page = date_config_iso
        resultat_total.erreurs_vraisemblance.append({
            "niveau": "warning",
            "fichier": chemin.name,
            "raison": f"date extraite via config['dates']['{jour_deduit}'] = "
                      f"'{date_config_iso}' (titre PDF non détecté)",
            "indice": "fallback appliqué — vérifier que la date correspond au contenu",
        })

    return resultat_total
