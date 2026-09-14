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

export function decouper(debut: HhMm, fin: HhMm, pasMinutes: number): Tour[] {
  const start = toMinutes(debut)
  const end = toMinutes(fin)
  if (end <= start || pasMinutes <= 0) return []
  const nb = Math.floor((end - start) / pasMinutes)
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
 * Convertit une borne de fin saisie utilisateur en borne exclusive interne.
 *
 * Deux notations utilisateur sont acceptées pour désigner la fin d'une plage :
 *  - `'00:00'` (minuit fin de journée, saisi par certains navigateurs)
 *  - `'H:59'` (dernière minute de l'heure H — le sélecteur horaire HTML natif
 *    n'exposant pas `24:00`, cette écriture est la seule façon pour un
 *    organisateur d'exprimer « jusqu'à H+1 » via un champ standard)
 *
 * En interne, la convention `decouper` / `estBloqué` / `diagnostic` est
 * **fin exclusive** : la borne sortie est `(H+1):00` (ou `24:00` pour minuit).
 * Cette conversion appliquée uniformément aux 4 sites d'appel maintient la
 * symétrie règles créatrices / règles bloqueuses.
 */
export function normaliserFinBorne(t: HhMm): HhMm {
  if (t === '00:00') return '24:00'
  // `H:59` → `(H+1):00`. La regex garantit un format HH:MM valide en amont.
  if (t.endsWith(':59')) {
    const h = Number(t.slice(0, 2))
    return `${String(h + 1).padStart(2, '0')}:00`
  }
  return t
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
 * Applique la convention Stéphane (CD msg 6798 / 6832) à une valeur
 * saisie utilisateur : convertit une borne non finale (`H:00`, `H:30`,
 * etc.) vers la dernière minute effectivement occupée (`(H−1):59`,
 * `H:29`), en signalant l'écart pour que l'UI affiche une mention
 * persistante informative.
 *
 * Contrat :
 *  - Chaîne vide → renvoyée telle quelle (l'utilisateur n'a pas encore
 *    saisi, aucune correction à porter).
 *  - Borne déjà finale (finissant par `:59`) → renvoyée telle quelle,
 *    `original = null` (pas de mention à afficher).
 *  - Toute autre borne → `valeur = finInclusive(saisie)`, `original =
 *    saisie`. L'UI persiste `original` tant que `valeur` est là ; le
 *    jour où l'utilisateur ré-édite vers un H:59 naturel, l'original
 *    disparaît.
 *
 * Fonction pure. Utilisée par les 4 inputs `<input type="time">` de la
 * fin de plage : Session.grille[i].fin, Lieu.salles[j].restrictions[k].fin,
 * inscriptions.imposes[l].fin, Personne.indispos[m].fin. Aussi appelée
 * par `appliquerImportJson` pour corriger silencieusement à l'import
 * les JSON produits avant l'entrée en vigueur de la convention.
 */
export function corrigerSaisieFin(saisie: string): { valeur: string; original: string | null } {
  if (saisie === '') return { valeur: saisie, original: null }
  if (saisie.endsWith(':59')) return { valeur: saisie, original: null }
  return { valeur: finInclusive(saisie as HhMm), original: saisie }
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
 * Mute l'objet en place. Utilisé sur des `$state` Svelte 5 dans
 * `appliquerImportJson` App.svelte.
 */
export function appliquerCorrectionFinSaisie(
  o: { fin?: string; fin_saisie_original?: string },
): void {
  if (o.fin_saisie_original !== undefined) return
  if (o.fin === undefined || o.fin === '') return
  const r = corrigerSaisieFin(o.fin)
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
    const finNormale = normaliserFinBorne(regle.fin)
    for (const jour of jourReglés) {
      for (const tour of decouper(regle.debut, finNormale, regle.pas_minutes)) {
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
      const finNormale = normaliserFinBorne(regle.fin)
      if (c.debut >= regle.debut && c.debut < finNormale) return true
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
 *  - `plage-vide` : `debut >= fin` (fin normalisée via `normaliserFinBorne` :
 *    `00:00 → 24:00`, `H:59 → (H+1):00`).
 *  - `pas-trop-grand` : `pas_minutes > (fin - debut)` — la division entière
 *    retourne 0 tour, aucun créneau émis. `pas_minutes <= 0` tombe dans le
 *    même bucket (impossible via l'UI, borne défensive).
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
 * Fonction pure — ne mute rien. Réutilise `genererCreneaux` pour le compte
 * final (garantie que le diagnostic reste cohérent si le générateur change).
 */
export function diagnostiquerGrille(session: Session, lieu: Lieu): DiagnosticGrille {
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

    const finNormale = normaliserFinBorne(regle.fin)
    const debutMin = toMinutes(regle.debut)
    const finMin = toMinutes(finNormale)
    if (finMin <= debutMin) {
      defauts_regles.push({
        regleIndex: index,
        categorie: 'plage-vide',
        debut: regle.debut,
        fin: regle.fin,
      })
      continue
    }
    if (regle.pas_minutes <= 0 || regle.pas_minutes > finMin - debutMin) {
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
    const tours = decouper(regle.debut, finNormale, regle.pas_minutes)
    let survivants = 0
    for (const jour of jourReglés) {
      for (const tour of tours) {
        const cleCreneau = `${jour}T${tour.debut.replace(':', '')}`
        if (cleCreneau >= butoirKeyMax) continue
        const bloquePar = reglesBloqueuses.some((rb) => {
          const jrb = rb.jours.length ? resoudreJours(rb.jours, jours) : jours
          if (!jrb.includes(jour)) return false
          const finRbNormale = normaliserFinBorne(rb.fin)
          return tour.debut >= rb.debut && tour.debut < finRbNormale
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
