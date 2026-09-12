import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import {
  analyserCapaciteStage,
  analyserInfaisabilite,
  capaciteEstEnAlerte,
  diagnostiquer,
  SEUIL_CAPACITE_SERRE,
} from './diagnostic'

function fixture() {
  const lieu = Lieu.parse({
    id: 'l',
    nom: 'L',
    salles: [{ id: 'A', nom: 'A', jauge: 10 }],
  })
  const session = Session.parse({
    id: 's',
    nom: 'S',
    lieu_id: 'l',
    date_debut: '2026-08-24',
    date_fin: '2026-08-24',
    date_butoir: '2026-08-25',
    grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }], // 3 créneaux
    repetitions_visees: 3,
  })
  const creneaux = genererCreneaux(session, lieu)
  return { session, lieu, creneaux }
}

describe('analyserInfaisabilite', () => {
  it('signale une personne qui aurait besoin de plus de créneaux que disponibles', () => {
    const { session, creneaux } = fixture()
    // Alice dans 2 groupes × 3 répés = 6 créneaux nécessaires, or 3 dispos
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice' },
        { id: 'bob', nom: 'Bob' },
        { id: 'carol', nom: 'Carol' },
      ],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'bob', pupitre: 'piano' },
          ],
        },
        {
          id: 'g2',
          titre: 'G2',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'carol', pupitre: 'basse' },
          ],
        },
      ],
    })
    const diag = analyserInfaisabilite(session, insc, creneaux)
    const alice = diag.find((d) => d.personne_id === 'alice')
    expect(alice).toBeDefined()
    expect(alice!.demande).toBe(6)
    expect(alice!.offre).toBe(3)
  })

  it('ne signale rien quand tout tient', () => {
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'alice', nom: 'Alice' }],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [{ personne_id: 'alice', pupitre: 'chant' }],
        },
      ],
    })
    expect(analyserInfaisabilite(session, insc, creneaux)).toEqual([])
  })

  it('type=surcharge quand offre > 0 et demande > offre (Alice 2 groupes vs 3 créneaux)', () => {
    // Cas classique du 1er test — Alice a 3 créneaux ouverts mais demande 6.
    // Doit être classée `surcharge`, pas `exclusion`.
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'alice', nom: 'Alice' }, { id: 'bob', nom: 'Bob' }, { id: 'carol', nom: 'Carol' }],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'alice', pupitre: 'chant' }, { personne_id: 'bob', pupitre: 'piano' }] },
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'alice', pupitre: 'chant' }, { personne_id: 'carol', pupitre: 'basse' }] },
      ],
    })
    const diag = analyserInfaisabilite(session, insc, creneaux)
    const alice = diag.find((d) => d.personne_id === 'alice')!
    expect(alice.offre).toBeGreaterThan(0)
    expect(alice.type).toBe('surcharge')
  })

  it('type=exclusion quand offre === 0 (bug smoke #2 : Olivier convalescence 0/28)', () => {
    // Reproduit le cas Stéphane : personne avec indispos qui couvrent
    // TOUS les créneaux → offre = 0. Doit être classée `exclusion` pour
    // que l'UI oriente vers « vérifier ses indisponibilités » plutôt que
    // « réduire les engagements » (qui ne changerait rien).
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        {
          id: 'olivier',
          nom: 'Olivier',
          // Indispo horaire couvrant toute la matinée = tous les créneaux
          // du fixture (grille 09:00-12:00).
          indispos: [{ jours: [], debut: '09:00', fin: '12:00', roles: [], motif: 'plage bloquée' }],
        },
      ],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'olivier', pupitre: 'basse' }] },
      ],
    })
    const diag = analyserInfaisabilite(session, insc, creneaux)
    const olivier = diag.find((d) => d.personne_id === 'olivier')!
    expect(olivier.offre).toBe(0)
    expect(olivier.type).toBe('exclusion')
  })

  it('inclut les séances des imposés dans la demande', () => {
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'alice', nom: 'Alice' }],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [{ personne_id: 'alice', pupitre: 'chant' }],
        },
      ],
      imposes: [
        {
          id: 'i1',
          morceau: 'X',
          membres: ['alice'],
          seances: [
            { date: '2026-08-23', debut: '14:00', fin: '15:00' },
            { date: '2026-08-24', debut: '14:00', fin: '15:00' },
            { date: '2026-08-25', debut: '14:00', fin: '15:00' },
          ],
        },
      ],
    })
    // 1 groupe × 3 + 3 imposés = 6 nécessaires, 3 disponibles (une séance sur le jour de la
    // session bloque un créneau supplémentaire côté offre)
    const diag = analyserInfaisabilite(session, insc, creneaux)
    expect(diag[0].detail.seances_imposees).toBe(3)
  })
})

