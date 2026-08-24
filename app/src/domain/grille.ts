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

function normaliserFinMinuit(t: HhMm): HhMm {
  return t === '00:00' ? '24:00' : t
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
    const finNormale = normaliserFinMinuit(regle.fin)
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
      const finNormale = normaliserFinMinuit(regle.fin)
      if (c.debut >= regle.debut && c.debut < finNormale) return true
    }
    return false
  }

  const butoirKey = `${session.date_butoir}T${session.butoir_heure.replace(':', '')}`

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
    .filter((c) => `${c.date}T${c.debut.replace(':', '')}` < butoirKey)
    .filter((c) => !maintenantKey || `${c.date}T${c.debut.replace(':', '')}` >= maintenantKey)
    .sort((a, b) => a.id.localeCompare(b.id))
}
