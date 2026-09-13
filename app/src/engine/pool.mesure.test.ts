/**
 * Mesure du volume du pool sur les 2 fixtures versionnées (apero_mercredi.json
 * + balance-stress-test.xlsx). Test invoqué par le fix des défauts A + B —
 * CD msg 6756 : « fais A et B en une PR, ses tests, et le relevé du nombre
 * de propositions avant et apres sur les deux jeux. »
 *
 * Chiffres AVANT le fix (relevé Stéphane / CD msg 6754) :
 *  - jeu apéro (fixture): 57 propositions
 *  - jeu stress (xlsx):   94 propositions
 *
 * Ce test imprime les chiffres APRÈS le fix et vérifie qu'ils sont
 * strictement inférieurs. La comparaison quantitative précise est
 * rapportée dans le corps de la PR (chaque relève doit refléter la
 * fonction réellement exécutée, cf feedback CD 6588 « recalculer un
 * tableau de valeurs avec la formule réelle »).
 *
 * NOTE post-N1 comptée (CD msg 6769) : dans les 2 fixtures versionnées,
 * TOUS les `postes_cherches[].nb` valent 1. La version comptée
 * `libres_count >= cherche.nb` est donc strictement équivalente à la
 * version binaire pour ces jeux — les chiffres 42 / 0 sont inchangés.
 * Le cas de bord Leader (cible cherche `nb > 1` avec `libres < nb`) est
 * couvert par un test unitaire dédié dans `pool.test.ts` (défaut B —
 * version comptée), qui isole le comportement sans dépendre des fixtures.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'
import { parseLegacyInscriptions } from '../domain/legacy'
import { migrerInscriptions } from '../domain/migrate'
import { Lieu, Session } from '../domain/model'
import { genererCreneaux } from '../domain/grille'
import { extraireListe, MAPPING_LISTE_DEFAUT } from '../io/liste-adapter'
import { extraireStagiaires, MAPPING_STAGIAIRES_DEFAUT } from '../io/stagiaires-adapter'
import { plusGrandeJaugeActive } from './plafond-salle'
import { calculerPool } from './pool'
// eslint-disable-next-line import/no-relative-parent-imports
import apero from '../fixtures/apero_mercredi.json'

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

describe('calculerPool — mesure volume post-fix défauts A+B (CD msg 6756)', () => {
  it('jeu apéro (fixture legacy) : volume post-fix strictement < 57 (avant fix)', () => {
    const inscriptions = migrerInscriptions(parseLegacyInscriptions(apero), 'session-5')
    const lieu = lieuMF()
    const session = sessionMF()
    const creneaux = genererCreneaux(session, lieu)
    const plusGrandeJauge = plusGrandeJaugeActive(lieu.salles)
    const pool = calculerPool(inscriptions, session, creneaux, [], plusGrandeJauge)
    // Impression pour le relevé PR (invocable via `npm test -- pool.mesure`).
    // eslint-disable-next-line no-console
    console.log(`[MESURE apéro] pool.length = ${pool.length} (avant fix : 57)`)
    expect(pool.length).toBeLessThan(57)
  })

  it('jeu apéro : comptage des couples distincts (personne, source) pour trancher défaut C', () => {
    // CD 6761 : les 42 propositions résiduelles apéro se ramènent-elles à
    // 8-10 couples (personne, source) distincts (produit cartésien réel,
    // refactor C justifié) ou à 42 couples différents (diversité réelle,
    // pas de regroupement à faire) ? Ce comptage tranche le défaut C.
    //
    // Aussi mesuré : combien de propositions concernent une source qui
    // ne cherche rien (source.postes_cherches vide) — là où A ne mord pas.
    // Ce chiffre distingue quel des 2 correctifs A/B porte quoi (CD 6761).
    const inscriptions = migrerInscriptions(parseLegacyInscriptions(apero), 'session-5')
    const lieu = lieuMF()
    const session = sessionMF()
    const creneaux = genererCreneaux(session, lieu)
    const plusGrandeJauge = plusGrandeJaugeActive(lieu.salles)
    const pool = calculerPool(inscriptions, session, creneaux, [], plusGrandeJauge)
    const couples = new Set(pool.map((p) => `${p.personne_id}|${p.source_groupe_id}`))
    const groupesParId = new Map(inscriptions.groupes.map((g) => [g.id, g]))
    const propsSourceSansCherche = pool.filter(
      (p) => (groupesParId.get(p.source_groupe_id)?.postes_cherches.length ?? 0) === 0,
    )
    // eslint-disable-next-line no-console
    console.log(
      `[MESURE apéro discriminant C] couples (personne, source) distincts = ${couples.size} sur ${pool.length} propositions. Propositions dont source.postes_cherches vide (A ne mord pas) = ${propsSourceSansCherche.length}.`,
    )
    // Assertions minimales pour verrouiller le format de sortie — le chiffre
    // en lui-même est signalé par le log pour être rapporté à CD.
    expect(couples.size).toBeGreaterThan(0)
    expect(couples.size).toBeLessThanOrEqual(pool.length)
  })

  it('jeu stress (xlsx) : volume post-fix strictement < 94 (avant fix)', async () => {
    const STRESS_XLSX = join(__dirname, '..', '..', 'tests', 'fixtures', 'balance-stress-test.xlsx')
    const buffer = readFileSync(STRESS_XLSX)
    const allSheets = (await readXlsxFile(buffer, { getSheets: false } as never)) as unknown as Array<{
      sheet: string
      data: unknown[][]
    }>
    const listeSheet = allSheets.find((s) => s.sheet === 'Liste')!
    const stagSheet = allSheets.find((s) => s.sheet === 'Stagiaires')!

    const legacyGroupes = extraireListe(listeSheet.data as never, MAPPING_LISTE_DEFAUT)
    const stagiaires = extraireStagiaires(stagSheet.data as never, MAPPING_STAGIAIRES_DEFAUT)

    const inscMigre = migrerInscriptions(
      { groupes: legacyGroupes.groupes, membresImposes: {}, indispos: [], identitesConnues: [] },
      'session-5',
    )
    const personnesMigreeIds = new Set(inscMigre.personnes.map((p) => p.id))
    const personnesFinales = [
      ...inscMigre.personnes,
      ...stagiaires.personnes.filter((p) => !personnesMigreeIds.has(p.id)),
    ]
    const inscriptions = { ...inscMigre, personnes: personnesFinales }

    const lieu = lieuMF()
    const session = sessionMF()
    const creneaux = genererCreneaux(session, lieu)
    const plusGrandeJauge = plusGrandeJaugeActive(lieu.salles)
    const pool = calculerPool(inscriptions, session, creneaux, [], plusGrandeJauge)
    // eslint-disable-next-line no-console
    console.log(`[MESURE stress] pool.length = ${pool.length} (avant fix : 94)`)
    expect(pool.length).toBeLessThan(94)
  })

  it("propriété : sur un jeu où tout se place, le pool doit être vide (CD 6761)", async () => {
    // CD 6761 : 100 % d'élimination sur le stress a inquiété — mais c'est
    // le comportement attendu. Le jeu stress termine 20/20 groupes complets,
    // rien n'est bloqué, aucun morceau ne manque de personne. Dans cette
    // situation, AUCUN mouvement n'est pertinent : déplacer quelqu'un ne
    // servirait personne. Un pool vide n'est donc PAS une sur-filtration
    // du fix, c'est la propriété que le pool doit satisfaire.
    //
    // Ce test garde la propriété comme invariant : si demain un fix casse
    // cette propriété (le pool émet des propositions sur un jeu où tout
    // se place), on saura que le calcul dérive.
    const STRESS_XLSX = join(__dirname, '..', '..', 'tests', 'fixtures', 'balance-stress-test.xlsx')
    const buffer = readFileSync(STRESS_XLSX)
    const allSheets = (await readXlsxFile(buffer, { getSheets: false } as never)) as unknown as Array<{
      sheet: string
      data: unknown[][]
    }>
    const listeSheet = allSheets.find((s) => s.sheet === 'Liste')!
    const stagSheet = allSheets.find((s) => s.sheet === 'Stagiaires')!
    const legacyGroupes = extraireListe(listeSheet.data as never, MAPPING_LISTE_DEFAUT)
    const stagiaires = extraireStagiaires(stagSheet.data as never, MAPPING_STAGIAIRES_DEFAUT)
    const inscMigre = migrerInscriptions(
      { groupes: legacyGroupes.groupes, membresImposes: {}, indispos: [], identitesConnues: [] },
      'session-5',
    )
    const personnesMigreeIds = new Set(inscMigre.personnes.map((p) => p.id))
    const inscriptions = {
      ...inscMigre,
      personnes: [
        ...inscMigre.personnes,
        ...stagiaires.personnes.filter((p) => !personnesMigreeIds.has(p.id)),
      ],
    }
    const lieu = lieuMF()
    const session = sessionMF()
    const creneaux = genererCreneaux(session, lieu)
    const plusGrandeJauge = plusGrandeJaugeActive(lieu.salles)
    const pool = calculerPool(inscriptions, session, creneaux, [], plusGrandeJauge)
    // Propriété exprimée factuellement : sur un jeu où tout se place
    // (aucune infaisabilité), le pool est vide.
    expect(pool).toEqual([])
  })
})
