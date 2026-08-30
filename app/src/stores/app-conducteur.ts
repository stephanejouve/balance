import type { EtapeConcert } from '../engine/concert'
import type { Groupe, Personne } from '../domain/model'

/**
 * Logique pure du conducteur du spectacle : minutage des étapes,
 * répartition des styles, palette. Extraite d'App.svelte (audit
 * Leader — dérivés critiques inline).
 *
 * Toutes les fonctions ici sont pures : elles prennent l'état en
 * paramètre et renvoient le calcul, sans effet de bord ni dépendance
 * au runtime Svelte. Testables unitairement, réutilisables entre
 * l'App et de futurs exports.
 */

export interface EtapeMinutee extends EtapeConcert {
  heure_debut: string
  heure_fin: string
  duree_min: number
  /** Temps ajouté avant cette étape pour changement plateau et/ou inversion kit. */
  change_min: number
  /** True si une inversion de kit doit se faire pendant le changement précédent. */
  inversion_kit: boolean
  lateralite?: 'droitier' | 'gaucher'
}

export interface ConducteurMinuté {
  etapes: EtapeMinutee[]
  duree_totale_min: number
  heure_fin: string
  nb_inversions: number
}

export interface ParamsMinutage {
  debut: string
  dureeMorceau: number
  dureeChange: number
  dureeKit: number
}

/**
 * Identifie le batteur d'un groupe et retourne sa latéralité (si connue).
 * La latéralité est portée par l'instrument batterie de la personne
 * (pas par la personne elle-même) — sémantique batterie-spécifique
 * pour l'inversion de kit entre morceaux.
 *
 * Renvoie `null` si pas de batteur ou latéralité inconnue.
 */
export function lateraliteBatteur(
  groupe_id: string,
  groupesParId: Map<string, Groupe>,
  personnesParId: Map<string, Personne>,
): 'droitier' | 'gaucher' | null {
  const g = groupesParId.get(groupe_id)
  if (!g) return null
  const batteur = g.membres.find((m) => m.pupitre === 'batterie')
  if (!batteur) return null
  const p = personnesParId.get(batteur.personne_id)
  const insBatterie = p?.instruments.find((i) => i.pupitre === 'batterie')
  return insBatterie?.lateralite ?? null
}

/**
 * Calcule le minutage complet d'un ordre du conducteur : heure de chaque
 * étape, temps de changement plateau, inversions de kit détectées entre
 * batteurs de latéralités différentes.
 */
export function calculerConducteurMinuté(
  ordre: EtapeConcert[],
  params: ParamsMinutage,
  groupesParId: Map<string, Groupe>,
  personnesParId: Map<string, Personne>,
): ConducteurMinuté {
  const [dh, dm] = params.debut.split(':').map(Number)
  let t = dh * 60 + dm
  const debut = t
  const hhmm = (m: number): string =>
    `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const etapes: EtapeMinutee[] = []
  let dernierBatteur: { latéralité: 'droitier' | 'gaucher'; index: number } | null = null
  let nbInversions = 0
  ordre.forEach((e, i) => {
    const lat = lateraliteBatteur(e.groupe_id, groupesParId, personnesParId)
    let changeMin = 0
    let inversion = false
    if (i > 0) {
      changeMin = params.dureeChange
      if (lat && dernierBatteur && lat !== dernierBatteur.latéralité) {
        inversion = true
        nbInversions++
        changeMin = Math.max(changeMin, params.dureeKit)
      }
    }
    t += changeMin
    const heure_debut = hhmm(t)
    t += params.dureeMorceau
    etapes.push({
      ...e,
      heure_debut,
      heure_fin: hhmm(t),
      duree_min: params.dureeMorceau,
      change_min: changeMin,
      inversion_kit: inversion,
      lateralite: lat ?? undefined,
    })
    if (lat) dernierBatteur = { latéralité: lat, index: i }
  })
  return {
    etapes,
    duree_totale_min: t - debut,
    heure_fin: hhmm(t),
    nb_inversions: nbInversions,
  }
}

/**
 * Compte les mouvements de plateau entre deux étapes consécutives
 * (nombre de musiciens qui montent ou descendent). Utilisé pour scorer
 * la qualité d'un ordre du conducteur (moins de mouvements = plus
 * fluide entre morceaux).
 */
export function statsConducteur(
  ordre: EtapeConcert[],
  groupesParId: Map<string, Groupe>,
): { mouvements: number } {
  let mouvements = 0
  let precedents = new Set<string>()
  for (const e of ordre) {
    const g = groupesParId.get(e.groupe_id)
    const m = g ? new Set(g.membres.map((mm) => mm.personne_id)) : new Set<string>()
    const montent = [...m].filter((x) => !precedents.has(x)).length
    const descendent = [...precedents].filter((x) => !m.has(x)).length
    mouvements += montent + descendent
    precedents = m
  }
  return { mouvements }
}

export interface RepartitionStyles {
  parts: Array<{ style: string; n: number; pct: number }>
  runs: Array<{ style: string; debut: number; fin: number }>
}

/**
 * Répartition des styles dans l'ordre conducteur, avec runs (séquences
 * consécutives ≥ 3 du même style — signal à surveiller pour éviter
 * qu'un bloc devienne monotone).
 */
export function calculerRepartitionStyles(ordre: EtapeConcert[]): RepartitionStyles {
  const compte = new Map<string, number>()
  for (const e of ordre) {
    const k = e.style || '(sans style)'
    compte.set(k, (compte.get(k) ?? 0) + 1)
  }
  const total = ordre.length
  const parts = [...compte.entries()]
    .map(([style, n]) => ({ style, n, pct: total > 0 ? Math.round((n / total) * 100) : 0 }))
    .sort((a, b) => b.n - a.n)
  const runs: RepartitionStyles['runs'] = []
  let i = 0
  while (i < ordre.length) {
    let j = i
    while (j + 1 < ordre.length && ordre[j + 1].style === ordre[i].style && ordre[i].style) j++
    if (j - i + 1 >= 3) runs.push({ style: ordre[i].style, debut: i, fin: j })
    i = j + 1
  }
  return { parts, runs }
}

/** Palette dérivée du nom du style (hash → HSL) pour un rendu stable. */
export function couleurStyle(style: string): string {
  if (!style) return '#e8e5da'
  let h = 0
  for (let i = 0; i < style.length; i++) h = (h * 31 + style.charCodeAt(i)) % 360
  return `hsl(${h}, 55%, 78%)`
}