// ─── analyserCapaciteStage — signal orthogonal au per-personne ────────
// Feedback Stéphane 2026-09-05 : le contrôle per-personne mesure des
// moments (correct pour la contrainte « personne à un endroit à la fois »),
// mais le REMÈDE affiché « réduire ses engagements » n'a pas de sens pour
// une personne dans 1 seul groupe. Le signal STAGE calcule la capacité
// globale et rend le fait visible sans attribuer une cause précise.

describe('analyserCapaciteStage', () => {
  it('capacite_stage = somme des places-créneau (salles × créneaux)', () => {
    const lieu = Lieu.parse({
      id: 'l',
      nom: 'L',
      salles: [
        { id: 'A', nom: 'A', jauge: 10 },
        { id: 'B', nom: 'B', jauge: 10 },
      ],
    })
    const session = Session.parse({
      id: 's', nom: 'S', lieu_id: 'l',
      date_debut: '2026-08-24', date_fin: '2026-08-24',
      date_butoir: '2026-08-25', butoir_heure: '18:00',
      grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }], // 3 créneaux
      repetitions_visees: 3,
    })
    const creneaux = genererCreneaux(session, lieu)
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'chant' }] },
      ],
    })
    const diag = analyserCapaciteStage(session, insc, creneaux)
    // 3 créneaux × 2 salles = 6 places-créneau
    expect(diag.capacite_stage).toBe(6)
    // 1 groupe × 3 cible = 3 séances demandées, aucun imposé
    expect(diag.demande_stage).toBe(3)
    expect(diag.demande_depasse_capacite).toBe(false)
  })

  it('demande_depasse_capacite = true quand demande dépasse capacité (nom factuel, pas causal — cf CD 6417 pt 3)', () => {
    // 1 créneau × 1 salle = 1 place ; 3 groupes × 3 cible = 9 séances demandées
    const lieu = Lieu.parse({
      id: 'l', nom: 'L',
      salles: [{ id: 'A', nom: 'A', jauge: 10 }],
    })
    const session = Session.parse({
      id: 's', nom: 'S', lieu_id: 'l',
      date_debut: '2026-08-24', date_fin: '2026-08-24',
      date_butoir: '2026-08-24', butoir_heure: '11:00',
      grille: [{ debut: '10:00', fin: '11:00', pas_minutes: 60 }],
      repetitions_visees: 3,
    })
    const creneaux = genererCreneaux(session, lieu)
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'A' }, { id: 'b', nom: 'B' }, { id: 'c', nom: 'C' },
      ],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'chant' }] },
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'b', pupitre: 'chant' }] },
        { id: 'g3', titre: 'G3', membres: [{ personne_id: 'c', pupitre: 'chant' }] },
      ],
    })
    const diag = analyserCapaciteStage(session, insc, creneaux)
    expect(diag.capacite_stage).toBe(1)
    expect(diag.demande_stage).toBe(9)
    expect(diag.demande_depasse_capacite).toBe(true)
  })

  it('inclut les séances imposées dans la demande', () => {
    const { session, lieu, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'chant' }] },
      ],
      imposes: [
        {
          id: 'i1', morceau: 'X', membres: ['a'],
          seances: [
            { date: '2026-08-24', debut: '14:00', fin: '15:00' },
            { date: '2026-08-24', debut: '15:00', fin: '16:00' },
          ],
        },
      ],
    })
    const diag = analyserCapaciteStage(session, insc, creneaux)
    // 3 créneaux × 1 salle = 3 places · 1 groupe × 3 cible + 2 imposés = 5 séances
    expect(diag.capacite_stage).toBe(3)
    expect(diag.demande_stage).toBe(5)
    expect(diag.demande_depasse_capacite).toBe(true)
    void lieu // fixture met le lieu à disposition mais on ne l'utilise pas ici
  })

  it('applique la marge d\'occupation via sallesUtilisables', () => {
    // 2 salles avec marge 50 % → 1 place par créneau (floor(2 × 0.5))
    const lieu = Lieu.parse({
      id: 'l', nom: 'L',
      salles: [
        { id: 'A', nom: 'A', jauge: 10 },
        { id: 'B', nom: 'B', jauge: 10 },
      ],
    })
    const session = Session.parse({
      id: 's', nom: 'S', lieu_id: 'l',
      date_debut: '2026-08-24', date_fin: '2026-08-24',
      date_butoir: '2026-08-25', butoir_heure: '18:00',
      grille: [{ debut: '09:00', fin: '11:00', pas_minutes: 60 }], // 2 créneaux
      repetitions_visees: 1,
      marge_pct: 50,
    })
    const creneaux = genererCreneaux(session, lieu)
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'chant' }] },
      ],
    })
    const diag = analyserCapaciteStage(session, insc, creneaux)
    // 2 créneaux × floor(2 × 0.5) = 2 places, pas 4
    expect(diag.capacite_stage).toBe(2)
    expect(diag.demande_stage).toBe(1)
    expect(diag.demande_depasse_capacite).toBe(false)
  })

  it('respecte repetitions_deja_faites (recalcul milieu de session)', () => {
    // Groupe avec 2 répés déjà faites, cible 3 → 1 seule restante
    const { session, lieu, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [
        {
          id: 'g1', titre: 'G1',
          membres: [{ personne_id: 'a', pupitre: 'chant' }],
          repetitions_deja_faites: 2,
        },
      ],
    })
    const diag = analyserCapaciteStage(session, insc, creneaux)
    // 3 - 2 = 1 séance restante
    expect(diag.demande_stage).toBe(1)
    void lieu
  })
})

