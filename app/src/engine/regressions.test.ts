import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import { attribuerSalles } from './allocate-rooms'
import { repartir } from './solver'
import type { Assignation } from './types'
import { verifier } from './verify'

/**
 * Non-régression défaut #1 solveur — smoke Stéphane 2026-09-03 16h sur
 * balance-stress-test.xlsx : le solveur a produit
 *   - une violation de jauge (groupes Caravan/Duke posés dans une salle
 *     plus petite que leur effectif),
 *   - trois violations de non-consécutivité (pattern régulier
 *     `16:30-17:30 → 17:30-18:30`, même groupe sur deux créneaux
 *     back-to-back).
 *
 * Le défaut n'est plus reproductible à partir de la v20260903.1817 : les
 * quatre lancers successifs du smoke PR #70 ont tous rendu « aucun conflit
 * détecté par la vérification indépendante ». Correction probable en effet
 * de bord des PR #67 (cohérence), #68 (libellés) ou #70 (comparateur
 * salles). Aucune PR ne s'attribue explicitement le fix.
 *
 * Consigne Stéphane 2026-09-03 21:08 : « plutôt que de chercher un bug
 * disparu, écris le test de non-régression. […] Si le test passe du premier
 * coup, tant mieux : il empêchera le retour du défaut sans qu'on ait à
 * comprendre sa disparition. »
 *
 * Les deux tests ci-dessous verrouillent les deux invariants violés par le
 * défaut, à leur point d'observation le plus proche du symptôme : la
 * vérification indépendante (`verifier`) pour la consécutivité, l'attribution
 * de salle (`attribuerSalles`) pour la jauge. Ces deux modules sont les
 * derniers filets avant l'utilisateur ; s'ils tiennent, le défaut ne peut
 * pas ressortir même si un chemin amont régresse (solveur, figées, imposés).
 */

