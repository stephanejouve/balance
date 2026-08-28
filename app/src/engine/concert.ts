import type { Groupe } from '../domain/model'

/**
 * Ordre de passage du concert — brief §5. Minimise les mouvements de
 * plateau : quand un musicien est déjà sur scène pour le morceau N-1 et
 * qu'il joue dans le morceau N, il ne redescend pas. On utilise donc le
 * nombre de musiciens communs comme mesure de continuité.
 *
 * Heuristique greedy V1 :
 *  - démarrer par le groupe le plus « pivot » (celui qui partage avec le
 *    plus grand nombre d'autres, pour laisser flexibilité en aval)
 *  - à chaque étape, choisir le groupe suivant qui maximise le nombre
 *    de musiciens communs avec le précédent, avec bonus si le style est
 *    différent (favorise l'alternance).
 *
 * Extensions à venir (§5) : regrouper les batteurs de même latéralité,
 * jamais > 3 morceaux d'affilée pour une même personne, coupures.
 */

export interface EtapeConcert {
  groupe_id: string
  titre: string
  musiciens_partages_avec_precedent: number
  musiciens_qui_montent: string[]
  musiciens_qui_descendent: string[]
  style: string
}

export interface OrdreConcert {
  etapes: EtapeConcert[]
  mouvements_total: number
}

function membres(g: Groupe): Set<string> {
  return new Set(g.membres.map((m) => m.personne_id))
}

export function ordonnerConcert(groupes: readonly Groupe[]): OrdreConcert {
  if (groupes.length === 0) return { etapes: [], mouvements_total: 0 }

  const restants = new Set(groupes.map((g) => g.id))
  const parId = new Map(groupes.map((g) => [g.id, g]))
  const membresPar = new Map(groupes.map((g) => [g.id, membres(g)]))

  // Groupe pivot de départ : celui qui partage avec le plus d'autres
  const scorePivot = new Map<string, number>()
  for (const g1 of groupes) {
    let s = 0
    const m1 = membresPar.get(g1.id)!
    for (const g2 of groupes) {
      if (g1.id === g2.id) continue
      const m2 = membresPar.get(g2.id)!
      for (const p of m1) if (m2.has(p)) s++
    }
    scorePivot.set(g1.id, s)
  }
  const idDepart = [...restants].sort((a, b) => (scorePivot.get(b) ?? 0) - (scorePivot.get(a) ?? 0))[0]

  const etapes: EtapeConcert[] = []
  let precedentMembres = new Set<string>()
  // Style du groupe précédent — chaîne vide tant qu'aucune étape posée.
  // Évite un `Groupe | null` mutable dont TS ne narrow pas à travers la
  // closure `ajouter()`.
  let precedentStyle = ''

  const ajouter = (id: string) => {
    const g = parId.get(id)!
    const m = membresPar.get(id)!
    const partages = [...m].filter((p) => precedentMembres.has(p)).length
    const montent = [...m].filter((p) => !precedentMembres.has(p))
    const descendent = [...precedentMembres].filter((p) => !m.has(p))
    etapes.push({
      groupe_id: id,
      titre: g.titre,
      musiciens_partages_avec_precedent: partages,
      musiciens_qui_montent: montent,
      musiciens_qui_descendent: descendent,
      style: g.style,
    })
    precedentMembres = m
    precedentStyle = g.style
    restants.delete(id)
  }

  ajouter(idDepart)

  while (restants.size > 0) {
    // Choisir le suivant : max partagés, bonus si style différent
    let meilleur: string | null = null
    let meilleurScore = -Infinity
    for (const id of restants) {
      const m = membresPar.get(id)!
      const partages = [...m].filter((p) => precedentMembres.has(p)).length
      const candidatStyle = parId.get(id)!.style
      const styleDiff =
        precedentStyle && candidatStyle && precedentStyle !== candidatStyle ? 1 : 0
      const s = partages * 10 + styleDiff
      if (s > meilleurScore) {
        meilleurScore = s
        meilleur = id
      }
    }
    if (meilleur == null) break
    ajouter(meilleur)
  }

  const mouvements_total = etapes.reduce(
    (s, e) => s + e.musiciens_qui_montent.length + e.musiciens_qui_descendent.length,
    0,
  )
  return { etapes, mouvements_total }
}