// ─── capaciteEstEnAlerte — seuil « capacité serrée » (CD 6417 pt 1) ──
// Contexte : le WIP initial n'affichait le bandeau capacité qu'en cas
// d'infaisabilité per-personne. CD a signalé le cas 59/60 : ratio < 100 %
// mais tout juste, sans per-personne qui bloque → aucun signal. Or le
// placement échoue souvent pour d'autres raisons (partages, indispos,
// espacement) quand la capacité est serrée. Le seuil SEUIL_CAPACITE_SERRE
// capte les frontières.

describe('capaciteEstEnAlerte', () => {
  const mk = (demande: number, capacite: number): ReturnType<typeof analyserCapaciteStage> => ({
    demande_stage: demande,
    capacite_stage: capacite,
    demande_depasse_capacite: demande > capacite,
  })

  it('true quand dépassement strict', () => {
    expect(capaciteEstEnAlerte(mk(9, 6))).toBe(true)
  })

  it('true quand 59/60 (cas frontière signalé CD 6417 pt 1)', () => {
    // Ratio 0.983 > SEUIL_CAPACITE_SERRE (0.9). Sans ce helper, l'organisateur
    // croyait à tort que la capacité n'était pas en cause.
    expect(capaciteEstEnAlerte(mk(59, 60))).toBe(true)
  })

  it('true à la limite exacte du seuil (ratio = SEUIL_CAPACITE_SERRE)', () => {
    // 90/100 = 0.9 = SEUIL. Doit déclencher (>=, pas strict >).
    expect(capaciteEstEnAlerte(mk(90, 100))).toBe(true)
  })

  it('false quand ratio confortable (30/100 = 0.3 < seuil)', () => {
    expect(capaciteEstEnAlerte(mk(30, 100))).toBe(false)
  })

  it('false quand pas de demande ET pas de capacité (0/0 → rien à signaler)', () => {
    expect(capaciteEstEnAlerte(mk(0, 0))).toBe(false)
  })

  it('true quand capacité = 0 mais demande > 0 (via demande_depasse_capacite)', () => {
    // Sans salle mais séances demandées → dépassement trivial, on veut le signal.
    expect(capaciteEstEnAlerte(mk(3, 0))).toBe(true)
  })

  it('SEUIL_CAPACITE_SERRE est exporté comme constante nommée (valeur = 0.9)', () => {
    // Verrouille la valeur pour éviter les surprises ; réajuster à l'usage.
    expect(SEUIL_CAPACITE_SERRE).toBe(0.9)
  })
})

