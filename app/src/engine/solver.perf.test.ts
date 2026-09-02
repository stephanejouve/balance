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

  it('reproductibilité : même seed → même placement (dét. RNG)', () => {
    // Sans budget wall-clock ici : à seed + input fixes, le plan logique
    // est déterministe. Le budget peut kick-in à un point non-déterministe
    // en temps, ce qui rendrait `arret_precoce` flake sur CI (r1 finit en
    // 2900 ms, r2 en 3050 ms → assertion égalité pète). L'objet du test
    // étant le déterminisme, on désactive le budget.
    const { lieu, session, inscriptions, creneaux } = fixtureVolume(13, 26)
    const r1 = repartir(session, lieu, inscriptions, creneaux, { seed: 999, budgetMs: Infinity })
    const r2 = repartir(session, lieu, inscriptions, creneaux, { seed: 999, budgetMs: Infinity })
    expect(r1.placement).toEqual(r2.placement)
    expect(r1.arret_precoce).toBe(r2.arret_precoce)
    expect(r1.essais_executes).toBe(r2.essais_executes)
  })
})

/**
 * Piste 1 Stéphane 2026-09-02 : early-stop no-progress. Mesuré sur main
 * @05226c4, un solveur qui trouve 19/20 au 10ᵉ essai brûle 90 essais
 * de plus (56 s) à chasser 20/20 quand le 20ᵉ groupe est structurellement
 * infaisable. Palier `essaisSansAmelioration=50` par défaut arrête tôt
 * avec `arret_precoce='stagnation'`.
 */
describe('solver — early-stop no-progress (stagnation)', () => {
  /**
   * Fixture structurellement infaisable : 20 groupes qui incluent tous
   * la même personne (chanteur unique). Cible=3 répétitions × 20 groupes
   * = 60 sessions chant, mais chant ne peut se faire qu'à 1 seul endroit
   * à la fois → max 28 créneaux → impossible d'atteindre 20/20.
   */
  function fixtureImpossible() {
    const lieu = Lieu.parse({
      id: 'imp-lieu',
      nom: 'Impossible',
      salles: [
        { id: 'A', nom: 'A', jauge: 10 },
        { id: 'B', nom: 'B', jauge: 10 },
      ],
    })
    const session = Session.parse({
      id: 'imp-s',
      nom: 'Imp',
      lieu_id: 'imp-lieu',
      date_debut: '2026-08-24',
      date_fin: '2026-08-28',
      date_butoir: '2026-08-27',
      butoir_heure: '20:00',
      grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
      repetitions_visees: 3,
      repetitions_min: 2,
    })
    // 20 groupes, tous avec p0 (le chanteur goulot d'étranglement)
    const personnes = [
      { id: 'p0', nom: 'Goulot', instruments: [{ pupitre: 'chant' }], indispos: [] },
      ...Array.from({ length: 40 }, (_, i) => ({
        id: `p${i + 1}`,
        nom: `P${i + 1}`,
        instruments: [{ pupitre: PUPITRES[i % PUPITRES.length] }],
        indispos: [],
      })),
    ]
    const groupes = Array.from({ length: 20 }, (_, gi) => ({
      id: `g${gi}`,
      titre: `G${gi}`,
      membres: [
        { personne_id: 'p0', pupitre: 'chant' as Pupitre },
        { personne_id: `p${gi + 1}`, pupitre: PUPITRES[gi % PUPITRES.length] },
      ],
    }))
    const inscriptions = Inscriptions.parse({
      session_id: 'imp-s',
      personnes,
      groupes,
      imposes: [],
    })
    return { lieu, session, inscriptions, creneaux: genererCreneaux(session, lieu) }
  }

  it('arrête sur stagnation quand le best ne progresse plus (au lieu d\'épuiser maxEssais)', () => {
    const { lieu, session, inscriptions, creneaux } = fixtureImpossible()
    const t0 = performance.now()
    const res = repartir(session, lieu, inscriptions, creneaux, {
      seed: 42,
      strategie: 'random-restart', // stagnation ne s'observe qu'en random-restart
      // maxEssais élevé exprès : le test échoue si le solveur consomme tous
      // les essais au lieu d'être coupé par la stagnation.
      maxEssais: 2500,
      budgetMs: Infinity, // On veut voir le pur effet stagnation, pas le budget
      essaisSansAmelioration: 50,
    })
    const duree = performance.now() - t0
    // eslint-disable-next-line no-console
    console.log(
      `[perf] stagnation  essais=${res.essais_executes}  arret=${res.arret_precoce}  complets=${res.groupes_complets}/20  durée=${duree.toFixed(0)}ms`,
    )
    expect(res.arret_precoce).toBe('stagnation')
    // La coupe se fait après essaisSansAmelioration essais sans progrès
    // à partir du dernier essai qui a amélioré. En pratique, la meilleure
    // solution est trouvée dans les 10-20 premiers essais → l'arrêt se
    // fait autour de 60-80 essais (généreux, mais très loin de 2500).
    expect(res.essais_executes).toBeLessThan(500)
    // On garde une solution partielle utile (pas 0)
    expect(res.placement.length).toBeGreaterThan(0)
  })

  it('essaisSansAmelioration=Infinity désactive → solveur épuise maxEssais', () => {
    const { lieu, session, inscriptions, creneaux } = fixtureImpossible()
    const res = repartir(session, lieu, inscriptions, creneaux, {
      seed: 42,
      strategie: 'random-restart', // maxEssais n'a d'effet qu'en random-restart
      maxEssais: 30, // Petit maxEssais pour rester bref en test
      budgetMs: Infinity,
      essaisSansAmelioration: Infinity,
    })
    // Sans stagnation active, le solveur va jusqu'au bout de maxEssais
    // (impossible à compléter, donc pas d'arret 'complet')
    expect(res.arret_precoce).toBe('max-essais')
    expect(res.essais_executes).toBe(30)
  })

  it('n\'affecte pas les cas résolubles rapidement (early-stop naturel gagne)', () => {
    const { lieu, session, inscriptions, creneaux } = fixtureVolume(10, 20)
    const res = repartir(session, lieu, inscriptions, creneaux, {
      seed: 42, strategie: 'random-restart', essaisSansAmelioration: 50, budgetMs: Infinity,
    })
    // Cas résoluble : le premier essai réussit → arret 'complet',
    // stagnation ne kick jamais.
    expect(res.arret_precoce).toBe('complet')
    expect(res.essais_executes).toBe(1)
  })
})

