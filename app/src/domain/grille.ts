import type { HhMm, IsoDate, Lieu, Session } from './model'

/**
 * Créneau matérialisé, produit du déploiement d'une `RegleCreneau` sur les
 * jours de la session. Le solveur travaille sur cette liste plate.
 */
export interface Creneau {
  id: string
  date: IsoDate
  debut: HhMm
  fin: HhMm
  /** Salles disponibles sur ce créneau (IDs). */
  salles: string[]
}

/* -------------------------------------------------------- Helpers de temps */

function toMinutes(t: HhMm): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function fromMinutes(m: number): HhMm {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

interface Tour {
  debut: HhMm
  fin: HhMm
}

/**
 * Découpe une plage `[debut, fin]` en tours de `pasMinutes` minutes.
 *
 * **Convention** (CD msg 6856, arbitrée post-incident hotfix²) : `fin`
 * est INCLUSIVE — c'est la dernière minute effectivement occupée par
 * la plage. La saisie utilisateur porte cette convention depuis la
 * PR 2a (mention « on a interprété 18:30 comme 18:29 »), le calcul
 * doit la suivre.
 *
 * Formule : `nb = floor((fin + 1 − debut) / pas)`. L'ajout du `+1` fait
 * la bascule inclusive → exclusive au niveau du compte. Exemples :
 *  - `13:30 → 18:29` pas 60 : `(1109 + 1 − 810) / 60 = 5` tours
 *  - `13:30 → 18:30` pas 60 : `(1110 + 1 − 810) / 60 = 5.01 → 5` tours
 *  - `13:37 → 18:36` pas 60 : `(1116 + 1 − 817) / 60 = 5` tours
 *  - `09:00 → 11:59` pas 60 : `(719 + 1 − 540) / 60 = 3` tours
 *  - `22:00 → 23:59` pas 60 : `(1439 + 1 − 1320) / 60 = 2` tours
 *
 * **Invariant clé** (test verrouillé) : pour toute paire (debut, pas),
 * le compte de créneaux est identique avant et après conversion de la
 * saisie — `13:30 → 18:30` et `13:30 → 18:29` donnent 5 tous les deux.
 *
 * Les tours émis portent `debut` (inclusif) et `fin` (exclusif interne
 * — c'est-à-dire `debut + pas`), inchangés par rapport à la version
 * pré-hotfix³. L'affichage utilisateur passe par `finInclusive`.
 */
export function decouper(debut: HhMm, fin: HhMm, pasMinutes: number): Tour[] {
  const start = toMinutes(debut)
  const end = toFinMinutes(fin)
  if (end < start || pasMinutes <= 0) return []
  const nb = Math.floor((end + 1 - start) / pasMinutes)
  return Array.from({ length: nb }, (_, i) => ({
    debut: fromMinutes(start + i * pasMinutes),
    fin: fromMinutes(start + (i + 1) * pasMinutes),
  }))
}

const JOURS_FR = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

/**
 * Convertit une liste de « jours » (dates ISO OU noms de jour FR : lundi,
 * mardi… — tolérant à la casse et aux accents) en dates ISO effectivement
 * présentes dans la session. Les valeurs non reconnues sont ignorées.
 */
export function resoudreJours(saisi: readonly string[], joursSession: readonly IsoDate[]): IsoDate[] {
  const out = new Set<IsoDate>()
  const sessionSet = new Set(joursSession)
  for (const s of saisi) {
    const norm = s
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
    if (/^\d{4}-\d{2}-\d{2}$/.test(norm)) {
      if (sessionSet.has(norm)) out.add(norm)
      continue
    }
    const idx = JOURS_FR.indexOf(norm)
    if (idx < 0) continue
    for (const d of joursSession) {
      const [y, m, day] = d.split('-').map(Number)
      const dt = new Date(Date.UTC(y, m - 1, day))
      if (dt.getUTCDay() === idx) out.add(d)
    }
  }
  return [...out].sort()
}

/**
 * Convertit une borne de fin en minutes en traitant `'00:00'` comme la
 * dernière minute du jour (`23:59` = 1439 min).
 *
 * Le modèle porte désormais des bornes de fin INCLUSIVES (CD msg 6856).
 * `decouper`, `estBloqué` et les checks du diagnostic passent tous par
 * cet helper pour rester alignés — et pour gérer proprement le cas
 * legacy `fin: '00:00'` (fin de journée) qui ne peut pas s'exprimer en
 * modulo positif sur le même jour.
 *
 * Note historique : cette fonction remplace `normaliserFinBorne` qui
 * poussait `H:59 → (H+1):00` pour compenser un `decouper` en fin
 * exclusive. Le hotfix³ (CD 6856) fait porter la convention par
 * `decouper` lui-même (`nb = floor((fin+1 − debut)/pas)`), rendant la
 * compensation obsolète.
 */
export function toFinMinutes(fin: HhMm): number {
  if (fin === '00:00') return 24 * 60 - 1
  return toMinutes(fin)
}

/**
 * Reconstruit la borne de fin d'une plage `{ debut, duree_minutes?, fin? }`
 * en minutes **inclusives** (dernière minute occupée), ou renvoie
 * `null` si aucune borne calculable.
 *
 * Cap durée (CD 6876+6891) : les 3 plages brutes (Indispo, Seance,
 * RestrictionHoraire) portent désormais `duree_minutes` en canonique,
 * **convention EXCLUSIVE** (fin d'indispo depuis toujours) — le champ
 * `duree` désigne le nombre de minutes occupées, plage `[debut, debut +
 * duree[` exclusive côté sémantique. Ce helper retourne l'index de la
 * dernière minute effectivement occupée pour un usage direct par les
 * consommateurs `estBloqué`, `salleRestreinte`, `indispoBloque`.
 *
 * Priorité :
 *  1. `duree_minutes` présent + `debut` présent → `toMinutes(debut) + duree − 1`
 *     (dernier moment occupé — `duree=0` retourne `debut - 1`, plage vide).
 *  2. Sinon `fin` présent (JSON legacy sans passer par preprocess) →
 *     convention exclusive `toMinutes(fin) − 1`, sauf `'00:00'` traité
 *     comme fin de journée = 1439 (inclusive).
 *  3. Sinon `null`.
 */
export function finMinutesDe(o: {
  debut?: string
  duree_minutes?: number
  fin?: string
}): number | null {
  if (typeof o.duree_minutes === 'number' && typeof o.debut === 'string') {
    return toMinutes(o.debut as HhMm) + o.duree_minutes - 1
  }
  if (typeof o.fin === 'string' && o.fin.length > 0) {
    // `'00:00'` = fin de journée inclusive (23:59 = 1439).
    if (o.fin === '00:00') return 24 * 60 - 1
    // Autres : convention exclusive legacy → dernière minute occupée = fin − 1.
    return toMinutes(o.fin as HhMm) - 1
  }
  return null
}

/**
 * Transforme une borne de fin exclusive interne en la dernière unité
 * effectivement occupée par la plage (fin inclusive affichée).
 *
 * Convention Stéphane (CD msg 6832) : « la dernière unité affichée
 * appartient au créneau ». À l'écran et dans les exports, une plage
 * `[debut, fin[` interne est présentée comme `[debut, fin−1 min]`. Deux
 * créneaux consécutifs cessent alors de partager visuellement leur
 * frontière — `18:00–18:30` puis `18:30–19:00` devient `18:00–18:29`
 * puis `18:30–18:59`.
 *
 * Contrat :
 *  - `'12:00'` → `'11:59'`, `'12:30'` → `'12:29'` (pas quelconque)
 *  - `'00:00'` et `'24:00'` (borne minuit fin-de-jour, produite en
 *    interne par `normaliserFinBorne`) → `'23:59'`
 *
 * Fonction pure. Symétrique inverse de `normaliserFinBorne` côté
 * présentation : `normaliserFinBorne` pousse la borne EN AVANT pour le
 * calcul, `finInclusive` la ramène EN ARRIÈRE pour l'affichage.
 */
export function finInclusive(t: HhMm): HhMm {
  const [h, m] = t.split(':').map(Number)
  const totalMin = h * 60 + m
  // Cas frontière : `00:00` interne = fin de journée (avant que
  // `normaliserFinBorne` ait poussé vers `24:00`). Reculer d'une minute
  // depuis 0 tombe sur 23:59 du jour, pas sur -1.
  const inc = totalMin === 0 ? 24 * 60 - 1 : totalMin - 1
  const hh = Math.floor(inc / 60)
  const mm = inc % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

/**
 * Applique la convention Stéphane (CD msg 6798 / 6832 / 6850) à une
 * valeur saisie utilisateur : convertit une borne qui tombe **pile sur
 * une frontière de créneau** (donc exclusive) vers la dernière minute
 * effectivement occupée, en signalant l'écart pour que l'UI affiche
 * une mention persistante informative.
 *
 * **Critère** (Stéphane, relayé CD 6850 puis affiné 6853) : la frontière
 * est calculée par rapport au DÉBUT de la plage, pas depuis minuit. Le
 * dernier créneau d'une plage `13:30 → 18:30` pas 60 finit bien à
 * `18:30` — c'est une frontière du 5ᵉ tour, à convertir en `18:29`,
 * même si `18:30` en absolu n'est pas un multiple de 60.
 *
 * Formule : la saisie est corrigée SSI
 * `(finMinutes − debutMinutes) % pasMinutes === 0`.
 *
 * Contrat :
 *  - Chaîne vide, pas invalide, entrée mal formée → laissé tel quel.
 *  - Saisie sur frontière relative au début → convertie via
 *    `finInclusive`, `original = saisie` (mention à afficher).
 *  - Toute autre saisie → laissée telle quelle (CD 6850 « n'invente
 *    pas de correction pour ce cas »).
 *
 * Historique des critères :
 *  1. PR #125 : `endsWith(':59')` — cassait `18:29` en `18:28` (dérive).
 *  2. PR #128 : `totalMin % pas === 0` — ratait `13:30 → 18:30` pas 60
 *     car `1110 % 60 = 30 ≠ 0`.
 *  3. Cette version : critère relatif au début, correct pour toute
 *     paire (debut, pas).
 *
 * Fonction pure. Utilisée par les 4 inputs `<input type="time">` de la
 * fin de plage (Session grille, Lieu restrictions, Imposes seances,
 * Indispos). Aussi par `appliquerImportJson` pour rattraper les JSON
 * produits avant l'entrée en vigueur.
 */
export function corrigerSaisieFin(
  saisie: string,
  pasMinutes: number,
  debutMinutes: number,
): { valeur: string; original: string | null } {
  if (saisie === '') return { valeur: saisie, original: null }
  if (pasMinutes <= 0) return { valeur: saisie, original: null }
  if (!Number.isFinite(debutMinutes)) return { valeur: saisie, original: null }
  const parts = saisie.split(':')
  if (parts.length !== 2) return { valeur: saisie, original: null }
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return { valeur: saisie, original: null }
  const finMin = h * 60 + m
  // Frontière relative au début (CD 6853). Une saisie strictement
  // antérieure au début est laissée telle quelle — le contrôle `end <=
  // start` de `decouper` prend le relais et retourne une liste vide,
  // ce n'est pas à la couche de conversion de trancher.
  if (finMin <= debutMinutes) return { valeur: saisie, original: null }
  if ((finMin - debutMinutes) % pasMinutes === 0) {
    return { valeur: finInclusive(saisie as HhMm), original: saisie }
  }
  return { valeur: saisie, original: null }
}

/** Convertit une chaîne HH:MM en total de minutes, ou `null` si invalide. */
function parseHhMmToMinutes(s: string | undefined): number | null {
  if (s === undefined || s === '') return null
  const parts = s.split(':')
  if (parts.length !== 2) return null
  const h = Number(parts[0])
  const m = Number(parts[1])
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return h * 60 + m
}

/**
 * Applique `corrigerSaisieFin` en place sur un objet portant un champ
 * `fin` et son compagnon `fin_saisie_original` optionnel — utilisé à
 * l'import JSON pour rattraper les fichiers produits avant l'entrée en
 * vigueur de la convention Stéphane.
 *
 * Idempotent : si `fin_saisie_original` est déjà renseigné, le JSON
 * vient d'une source correcte (post-PR 2a), aucune re-correction n'est
 * appliquée. Sinon la correction s'applique et écrit les deux champs
 * de façon cohérente.
 *
 * `pasMinutes` et `debut` sont requis (CD 6850 + 6853) : le critère de
 * conversion dépend du pas ET du début (frontière relative). Pour une
 * règle de grille, `pasMinutes = regle.pas_minutes` et `debut = regle.debut`.
 * Pour un contexte sans pas propre (restriction de salle, séance
 * imposée, indispo), passer `pasMinutes = null` court-circuite la
 * correction — la saisie utilisateur seule fait foi.
 *
 * Mute l'objet en place. Utilisé sur des `$state` Svelte 5 dans
 * `appliquerImportJson` App.svelte.
 */
export function appliquerCorrectionFinSaisie(
  o: { fin?: string; fin_saisie_original?: string },
  pasMinutes: number | null,
  debut: string | undefined,
): void {
  if (o.fin_saisie_original !== undefined) return
  if (o.fin === undefined || o.fin === '') return
  if (pasMinutes === null) return
  const debutMin = parseHhMmToMinutes(debut)
  if (debutMin === null) return
  const r = corrigerSaisieFin(o.fin, pasMinutes, debutMin)
  o.fin = r.valeur === '' ? undefined : r.valeur
  if (r.original !== null) o.fin_saisie_original = r.original
}

/**
 * Énumère les dates ISO entre `debut` et `fin` (inclus des deux côtés).
 * Utilise Date.UTC pour éviter les décalages de fuseau.
 */
export function joursDeSession(debut: IsoDate, fin: IsoDate): IsoDate[] {
  const [dy, dm, dd] = debut.split('-').map(Number)
  const [fy, fm, fd] = fin.split('-').map(Number)
  const start = Date.UTC(dy, dm - 1, dd)
  const end = Date.UTC(fy, fm - 1, fd)
  const out: IsoDate[] = []
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t)
    out.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
        d.getUTCDate(),
      ).padStart(2, '0')}`,
    )
  }
  return out
}

/* --------------------------------------------------------- Générateur ----*/

export interface GenererOptions {
  /**
   * Date de référence « maintenant ». Si fournie, les créneaux dont le
   * début est strictement antérieur sont écartés — inutile de proposer
   * des répétitions à des dates déjà échues quand on refait le planning
   * en cours de session.
   */
  maintenant?: Date
}

/**
 * Déploie la grille de règles de la session sur les jours du calendrier
 * puis applique les règles de blocage.
 *
 * Sémantique :
 *  - une règle sans `jours` = tous les jours de la session
 *  - une règle sans `salles` = toutes les salles actives du lieu
 *  - une règle `bloque: true` retire tout créneau dont le début tombe dans
 *    sa plage `[debut, fin[` sur les jours ciblés
 *  - filtrage final : `date_butoir` + `butoir_heure` de la session
 *  - filtrage optionnel : créneaux dont le début est strictement antérieur
 *    à `options.maintenant` (utile pour un recalcul en cours de session)
 */
export function genererCreneaux(session: Session, lieu: Lieu, options: GenererOptions = {}): Creneau[] {
  const jours = joursDeSession(session.date_debut, session.date_fin)
  const sallesActives = lieu.salles.filter((s) => s.actif).map((s) => s.id)

  const reglesCreatrices = session.grille.filter((r) => !r.bloque)
  const reglesBloqueuses = session.grille.filter((r) => r.bloque)

  const emitted: Creneau[] = []
  for (const regle of reglesCreatrices) {
    const jourReglés = regle.jours.length ? resoudreJours(regle.jours, jours) : jours
    const salles = regle.salles.length ? regle.salles : sallesActives
    for (const jour of jourReglés) {
      for (const tour of decouper(regle.debut, regle.fin, regle.pas_minutes)) {
        emitted.push({
          id: `${jour}T${tour.debut.replace(':', '')}`,
          date: jour,
          debut: tour.debut,
          fin: tour.fin,
          salles: [...salles],
        })
      }
    }
  }

  const estBloqué = (c: Creneau): boolean => {
    for (const regle of reglesBloqueuses) {
      const jourReglés = regle.jours.length ? resoudreJours(regle.jours, jours) : jours
      if (!jourReglés.includes(c.date)) continue
      // Convention inclusive (CD 6856) : un créneau est bloqué si son
      // début tombe dans `[regle.debut, regle.fin]` inclusive.
      const debutCreneauMin = toMinutes(c.debut)
      const debutRegleMin = toMinutes(regle.debut)
      const finRegleMin = toFinMinutes(regle.fin)
      if (debutCreneauMin >= debutRegleMin && debutCreneauMin <= finRegleMin) return true
    }
    return false
  }

  // Le générateur produit tous les créneaux jusqu'au butoir MAXIMUM des deux
  // échéances (issue #103) — le filtre par échéance est appliqué en aval, au
  // moment où l'assignation d'un groupe à un créneau est décidée (voir
  // `butoirDeGroupe` ci-dessous, consommé par le solveur et `verify.ts`).
  // Générer jusqu'au max évite deux générations distinctes ; la filtration
  // amont ne coûte qu'une comparaison de clés.
  const butoirKeyApero = `${session.butoir_apero_date}T${session.butoir_apero_heure.replace(':', '')}`
  const butoirKeyVendredi = `${session.butoir_vendredi_date}T${session.butoir_vendredi_heure.replace(':', '')}`
  const butoirKeyMax = butoirKeyVendredi > butoirKeyApero ? butoirKeyVendredi : butoirKeyApero

  const maintenantKey = options.maintenant
    ? (() => {
        const d = options.maintenant
        const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const h = `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
        return `${iso}T${h}`
      })()
    : null

  return emitted
    .filter((c) => !estBloqué(c))
    .filter((c) => `${c.date}T${c.debut.replace(':', '')}` < butoirKeyMax)
    .filter((c) => !maintenantKey || `${c.date}T${c.debut.replace(':', '')}` >= maintenantKey)
    .sort((a, b) => a.id.localeCompare(b.id))
}