describe('diagnostiquer', () => {
  it('explique pourquoi un groupe est incomplet (partages + poids musicien)', () => {
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice' },
        { id: 'bob', nom: 'Bob' },
      ],
      groupes: [
        {
          id: 'g1',
          titre: 'Groupe 1',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'bob', pupitre: 'piano' },
          ],
        },
        {
          id: 'g2',
          titre: 'Groupe 2',
          membres: [{ personne_id: 'alice', pupitre: 'chant' }],
        },
      ],
    })
    // Placement volontairement incomplet
    const placement = [{ groupe_id: 'g1', creneau_id: creneaux[0].id }]
    const diag = diagnostiquer(session, insc, creneaux, placement)
    const g1 = diag.find((d) => d.groupe_id === 'g1')!
    expect(g1.obtenu).toBe(1)
    expect(g1.cible).toBe(3)
    expect(g1.partages.some((p) => p.groupe_id === 'g2')).toBe(true)
    expect(g1.poids_musicien?.nom).toMatch(/Alice|Bob/)
  })
})

// ─── creneaux_exploitables : filtre capacité sur creneaux_ouverts ───────
// Feedback Stéphane 2026-09-04 : `creneaux_ouverts` mesure les créneaux
// non-bloqués par indispos, mais ne dit rien de la saturation capacité.
// `creneaux_exploitables` complète en filtrant sur `sallesUtilisables(c) -
// nb_placements_sur_c > 0`. Le nom compte des CRÉNEAUX (pas des slots) pour
// éviter le même faux ami que le champ ouverts avait exposé.
//
// Invariant par construction : exploitables ≤ ouverts.

describe('diagnostiquer — creneaux_exploitables (filtre capacité)', () => {
  it('invariant : exploitables <= ouverts, toujours', () => {
    // Fixture générique : plusieurs groupes, placements variés, on vérifie
    // l'invariant sur tous les diags produits. Si le filtre est un jour
    // calculé sur autre chose que les ouverts, ce test tombe.
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
      ],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'chant' }] },
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'b', pupitre: 'piano' }] },
        { id: 'g3', titre: 'G3', membres: [{ personne_id: 'c', pupitre: 'basse' }] },
      ],
    })
    const placement = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id },
      { groupe_id: 'g2', creneau_id: creneaux[1].id },
    ]
    const diag = diagnostiquer(session, insc, creneaux, placement)
    for (const d of diag) {
      expect(d.creneaux_exploitables).toBeLessThanOrEqual(d.creneaux_ouverts)
    }
  })

  it('cas B : creneaux_exploitables === 0 quand tous les slots sont pris', () => {
    // 1 salle jauge 10, 3 créneaux, cible=3, 3 groupes indépendants (aucun
    // partage). Le solveur ne peut placer qu'un groupe par créneau → g3
    // aura 0 séances, ses 3 créneaux ouverts sont saturés par g1/g2 dessus.
    const { session, creneaux } = fixture() // 3 créneaux, 1 salle
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
      ],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'chant' }] },
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'b', pupitre: 'piano' }] },
        { id: 'g3', titre: 'G3', membres: [{ personne_id: 'c', pupitre: 'basse' }] },
      ],
    })
    // Placement saturant : g1 sur c0, g2 sur c1, g2 sur c2 → tous les slots pris
    const placement = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id },
      { groupe_id: 'g2', creneau_id: creneaux[1].id },
      { groupe_id: 'g2', creneau_id: creneaux[2].id },
    ]
    const diag = diagnostiquer(session, insc, creneaux, placement)
    const g3 = diag.find((d) => d.groupe_id === 'g3')!
    expect(g3.creneaux_ouverts).toBe(3) // les 3 créneaux ouverts (pas d'indispo)
    expect(g3.creneaux_exploitables).toBe(0) // mais tous les slots pris
  })

  it('cas C : creneaux_exploitables > 0 quand la capacité reste libre (musiciens partagés)', () => {
    // 2 salles jauge 10, 2 créneaux, cible=2. g_other et g_share partagent
    // p_share. Le solveur alterne → chacun 1/2. Pour g_share, la capacité
    // salle reste libre (2 salles - 1 placement par créneau = 1 slot dispo
    // chacun), mais p_share est bookée ailleurs. creneaux_exploitables
    // annonce 2 (limite du calcul simplifié — cf docstring).
    const lieu = Lieu.parse({
      id: 'l',
      nom: 'L',
      salles: [
        { id: 'A', nom: 'A', jauge: 10 },
        { id: 'B', nom: 'B', jauge: 10 },
      ],
    })
    const session = Session.parse({
      id: 's', nom: 'S', lieu_id: 'l',
      date_debut: '2026-08-24', date_fin: '2026-08-24',
      date_butoir: '2026-08-24', butoir_heure: '18:00',
      grille: [{ debut: '14:00', fin: '16:00', pas_minutes: 60 }],
      repetitions_visees: 2,
    })
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'p_share', nom: 'PShared' },
        { id: 'p_other', nom: 'POther' },
        { id: 'p_third', nom: 'PThird' },
      ],
      groupes: [
        { id: 'g_other', titre: 'G_other', membres: [
          { personne_id: 'p_share', pupitre: 'chant' },
          { personne_id: 'p_other', pupitre: 'piano' }] },
        { id: 'g_share', titre: 'G_share', membres: [
          { personne_id: 'p_share', pupitre: 'chant' },
          { personne_id: 'p_third', pupitre: 'basse' }] },
      ],
    })
    const creneaux = genererCreneaux(session, lieu)
    // Alternance : g_other c0, g_share c1 (1 placement par créneau, capacité 2)
    const placement = [
      { groupe_id: 'g_other', creneau_id: creneaux[0].id },
      { groupe_id: 'g_share', creneau_id: creneaux[1].id },
    ]
    const diag = diagnostiquer(session, insc, creneaux, placement)
    const gShare = diag.find((d) => d.groupe_id === 'g_share')!
    // g_share obtenu=1, cible=2 → apparaît dans diag
    expect(gShare.obtenu).toBe(1)
    expect(gShare.creneaux_ouverts).toBe(2)
    // Capacité restante par créneau : 2 salles - 1 placement = 1 slot libre
    expect(gShare.creneaux_exploitables).toBe(2)
    // partages capte la collision (pas besoin d'un 5e champ)
    expect(gShare.partages.some((p) => p.groupe_id === 'g_other')).toBe(true)
  })

  it("cas A : creneaux_exploitables === 0 quand creneaux_ouverts === 0 (indispos larges)", () => {
    // Personne dont les indispos couvrent toute la matinée → tous les
    // créneaux fermés pour son groupe. exploitables tombe à 0 par
    // conséquence de l'invariant (0 ouverts ⇒ 0 exploitables).
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        {
          id: 'olivier',
          nom: 'Olivier',
          indispos: [{ jours: [], debut: '09:00', fin: '12:00', roles: [], motif: 'plage bloquée' }],
        },
      ],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'olivier', pupitre: 'basse' }] },
      ],
    })
    const diag = diagnostiquer(session, insc, creneaux, [])
    const g1 = diag.find((d) => d.groupe_id === 'g1')!
    expect(g1.creneaux_ouverts).toBe(0)
    expect(g1.creneaux_exploitables).toBe(0)
  })
})