describe('non-régression défaut #1 (smoke Stéphane 2026-09-03 16h — balance-stress-test)', () => {
  it("consécutivité : verifier() signale 2 séances back-to-back du même groupe (figées comprises, pas de bypass silent)", () => {
    // Reproduit le pattern « 16:30-17:30 → 17:30-18:30 » observé sur 3
    // groupes du smoke. On pré-pose 2 figées adjacentes pour le même
    // groupe — attribuerSalles les insère telles quelles dans la solution
    // (allocate-rooms.ts:132), donc verifier() est ici le dernier garde
    // avant qu'un planning invalide n'atterrisse à l'écran.
    const lieu = Lieu.parse({
      id: 'lieu',
      nom: 'Lieu',
      salles: [{ id: 'A', nom: 'A', jauge: 10 }],
    })
    const session = Session.parse({
      id: 's',
      nom: 'S',
      lieu_id: 'lieu',
      date_debut: '2026-08-24',
      date_fin: '2026-08-24',
      date_butoir: '2026-08-24',
      butoir_heure: '19:00',
      grille: [{ debut: '16:30', fin: '18:30', pas_minutes: 60 }],
      repetitions_visees: 2,
      repetitions_min: 2,
    })
    const inscriptions = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'Alice', instruments: [{ pupitre: 'chant' }] },
        { id: 'b', nom: 'Bob', instruments: [{ pupitre: 'piano' }] },
      ],
      groupes: [
        {
          id: 'caravan',
          titre: 'Caravan',
          membres: [
            { personne_id: 'a', pupitre: 'chant' },
            { personne_id: 'b', pupitre: 'piano' },
          ],
        },
      ],
    })
    const creneaux = genererCreneaux(session, lieu)
    // Créneaux attendus : 16:30-17:30 (c0) et 17:30-18:30 (c1), consécutifs.
    expect(creneaux).toHaveLength(2)
    expect(creneaux[0].debut).toBe('16:30')
    expect(creneaux[0].fin).toBe('17:30')
    expect(creneaux[1].debut).toBe('17:30')
    expect(creneaux[1].fin).toBe('18:30')

    // Deux assignations back-to-back pour le même groupe — configuration
    // interdite par la contrainte `creneaux-consecutifs`.
    const assignations: Assignation[] = [
      { groupe_id: 'caravan', creneau_id: creneaux[0].id, salle_id: 'A' },
      { groupe_id: 'caravan', creneau_id: creneaux[1].id, salle_id: 'A' },
    ]
    const problemes = verifier(session, lieu, inscriptions, creneaux, assignations)
    const consec = problemes.filter(
      (p) => p.type === 'creneaux-consecutifs' && p.groupe_id === 'caravan',
    )
    expect(consec).toHaveLength(1)
  })

  it("jauge : attribuerSalles refuse un groupe eff > jauge (groupesPerdus, pas d'assignation silencieuse)", () => {
    // Reproduit la violation « Caravan/Duke > jauge » : seul un filtre côté
    // attribution empêche le solveur (qui ne connaît pas la jauge) de placer
    // un groupe trop gros dans la seule salle disponible. Ce test vérifie
    // que allocate-rooms.ts:193 (`cands = restant.filter(s.jauge >= eff)`)
    // tient et route le groupe vers `groupesPerdus` plutôt qu'attribuer.
    const lieu = Lieu.parse({
      id: 'lieu',
      nom: 'Lieu',
      salles: [
        // Une seule salle disponible, trop petite (jauge 4) pour l'effectif (6).
        { id: 'petite', nom: 'La Petite', jauge: 4 },
      ],
    })
    const session = Session.parse({
      id: 's',
      nom: 'S',
      lieu_id: 'lieu',
      date_debut: '2026-08-24',
      date_fin: '2026-08-24',
      date_butoir: '2026-08-24',
      butoir_heure: '18:00',
      grille: [{ debut: '14:00', fin: '15:00', pas_minutes: 60 }],
    })
    const inscriptions = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'p1', nom: 'P1', instruments: [{ pupitre: 'chant' }] },
        { id: 'p2', nom: 'P2', instruments: [{ pupitre: 'piano' }] },
        { id: 'p3', nom: 'P3', instruments: [{ pupitre: 'basse' }] },
        { id: 'p4', nom: 'P4', instruments: [{ pupitre: 'batterie' }] },
        { id: 'p5', nom: 'P5', instruments: [{ pupitre: 'guitare' }] },
        { id: 'p6', nom: 'P6', instruments: [{ pupitre: 'vents' }] },
      ],
      groupes: [
        {
          id: 'caravan',
          titre: 'Caravan',
          membres: [
            { personne_id: 'p1', pupitre: 'chant' },
            { personne_id: 'p2', pupitre: 'piano' },
            { personne_id: 'p3', pupitre: 'basse' },
            { personne_id: 'p4', pupitre: 'batterie' },
            { personne_id: 'p5', pupitre: 'guitare' },
            { personne_id: 'p6', pupitre: 'vents' },
          ],
        },
      ],
    })
    const creneaux = genererCreneaux(session, lieu)

    // On pose le placement horaire manuellement (le solveur pourrait le
    // trouver aussi — il ignore la jauge). Ce que teste ce contrat, c'est
    // que l'attribution attrape la violation, pas le placement lui-même.
    // attribuerSalles reçoit un PlacementItem (groupe+créneau, pas de salle).
    // La salle est justement ce qu'il calcule — on teste qu'il refuse.
    const res = attribuerSalles(
      [{ groupe_id: 'caravan', creneau_id: creneaux[0].id }],
      lieu,
      inscriptions,
      creneaux,
    )

    // Attendu : groupe signalé perdu (raison « trop petite »), aucune
    // assignation silencieuse dans la salle sous-dimensionnée.
    expect(res.assignations).toEqual([])
    expect(res.groupesPerdus).toHaveLength(1)
    expect(res.groupesPerdus[0].groupe_id).toBe('caravan')
    expect(res.groupesPerdus[0].effectif).toBe(6)
    expect(res.groupesPerdus[0].raison).toContain('trop petite')

    // Filet ceinture : si un jour attribuerSalles régresse et laisse passer,
    // verifier() doit tenir. On simule ce cas en injectant l'assignation
    // interdite directement dans verifier — jauge-depassee attendu.
    const assignationInterdite: Assignation[] = [
      { groupe_id: 'caravan', creneau_id: creneaux[0].id, salle_id: 'petite' },
    ]
    const problemes = verifier(session, lieu, inscriptions, creneaux, assignationInterdite)
    const jauge = problemes.filter(
      (p) => p.type === 'jauge-depassee' && p.groupe_id === 'caravan',
    )
    expect(jauge).toHaveLength(1)
  })

  it('pipeline complet : solveur + attribuer + verify sur input propre → aucun conflit', () => {
    // Le smoke Stéphane du 2026-09-03 17h-20h a fait 4 relances successives
    // sur balance-stress-test.xlsx (20 groupes, 60 places) qui rendaient
    // toutes « aucun conflit détecté ». Ce test verrouille le contrat au
    // niveau intégration : un pipeline complet sur une fixture synthétique
    // saine ne produit ni jauge-depassee ni creneaux-consecutifs. Si ça
    // casse un jour, on le voit ici — même sans repro du bug d'origine.
    const lieu = Lieu.parse({
      id: 'lieu',
      nom: 'Lieu',
      salles: [
        { id: 'A', nom: 'A', jauge: 10 },
        { id: 'B', nom: 'B', jauge: 6 },
      ],
    })
    const session = Session.parse({
      id: 's',
      nom: 'S',
      lieu_id: 'lieu',
      date_debut: '2026-08-24',
      date_fin: '2026-08-26',
      date_butoir: '2026-08-26',
      butoir_heure: '19:00',
      grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
      repetitions_visees: 2,
      repetitions_min: 2,
    })
    const inscriptions = Inscriptions.parse({
      session_id: 's',
      personnes: Array.from({ length: 6 }, (_, i) => ({
        id: `p${i}`,
        nom: `P${i}`,
        instruments: [{ pupitre: (['chant', 'piano', 'basse', 'batterie', 'guitare', 'vents'] as const)[i] }],
      })),
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [
            { personne_id: 'p0', pupitre: 'chant' },
            { personne_id: 'p1', pupitre: 'piano' },
          ],
        },
        {
          id: 'g2',
          titre: 'G2',
          membres: [
            { personne_id: 'p2', pupitre: 'basse' },
            { personne_id: 'p3', pupitre: 'batterie' },
          ],
        },
        {
          id: 'g3',
          titre: 'G3',
          membres: [
            { personne_id: 'p4', pupitre: 'guitare' },
            { personne_id: 'p5', pupitre: 'vents' },
          ],
        },
      ],
    })
    const creneaux = genererCreneaux(session, lieu)
    const { placement } = repartir(session, lieu, inscriptions, creneaux)
    const { assignations, groupesPerdus } = attribuerSalles(
      placement,
      lieu,
      inscriptions,
      creneaux,
    )
    const problemes = verifier(session, lieu, inscriptions, creneaux, assignations)

    expect(groupesPerdus).toEqual([])
    const violations = problemes.filter(
      (p) => p.type === 'jauge-depassee' || p.type === 'creneaux-consecutifs',
    )
    expect(violations).toEqual([])
  })
})