/* ------------------------------------------------- Diagnostic non-configurable */

/**
 * Catégorie de défaut détecté par `diagnostiquerGrille` — utile côté UI pour
 * grouper les raisons quand plusieurs règles sont pathologiques (issues #110
 * et #111). Le libellé UI est construit par le composant à partir de la
 * catégorie + du contexte de la règle (index humain, plage, etc.) — la
 * fonction pure ne produit ni ne traduit de phrase.
 *
 * Sémantique par catégorie (dans l'ordre d'évaluation) :
 *  - `jours-invalides` : la règle a des jours listés qui ne matchent aucun
 *    jour de la session (ou aucun jour reconnu par `resoudreJours`).
 *  - `plage-vide` : `fin < debut` (bornes inclusives, `toFinMinutes` gère
 *    le cas `'00:00'` = fin de journée).
 *  - `pas-trop-grand` : `pas_minutes > (fin + 1 - debut)` — la division
 *    entière retourne 0 tour, aucun créneau émis. `pas_minutes <= 0` tombe
 *    dans le même bucket (impossible via l'UI, borne défensive).
 *  - `tout-bloqué` : chaque créneau émis par la règle est capturé par une
 *    règle de blocage postérieure ou tombe au-delà du butoir maximal.
 */
export type CategorieDefautRegle =
  | 'jours-invalides'
  | 'plage-vide'
  | 'pas-trop-grand'
  | 'tout-bloqué'