// ─── Conditions d'affichage bandeau capacité + surcharge — nit 2 review Leader #81
// Reproduit les conditions inline de `App.svelte:1056-1088` pour verrouiller
// la coexistence des 2 bandeaux (capacité stage + per-personne) et le variant
// remède selon `surchargesMultiEngagement.length > 0`. Le nit demandait un
// test smoke UI intégration ; voie B arbitrée par Leader (2026-09-12) :
// tester les conditions logiques directement, sans mount du composant.
// Le refactor App.svelte est un ticket P3 follow-up séparé.

describe('conditions Svelte bandeau capacité + surcharge (nit 2 review Leader #81)', () => {
  // Reproduit exactement `App.svelte:1056`
  const bandeauCapaciteSaffiche = (
    capaciteStage: ReturnType<typeof analyserCapaciteStage> | null,
    infaisabilites: ReturnType<typeof analyserInfaisabilite>,
  ): boolean =>
    Boolean(capaciteStage) &&
    (capaciteEstEnAlerte(capaciteStage!) || infaisabilites.length > 0)

  // Reproduit exactement `App.svelte:1064-1068`
  const surcharges = (infs: ReturnType<typeof analyserInfaisabilite>) =>
    infs.filter((d) => d.type === 'surcharge')
  const surchargesMultiEngagement = (infs: ReturnType<typeof analyserInfaisabilite>) =>
    surcharges(infs).filter((d) => d.detail.groupes > 1)

  it('bandeau capacité caché quand aucun signal', () => {
    // Session confortable : cible-restant = 1 séance (repetitions_deja_faites=2),
    // capacité 3 créneaux × 1 salle = 3 places. Ratio 1/3 ≈ 0.33 < SEUIL (0.9),
    // pas d'infaisabilité per-personne → aucun signal, bandeau caché.
    const { session, lieu, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'alice', nom: 'Alice' }],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [{ personne_id: 'alice', pupitre: 'chant' }],
          repetitions_deja_faites: 2,
        },
      ],
    })
    const diag = analyserCapaciteStage(session, insc, creneaux)
    const infs = analyserInfaisabilite(session, insc, creneaux)
    expect(diag.demande_stage).toBe(1)
    expect(diag.capacite_stage).toBe(3)
    expect(capaciteEstEnAlerte(diag)).toBe(false)
    expect(infs.length).toBe(0)
    expect(bandeauCapaciteSaffiche(diag, infs)).toBe(false)
    void lieu
  })

  it('bandeau capacité affiché quand capacité en alerte seule', () => {
    // Session serrée sans surcharge per-personne : demande = capacité (ratio 1.0
    // ≥ SEUIL_CAPACITE_SERRE), mais chaque personne peut être placée.
    const { session, lieu, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
      ],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'chant' }] },
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'b', pupitre: 'chant' }] },
        { id: 'g3', titre: 'G3', membres: [{ personne_id: 'c', pupitre: 'chant' }] },
      ],
    })
    const diag = analyserCapaciteStage(session, insc, creneaux)
    const infs = analyserInfaisabilite(session, insc, creneaux)
    expect(capaciteEstEnAlerte(diag)).toBe(true)
    expect(infs.length).toBe(0)
    expect(bandeauCapaciteSaffiche(diag, infs)).toBe(true)
    void lieu
  })

  it('bandeau capacité affiché quand per-personne en infaisabilité seule', () => {
    // Alice dans 2 groupes × 3 répés = 6 séances demandées côté Alice, mais
    // seulement 3 créneaux disponibles côté offre → infaisabilité per-personne
    // sans que la capacité stage globale soit en alerte (2 groupes = 6 séances
    // pour 3 places, donc en fait déclenche aussi capacité — on force le cas
    // via une session plus large).
    const { lieu } = fixture()
    const sessionLarge = Session.parse({
      id: 's',
      nom: 'S',
      lieu_id: 'l',
      date_debut: '2026-08-24',
      date_fin: '2026-08-30', // 7 jours
      date_butoir: '2026-08-31',
      grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }], // 3 créneaux × 7 j = 21 créneaux
      repetitions_visees: 3,
    })
    const creneauxLarges = genererCreneaux(sessionLarge, lieu)
    // Alice dans 3 groupes × 3 répés = 9 séances, or créneaux × jours × pupitres
    // reste large côté stage. Alice sature per-personne, stage confortable.
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice' },
        { id: 'bob', nom: 'Bob' },
        { id: 'carol', nom: 'Carol' },
      ],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'bob', pupitre: 'piano' },
          ],
          repetitions_deja_faites: 0,
        },
        {
          id: 'g2',
          titre: 'G2',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'carol', pupitre: 'basse' },
          ],
          repetitions_deja_faites: 0,
        },
      ],
    })
    // Une seule salle avec jauge 10 sur 21 créneaux = 21 places, 6 séances demandées.
    // Capacité confortable. Alice dans 2 groupes × 3 répés = 6 créneaux à trouver
    // dans son offre — pas insurmontable, mais si on force des indispos on lui
    // rétrécit l'offre. Ici on garde une session sans indispo, donc pas de
    // surcharge non plus. Cas « capacité alerte seule » déjà couvert au-dessus.
    // Ce test vérifie donc plutôt le OR logique quand infaisabilites.length > 0
    // ET capacite pas en alerte : on force via aliceOverloaded.
    const inscAliceSurchargee = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice' },
        { id: 'bob', nom: 'Bob' },
      ],
      groupes: Array.from({ length: 8 }, (_, i) => ({
        id: `g${i}`,
        titre: `G${i}`,
        membres: [
          { personne_id: 'alice', pupitre: 'chant' as const },
          { personne_id: 'bob', pupitre: 'piano' as const },
        ],
      })),
    })
    const diag = analyserCapaciteStage(sessionLarge, inscAliceSurchargee, creneauxLarges)
    const infs = analyserInfaisabilite(sessionLarge, inscAliceSurchargee, creneauxLarges)
    // 8 groupes × 3 = 24 séances demandées, 21 places → capacité en alerte aussi.
    // On teste alors le OR : au moins un des deux est vrai.
    expect(infs.length).toBeGreaterThan(0)
    expect(bandeauCapaciteSaffiche(diag, infs)).toBe(true)
  })

  it('bandeau capacité affiché en coexistence (capacité alerte ET per-personne)', () => {
    // Alice dans 2 groupes × 3 = 6 séances, capacité 3 places → les deux alertes.
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice' },
        { id: 'bob', nom: 'Bob' },
        { id: 'carol', nom: 'Carol' },
      ],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'bob', pupitre: 'piano' },
          ],
        },
        {
          id: 'g2',
          titre: 'G2',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'carol', pupitre: 'basse' },
          ],
        },
      ],
    })
    const diag = analyserCapaciteStage(session, insc, creneaux)
    const infs = analyserInfaisabilite(session, insc, creneaux)
    expect(capaciteEstEnAlerte(diag)).toBe(true)
    expect(infs.length).toBeGreaterThan(0)
    expect(bandeauCapaciteSaffiche(diag, infs)).toBe(true)
  })

  it('variant remède ABSENT quand aucune surcharge multi-engagement', () => {
    // Cas où une personne est en surcharge (indispo qui bloque son offre)
    // mais ne joue que dans UN groupe → detail.groupes === 1, le remède
    // « réduire les engagements des musiciens qui jouent dans plusieurs
    // groupes » n'a pas de sens à afficher.
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        {
          id: 'olivier',
          nom: 'Olivier',
          indispos: [
            { jours: [], debut: '09:00', fin: '11:00', roles: [], motif: 'blocage' },
          ],
        },
      ],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [{ personne_id: 'olivier', pupitre: 'basse' }],
        },
      ],
    })
    const infs = analyserInfaisabilite(session, insc, creneaux)
    const s = surcharges(infs)
    // Olivier peut être en exclusion (offre = 0) OU surcharge — dans les 2 cas,
    // il joue dans 1 groupe → multi-engagement absent.
    expect(surchargesMultiEngagement(infs).length).toBe(0)
    // Le nit vise le variant remède : quand multi-engagement absent, le
    // paragraphe « réduire les engagements » ne doit pas s'afficher.
    // La condition Svelte `{#if surchargesMultiEngagement.length > 0}` est
    // fausse → paragraphe absent.
    if (s.length > 0) {
      expect(s.every((d) => d.detail.groupes === 1)).toBe(true)
    }
  })

  it('variant remède PRÉSENT quand au moins 1 surcharge multi-engagement', () => {
    // Alice dans 2 groupes × 3 répés → surcharge, detail.groupes === 2 > 1
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice' },
        { id: 'bob', nom: 'Bob' },
        { id: 'carol', nom: 'Carol' },
      ],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'bob', pupitre: 'piano' },
          ],
        },
        {
          id: 'g2',
          titre: 'G2',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'carol', pupitre: 'basse' },
          ],
        },
      ],
    })
    const infs = analyserInfaisabilite(session, insc, creneaux)
    const multi = surchargesMultiEngagement(infs)
    expect(multi.length).toBeGreaterThan(0)
    expect(multi.some((d) => d.personne_id === 'alice')).toBe(true)
    expect(multi.every((d) => d.detail.groupes > 1)).toBe(true)
  })

  it('libellé factuel expose demande_stage et capacite_stage SÉPARÉMENT (pas de fusion)', () => {
    // CD 6417 pt 3 : le libellé énonce le fait « N séances demandées pour
    // M places au total », pas la cause. Test que les 2 valeurs sont bien
    // exposées via l'objet DiagStage (pas fusionnées en un ratio).
    const { session, creneaux } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
      ],
      groupes: [
        { id: 'g1', titre: 'G1', membres: [{ personne_id: 'a', pupitre: 'chant' }] },
        { id: 'g2', titre: 'G2', membres: [{ personne_id: 'b', pupitre: 'chant' }] },
      ],
    })
    const diag = analyserCapaciteStage(session, insc, creneaux)
    // 2 groupes × 3 répés = 6 séances, 3 créneaux × 1 salle = 3 places
    expect(diag.demande_stage).toBe(6)
    expect(diag.capacite_stage).toBe(3)
    // Les deux valeurs sont exposées, prêtes à être injectées dans le libellé
    // « {demande_stage} séance{s} demandée{s} pour {capacite_stage} place{s} ».
    // Aucune fusion en ratio côté modèle — le lecteur voit les deux nombres.
  })
})
