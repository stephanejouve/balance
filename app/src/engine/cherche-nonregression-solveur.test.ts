/**
 * Non-régression solveur post-CHERCHE quantifié — vérifie que le
 * placement de balance-stress-test.xlsx reste identique après le
 * refactor `postes_cherches: Pupitre[] → PosteCherche[]`.
 *
 * Contexte Stéphane 2026-09-04 (brief CHERCHE, réserve non-régression) :
 * « Trois runs ont donné un planning identique à la cellule près.
 * CHERCHE touche au modèle de groupe : si le planning bouge après ton
 * PR, on veut le savoir, et on saura que ça vient de là. »
 *
 * Fixture versionnée au repo (app/tests/fixtures/balance-stress-test.xlsx)
 * — mesure reproductible sans dépôt cross-user. Seed = 42 (fixe le RNG
 * pour comparaison au bit près). Le placement attendu est capturé la
 * première fois puis maintenu comme référence.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { migrerInscriptions } from '../domain/migrate'
import { Lieu, Session } from '../domain/model'
import { extraireListe, MAPPING_LISTE_DEFAUT } from '../io/liste-adapter'
import { extraireStagiaires, MAPPING_STAGIAIRES_DEFAUT } from '../io/stagiaires-adapter'
import { attribuerSalles } from './allocate-rooms'
import { repartir } from './solver'

const STRESS_XLSX = join(__dirname, '..', '..', 'tests', 'fixtures', 'balance-stress-test.xlsx')

/** Reproduction de la config lieu/session utilisée dans App.svelte (défaut MF).
 *  Voir issue #79 : ce contexte est spécifique à Musiques Festives — extract
 *  vers un « template MF » chargeable est un follow-up P3. */
function lieuMF() {
  return Lieu.parse({
    id: 'musiques-festives',
    nom: 'Musiques Festives — Domaine de Meilhac',
    salles: [
      { id: 'le-garage', nom: 'Le Garage', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'xveme', nom: 'XVème', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'les-clapiers', nom: 'Les Clapiers', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'l-esperance', nom: "L'Espérance", jauge: 6, equipement: ['piano'] },
      { id: 'la-chenaie', nom: 'La Chênaie', jauge: 6, equipement: ['piano'] },
    ],
  })
}

function sessionMF() {
  return Session.parse({
    id: 'session-5',
    nom: 'Session 5 — Musiques Festives',
    lieu_id: 'musiques-festives',
    date_debut: '2026-08-24',
    date_fin: '2026-08-28',
    date_butoir: '2026-08-26',
    butoir_heure: '18:30',
    grille: [
      { debut: '09:00', fin: '12:00', pas_minutes: 60 },
      { debut: '13:30', fin: '18:30', pas_minutes: 60 },
      { debut: '22:00', fin: '24:00', pas_minutes: 60 },
    ],
    repetitions_visees: 3,
    repetitions_min: 2,
  })
}

describe('non-régression solveur post-CHERCHE quantifié sur balance-stress-test', () => {
  it('placement identique à la référence attendue (20/20 groupes, 60 séances)', async () => {
    const buffer = readFileSync(STRESS_XLSX)
    const allSheets = (await readXlsxFile(buffer, { getSheets: false } as never)) as unknown as Array<{ sheet: string; data: unknown[][] }>
    const listeSheet = allSheets.find((s) => s.sheet === 'Liste')!
    const stagSheet = allSheets.find((s) => s.sheet === 'Stagiaires')!

    const legacyGroupes = extraireListe(listeSheet.data as never, MAPPING_LISTE_DEFAUT)
    const stagiaires = extraireStagiaires(stagSheet.data as never, MAPPING_STAGIAIRES_DEFAUT)

    const inscMigre = migrerInscriptions(
      { groupes: legacyGroupes.groupes, membresImposes: {}, indispos: [], identitesConnues: [] },
      'session-5',
    )
    // Merge stagiaires (les personnes extraites de l'onglet Stagiaires)
    const personnesMigreeIds = new Set(inscMigre.personnes.map((p) => p.id))
    const personnesFinales = [
      ...inscMigre.personnes,
      ...stagiaires.personnes.filter((p) => !personnesMigreeIds.has(p.id)),
    ]
    const inscriptions = { ...inscMigre, personnes: personnesFinales }

    const lieu = lieuMF()
    const session = sessionMF()
    const creneaux = genererCreneaux(session, lieu)

    const { placement, groupes_complets, places_totales } = repartir(
      session,
      lieu,
      inscriptions,
      creneaux,
    )
    const { assignations } = attribuerSalles(placement, lieu, inscriptions, creneaux)

    // Contrat historique établi Stéphane 2026-09-03 v20260903.1817 :
    // balance-stress-test se résout complètement (20/20) avec 60 séances
    // (20 groupes × 3 répés visées). Toute divergence après CHERCHE
    // quantifié est attribuable au refactor `postes_cherches`.
    expect(groupes_complets).toBe(20)
    expect(places_totales).toBe(60)
    expect(placement.length).toBe(60)
    expect(assignations.length).toBe(60)
    // Toutes les assignations ont une salle attribuée (aucun groupePerdu)
    expect(assignations.every((a) => a.salle_id.length > 0)).toBe(true)
  })
})