export interface DefautRegle {
  /** Index de la règle dans `session.grille` (ordre saisi UI, 0-based). */
  regleIndex: number
  categorie: CategorieDefautRegle
  /** Instantané de la règle pour affichage (debut/fin bruts, avant normalisation). */
  debut: HhMm
  fin: HhMm
}

/**
 * Catégorie de défaut global (indépendant d'une règle particulière). Utile
 * pour distinguer les cas où la session est inconfigurable pour une raison
 * plus haute que la grille (session sans jour, aucune règle créatrice).
 *
 * `aucune-salle-active` n'est PAS listée ici : quand aucune salle du lieu
 * n'est active, `genererCreneaux` émet quand même des créneaux avec
 * `salles=[]` (donc `nb_creneaux > 0`). Ce cas produit une CAPACITÉ nulle,
 * pas une grille vide — il est capturé côté `DiagStage` (analyserCapaciteStage)
 * et fait l'objet d'un défaut séparé (à traiter dans #111 seul, sans
 * confondre avec le compteur muet #110).
 */
export type CategorieDefautGlobal =
  | 'aucune-regle-creatrice'
  | 'session-sans-jour'
  | 'session-terminee'

/**
 * Résultat de `diagnostiquerGrille`. `configurable === true` ssi le générateur
 * produit au moins un créneau. Sinon `defauts_regles` et `defauts_globaux`
 * documentent pourquoi — sans phrase pré-fabriquée : l'UI compose son message
 * à partir des catégories.
 */
