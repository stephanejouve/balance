import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import { analyserInfaisabilite, diagnostiquer } from './diagnostic'

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
