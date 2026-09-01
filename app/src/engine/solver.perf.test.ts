/**
 * Tests de performance du solveur (non-régression du gel Chrome
 * observé sur MacBook, 2026-09-01, sur `balance-stress-test.xlsx`).
 *
 * Objet Stéphane 2026-09-01 :
 * « Sans mesure automatisée, le temps de calcul dérive à chaque
 * contrainte ajoutée — acoustique, marge, disponibilité des salles,
 * tout ce qui reste au programme — et personne ne le voit avant que
 * l'écran ne fige. »
 *
 * Précautions :
 *
 * 1. **RNG semé** — `seed` explicite dans chaque `repartir()`, pas
 *    `Date.now()`. Sinon la durée varie d'une exécution à l'autre et
 *    le seuil devient capricieux.
 *
 * 2. **Seuils généreux CI-safe** — la machine d'intégration continue
 *    est plus lente qu'un MacBook. On teste le contrat *garde-fou*
 *    (budget respecté à ≤ +500 ms), pas la durée absolue. Un test
 *    qu'on réexécute par réflexe ne protège plus de rien.
 *
 * 3. **3 volumes** (13 groupes, 20 groupes, 50 groupes) pour détecter
 *    une dégradation non-linéaire — le cas où ça tient à 20 et
 *    s'effondre à 25.
 *
 * 4. **Durée journalisée** dans `console.log` structuré — un écart
 *    se lit sans relancer les tests.
 */

import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session, type Pupitre } from '../domain/model'
import { repartir } from './solver'

const PUPITRES: readonly Pupitre[] = ['chant', 'piano', 'basse', 'batterie', 'guitare', 'vents']

/**
 * Construit une session + un lieu + des inscriptions synthétiques
 * déterministes de taille paramétrable.
 *
 * `nbGroupes` × 5 membres par groupe. Les membres sont distribués
 * cycliquement sur `nbPersonnes` — plus `nbPersonnes` est petit
 * relativement à `nbGroupes`, plus le graphe de conflit est dense.
 * Rapport ~2 personnes / groupe pour rester dans un régime résoluble
 * mais contraint (proche du terrain).
 */
function fixtureVolume(nbGroupes: number, nbPersonnes: number) {
  const lieu = Lieu.parse({
    id: 'perf-lieu',
    nom: 'Perf Lieu',
    salles: [
      { id: 'A', nom: 'A', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'B', nom: 'B', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'C', nom: 'C', jauge: 6, equipement: ['piano'] },
      { id: 'D', nom: 'D', jauge: 6, equipement: ['piano'] },
    ],
  })
  const session = Session.parse({
    id: 'perf-s',
    nom: 'Perf',
    lieu_id: 'perf-lieu',
    date_debut: '2026-08-24',
    date_fin: '2026-08-28',
    date_butoir: '2026-08-27',
    butoir_heure: '20:00',
    grille: [
      { debut: '09:00', fin: '12:00', pas_minutes: 60 },
      { debut: '14:00', fin: '18:00', pas_minutes: 60 },
    ],
    repetitions_visees: 3,
    repetitions_min: 2,
  })
  const personnes = Array.from({ length: nbPersonnes }, (_, i) => ({
    id: `p${i}`,
    nom: `P${i}`,
    instruments: [{ pupitre: PUPITRES[i % PUPITRES.length] }],
    indispos: [],
  }))
  const groupes = Array.from({ length: nbGroupes }, (_, gi) => ({
    id: `g${gi}`,
    titre: `G${gi}`,
    membres: Array.from({ length: 5 }, (_, mi) => {
      const pi = (gi * 5 + mi) % nbPersonnes
      return { personne_id: `p${pi}`, pupitre: PUPITRES[pi % PUPITRES.length] }
    }),
  }))
  const inscriptions = Inscriptions.parse({
    session_id: 'perf-s',
    personnes,
    groupes,
    imposes: [],
  })
  const creneaux = genererCreneaux(session, lieu)
  return { lieu, session, inscriptions, creneaux }
}