export interface DiagnosticGrille {
  configurable: boolean
  nb_creneaux: number
  defauts_regles: DefautRegle[]
  defauts_globaux: CategorieDefautGlobal[]
}

/**
 * Diagnostic pré-génération : quand la grille produit 0 créneau alors que
 * des règles créatrices sont définies, cette fonction nomme ce qui cloche.
 *
 * Contexte (issues #110 et #111) : l'écran Session affichait « X règle(s)
 * créatrice(s) → 0 créneaux » sans nommer l'écart, et le contrôle en amont
 * rapportait `N musicien(s) n'a accès à aucun créneau SUR 0` — N lignes
 * nominatives pour une cause GLOBALE. Ce diagnostic remonte ce que
 * `genererCreneaux` sait déjà (par construction : il itère règle par règle
 * et voit celles qui ne contribuent rien) mais qui n'était pas exposé.
 *
 * Contrat :
 *  - Si `nb_creneaux > 0` : `configurable = true`, listes vides. La
 *    fonction ne signale RIEN d'utilisable quand la génération réussit —
 *    l'UI n'a rien à afficher dans ce cas.
 *  - Si `nb_creneaux == 0` : `configurable = false`, les listes portent
 *    la cause. `defauts_globaux` d'abord (raisons plus hautes que la
 *    grille), `defauts_regles` ensuite (chaque règle pathologique).
 *
 * Le paramètre optionnel `options.maintenantIso` (`YYYY-MM-DD`) permet
 * d'identifier le cas « session terminée » (CD msg 6839) : quand la
 * grille est saine mais que `date_fin` est strictement antérieure à
 * `maintenantIso`, le filtre `maintenant` de `genererCreneaux` écrase
 * tous les créneaux — le diagnostic doit le dire au lieu de pointer
 * vers des règles pathologiques inexistantes.
 *
 * Fonction pure — ne mute rien. Réutilise `genererCreneaux` pour le compte
 * final (garantie que le diagnostic reste cohérent si le générateur change).
 */