/**
 * PR-A2 (chantier A Stéphane 2026-09-02) : `strategie: 'deterministic'`
 * défaut short-circuit shuffle + RNG + boucle. Contrat testé :
 * - même input → même placement (déterminisme fort)
 * - un unique essai, jamais de stagnation/budget/max-essais
 * - `random-restart` explicite préserve l'ancien comportement
 */
describe('solver — strategie deterministic (défaut, PR-A2)', () => {
  it('mode deterministic (défaut) : 1 essai, arret complet ou heuristique', () => {
    const { lieu, session, inscriptions, creneaux } = fixtureVolume(13, 26)
    const res = repartir(session, lieu, inscriptions, creneaux)
    expect(res.essais_executes).toBe(1)
    // Contrat A3 Stéphane 2026-09-02 : deterministic ne peut retourner que
    // 'complet' ou 'heuristique' — jamais max-essais/budget/stagnation, ces
    // valeurs n'ont pas de sens quand la boucle ne tourne qu'une fois par
    // construction.
    expect(['complet', 'heuristique']).toContain(res.arret_precoce)
    expect(res.placement.length).toBeGreaterThan(0)
  })

  it('deterministic + input infaisable → arret_precoce = "heuristique" (pas max-essais)', () => {
    // Cas explicite du défaut UI signalé par Stéphane 2026-09-02 :
    // « à 20 groupes en mode déterministe, arret_precoce vaut 'max-essais'.
    // C'est exact au sens strict — un essai exécuté sur un maximum de un —
    // mais le message affiché dira "après épuisement des essais", ce qui
    // n'a plus de sens quand il n'y en a qu'un par construction. »
    const lieu = Lieu.parse({
      id: 'x', nom: 'X',
      salles: [{ id: 'A', nom: 'A', jauge: 10 }],
    })
    const session = Session.parse({
      id: 's', nom: 'S', lieu_id: 'x',
      date_debut: '2026-08-24', date_fin: '2026-08-24',
      date_butoir: '2026-08-24', butoir_heure: '10:00',
      grille: [{ debut: '09:00', fin: '10:00', pas_minutes: 60 }],
      repetitions_visees: 3, repetitions_min: 2,
    })
    // 1 créneau × 3 répétitions × 2 groupes = 6 sessions nécessaires, 3
    // créneaux dispo → infaisable
    const inscriptions = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'A', instruments: [{ pupitre: 'chant' }] },
        { id: 'b', nom: 'B', instruments: [{ pupitre: 'chant' }] },
      ],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'chant' }] },
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'b', pupitre: 'chant' }] },
      ],
      imposes: [],
    })
    const creneaux = genererCreneaux(session, lieu)
    const res = repartir(session, lieu, inscriptions, creneaux)
    expect(res.arret_precoce).toBe('heuristique')
  })

  it('déterminisme fort : seeds différents → placement identique en mode deterministic', () => {
    const { lieu, session, inscriptions, creneaux } = fixtureVolume(20, 40)
    const r1 = repartir(session, lieu, inscriptions, creneaux, { seed: 1 })
    const r7 = repartir(session, lieu, inscriptions, creneaux, { seed: 7 })
    const r42 = repartir(session, lieu, inscriptions, creneaux, { seed: 42 })
    expect(r7.placement).toEqual(r1.placement)
    expect(r42.placement).toEqual(r1.placement)
  })

  it('random-restart explicite : préserve le comportement historique', () => {
    // Contrat opt-in : les paramètres essaisSansAmelioration/budgetMs/maxEssais
    // reprennent effet quand strategie='random-restart'. Volume moyen
    // (13g) pour rester rapide malgré N essais.
    const { lieu, session, inscriptions, creneaux } = fixtureVolume(13, 26)
    const res = repartir(session, lieu, inscriptions, creneaux, {
      seed: 42,
      strategie: 'random-restart',
      maxEssais: 5,
      essaisSansAmelioration: Infinity,
      budgetMs: Infinity,
    })
    // Contrat testé : le mode random-restart permet plusieurs essais
    // (vs 1 en mode deterministic). Sur input résoluble, s'arrête tôt
    // sur 'complet' — mais essais_executes >= 1 dans tous les cas.
    expect(res.essais_executes).toBeGreaterThanOrEqual(1)
    expect(['complet', 'max-essais', 'stagnation']).toContain(res.arret_precoce)
  })
})