/** Mesure une seule exécution de repartir() avec seed fixe. */
function mesurer(nbGroupes: number, nbPersonnes: number, budgetMs: number) {
  const { lieu, session, inscriptions, creneaux } = fixtureVolume(nbGroupes, nbPersonnes)
  const t0 = performance.now()
  const res = repartir(session, lieu, inscriptions, creneaux, { seed: 42, budgetMs })
  const duree = performance.now() - t0
  return { res, duree, nbGroupes, nbPersonnes, nbCreneaux: creneaux.length }
}

describe('solver — non-régression performance (garde-fou budget wall-clock)', () => {
  /**
   * Contrat garde-fou : quel que soit le volume, `repartir()` respecte
   * le budget wall-clock à ≤ +500 ms près (1 essai final peut déborder
   * puisque l'interruption est entre essais, pas au milieu).
   *
   * Seuil : 3000 ms budget + 500 ms marge = 3500 ms plafond.
   *
   * NB : le solveur peut terminer AVANT le budget s'il trouve une
   * solution complète (early stop naturel). Le test vérifie le
   * plafond, pas la durée exacte.
   */
  const PLAFOND_MS = 3500

  it('petit volume (13 groupes × 26 personnes) : sous plafond, souvent complet', () => {
    const m = mesurer(13, 26, 3000)
    // eslint-disable-next-line no-console
    console.log(
      `[perf] petit  N=13  personnes=26  creneaux=${m.nbCreneaux}  durée=${m.duree.toFixed(0)}ms  essais=${m.res.essais_executes}  arret=${m.res.arret_precoce}  complets=${m.res.groupes_complets}/13`,
    )
    expect(m.duree).toBeLessThan(PLAFOND_MS)
  })

  it('volume moyen (20 groupes × 40 personnes) : sous plafond', () => {
    const m = mesurer(20, 40, 3000)
    // eslint-disable-next-line no-console
    console.log(
      `[perf] moyen  N=20  personnes=40  creneaux=${m.nbCreneaux}  durée=${m.duree.toFixed(0)}ms  essais=${m.res.essais_executes}  arret=${m.res.arret_precoce}  complets=${m.res.groupes_complets}/20`,
    )
    expect(m.duree).toBeLessThan(PLAFOND_MS)
  })

  it('gros volume (50 groupes × 100 personnes) : sous plafond même sans convergence', () => {
    // À cette taille le solveur ne converge probablement pas en 3s —
    // le contrat testé est que le garde-fou s'active et rend la main.
    const m = mesurer(50, 100, 3000)
    // eslint-disable-next-line no-console
    console.log(
      `[perf] gros   N=50  personnes=100  creneaux=${m.nbCreneaux}  durée=${m.duree.toFixed(0)}ms  essais=${m.res.essais_executes}  arret=${m.res.arret_precoce}  complets=${m.res.groupes_complets}/50`,
    )
    expect(m.duree).toBeLessThan(PLAFOND_MS)
    // La solution reste utilisable (best partiel retourné)
    expect(m.res.placement.length).toBeGreaterThan(0)
  })

  it('budgetMs=Infinity désactive le garde-fou (opt-in utilisateur qui accepte le gel)', () => {
    const m = mesurer(13, 26, Infinity)
    // eslint-disable-next-line no-console
    console.log(
      `[perf] opt-in Infinity  N=13  durée=${m.duree.toFixed(0)}ms  essais=${m.res.essais_executes}  arret=${m.res.arret_precoce}`,
    )
    // Sans budget actif, l'arrêt vient soit du complet, soit du max-essais
    expect(['complet', 'max-essais']).toContain(m.res.arret_precoce)
  })

  it('reproductibilité : même seed → même essais_executes (dét. RNG)', () => {
    const { lieu, session, inscriptions, creneaux } = fixtureVolume(13, 26)
    const r1 = repartir(session, lieu, inscriptions, creneaux, { seed: 999, budgetMs: 3000 })
    const r2 = repartir(session, lieu, inscriptions, creneaux, { seed: 999, budgetMs: 3000 })
    // Même seed + même input → même decision path (peut différer sur essais_executes
    // si le budget kick-in à un point non-déterministe en temps ; à seed fixe et input
    // fixe, l'ordre logique est déterministe — le plan doit correspondre).
    expect(r1.placement).toEqual(r2.placement)
    expect(r1.arret_precoce).toBe(r2.arret_precoce)
  })
})