export function diagnostiquerGrille(
  session: Session,
  lieu: Lieu,
  options: { maintenantIso?: string } = {},
): DiagnosticGrille {
  // Défaut global prioritaire : session terminée (CD msg 6839). Quand
  // `maintenantIso > session.date_fin`, l'utilisateur ne verra AUCUN
  // créneau au présent — court-circuit AVANT d'appeler `genererCreneaux`
  // et AVANT tout diagnostic de règle. La grille peut être parfaitement
  // saine (ou pas), peu importe : le vrai remède est de rejouer à une
  // date antérieure, pas de corriger la grille.
  //
  // Note : `nb_creneaux` est mis à 0 par convention (aucun placement
  // possible au présent), pas le résultat brut de `genererCreneaux`
  // sans filtre — le filtre `maintenant` est justement ce qui écrase.
  if (options.maintenantIso && session.date_fin < options.maintenantIso) {
    return {
      configurable: false,
      nb_creneaux: 0,
      defauts_regles: [],
      defauts_globaux: ['session-terminee'],
    }
  }

  const nb_creneaux = genererCreneaux(session, lieu).length
  if (nb_creneaux > 0) {
    return { configurable: true, nb_creneaux, defauts_regles: [], defauts_globaux: [] }
  }

  const defauts_globaux: CategorieDefautGlobal[] = []
  const defauts_regles: DefautRegle[] = []

  const jours = joursDeSession(session.date_debut, session.date_fin)
  const reglesCreatrices = session.grille
    .map((r, i) => ({ regle: r, index: i }))
    .filter(({ regle }) => !regle.bloque)
  const reglesBloqueuses = session.grille.filter((r) => r.bloque)

  // Défauts globaux — évalués une fois, indépendamment des règles.
  if (jours.length === 0) defauts_globaux.push('session-sans-jour')
  if (reglesCreatrices.length === 0) defauts_globaux.push('aucune-regle-creatrice')

  // Butoirs — même calcul que `genererCreneaux` pour rester aligné.
  const butoirKeyApero = `${session.butoir_apero_date}T${session.butoir_apero_heure.replace(':', '')}`
  const butoirKeyVendredi = `${session.butoir_vendredi_date}T${session.butoir_vendredi_heure.replace(':', '')}`
  const butoirKeyMax = butoirKeyVendredi > butoirKeyApero ? butoirKeyVendredi : butoirKeyApero

  // Diagnostic par règle créatrice, dans l'ordre saisi.
  for (const { regle, index } of reglesCreatrices) {
    const jourReglés = regle.jours.length ? resoudreJours(regle.jours, jours) : jours
    if (jourReglés.length === 0) {
      // La règle a `jours` non vide mais aucun n'est reconnu ou présent
      // dans la session. Cas `regle.jours = []` sans jour de session est
      // couvert par le défaut global `session-sans-jour`, on ne redouble pas.
      if (regle.jours.length > 0) {
        defauts_regles.push({
          regleIndex: index,
          categorie: 'jours-invalides',
          debut: regle.debut,
          fin: regle.fin,
        })
      }
      continue
    }

    // Convention inclusive (CD 6856) : la largeur d'une plage `[debut, fin]`
    // vaut `fin + 1 − debut` en minutes.
    const debutMin = toMinutes(regle.debut)
    const finMin = toFinMinutes(regle.fin)
    if (finMin < debutMin) {
      defauts_regles.push({
        regleIndex: index,
        categorie: 'plage-vide',
        debut: regle.debut,
        fin: regle.fin,
      })
      continue
    }
    if (regle.pas_minutes <= 0 || regle.pas_minutes > finMin + 1 - debutMin) {
      defauts_regles.push({
        regleIndex: index,
        categorie: 'pas-trop-grand',
        debut: regle.debut,
        fin: regle.fin,
      })
      continue
    }

    // La règle émettrait des créneaux — vérifier s'ils sont TOUS effacés par
    // blocage ou butoir. Rejouer decouper + estBloqué sur chaque jour de la
    // règle, compter les survivants.
    const tours = decouper(regle.debut, regle.fin, regle.pas_minutes)
    let survivants = 0
    for (const jour of jourReglés) {
      for (const tour of tours) {
        const cleCreneau = `${jour}T${tour.debut.replace(':', '')}`
        if (cleCreneau >= butoirKeyMax) continue
        const tourDebutMin = toMinutes(tour.debut)
        const bloquePar = reglesBloqueuses.some((rb) => {
          const jrb = rb.jours.length ? resoudreJours(rb.jours, jours) : jours
          if (!jrb.includes(jour)) return false
          const rbDebutMin = toMinutes(rb.debut)
          const rbFinMin = toFinMinutes(rb.fin)
          return tourDebutMin >= rbDebutMin && tourDebutMin <= rbFinMin
        })
        if (!bloquePar) survivants++
      }
    }
    if (survivants === 0) {
      defauts_regles.push({
        regleIndex: index,
        categorie: 'tout-bloqué',
        debut: regle.debut,
        fin: regle.fin,
      })
    }
  }

  return { configurable: false, nb_creneaux, defauts_regles, defauts_globaux }
}

/**
 * Renvoie le butoir (date + heure) applicable à un groupe selon son échéance —
 * issue #103. Consommé par les callers UI qui passent un `{date, heure}`
 * (déplacement manuel, candidats case libre, etc.).
 */
export function butoirDeGroupe(
  session: Pick<Session, 'butoir_apero_date' | 'butoir_apero_heure' | 'butoir_vendredi_date' | 'butoir_vendredi_heure'>,
  echeance: 'apero_mercredi' | 'restitution_vendredi',
): { date: string; heure: string } {
  if (echeance === 'restitution_vendredi') {
    return { date: session.butoir_vendredi_date, heure: session.butoir_vendredi_heure }
  }
  return { date: session.butoir_apero_date, heure: session.butoir_apero_heure }
}

/**
 * Version compacte pour comparaison de clés — même signature que les clés
 * créneau (`YYYY-MM-DDTHHMM`). Utilisé par `solver.ts::estLibre` et
 * `verify.ts::butoirDuGroupe` pour filtrer sans re-formater à chaque appel.
 */
export function butoirKeyDeGroupe(
  session: Pick<Session, 'butoir_apero_date' | 'butoir_apero_heure' | 'butoir_vendredi_date' | 'butoir_vendredi_heure'>,
  echeance: 'apero_mercredi' | 'restitution_vendredi',
): string {
  const b = butoirDeGroupe(session, echeance)
  return `${b.date}T${b.heure.replace(':', '')}`
}
