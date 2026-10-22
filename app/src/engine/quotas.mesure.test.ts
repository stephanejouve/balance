/**
 * Mesure #92 — saturation `analyseQuotas` sur les 2 fixtures versionnées
 * (apero_mercredi.json + balance-stress-test.xlsx via le pipeline d'import
 * réel), comparée à l'ancienne capacité brute `musiciens × créneaux`.
 *
 * Rapport avant correctif (issue #92, 2026-10-22, sur main f8e0a7e) :
 *  - indispos seules : écart 0 % (apéro) à 0,5 % (stress) par pupitre ;
 *  - butoir : tous les groupes sont en échéance apéro, 28 créneaux avant
 *    butoir sur 50 → ratio affiché près de 2× trop bas (batterie stress
 *    0,171 affiché vs 0,306 réel).
 *
 * Ces écarts valent pour NOS fixtures, pas pour un stage réel : l'hypothèse
 * 20-40 % du ticket (stage chargé d'indispos) n'est ni confirmée ni
 * infirmée faute de jeu représentatif.
 *
 * Garde-fou : le ratio affiché doit être celui de la fenêtre apéro (seule
 * échéance présente), calculé ici indépendamment avec la règle butoir du
 * solveur, et strictement supérieur au ratio brut d'avant #92.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'
import { parseLegacyInscriptions } from '../domain/legacy'
import { migrerInscriptions } from '../domain/migrate'
import { Inscriptions, Lieu, Session } from '../domain/model'
import { butoirKeyDeGroupe, genererCreneaux, type Creneau } from '../domain/grille'
import { analyserSheetsExcel, construireCandidatExcel } from '../io/import-detection'
import { MAPPING_LISTE_DEFAUT } from '../io/liste-adapter'
import { MAPPING_PROPOSES_DEFAUT } from '../io/proposes-adapter'
import { MAPPING_STAGIAIRES_DEFAUT } from '../io/stagiaires-adapter'
import { indispoBloque } from './indispo'
import { analyseQuotas } from './quotas'
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
      { debut: '22:00', fin: '23:59', pas_minutes: 60 },
    ],
    repetitions_visees: 3,
    repetitions_min: 2,
  })
}

function releve(label: string, session: Session, inscriptions: Inscriptions, creneaux: readonly Creneau[]) {
  // Les deux jeux n'ont que des groupes apéro — prérequis du garde-fou.
  expect(inscriptions.groupes.every((g) => g.echeance === 'apero_mercredi')).toBe(true)
  const butoir = butoirKeyDeGroupe(session, 'apero_mercredi')
  const avantButoir = creneaux.filter((c) => `${c.date}T${c.debut.replace(':', '')}` < butoir)
  const lignes: string[] = [
    `[MESURE #92 ${label}] ${inscriptions.personnes.length} personnes, ${avantButoir.length} créneaux avant butoir apéro sur ${creneaux.length}`,
    'pupitre | demande | capa brute → capa | ratio brut → affiché',
  ]
  for (const q of analyseQuotas(session, inscriptions, creneaux)) {
    const musiciens = inscriptions.personnes.filter((p) => p.instruments.some((i) => i.pupitre === q.pupitre))
    let attendu = 0
    for (const p of musiciens) {
      for (const c of avantButoir) if (!indispoBloque(p, c, [q.pupitre])) attendu++
    }
    const brute = musiciens.length * creneaux.length
    expect(q.capacite).toBe(attendu)
    expect(q.ratio).toBeGreaterThan(q.demande / brute)
    lignes.push(
      `${q.pupitre} | ${q.demande} | ${brute} → ${q.capacite} | ${(q.demande / brute).toFixed(3)} → ${q.ratio.toFixed(3)}`,
    )
  }
  // Relevé imprimé pour la PR (invocable via `npm test -- quotas.mesure`).
  // eslint-disable-next-line no-console
  console.log(lignes.join('\n'))
}

describe('analyseQuotas — mesure #92 capacité avant butoir, hors indispos', () => {
  it('jeu apéro (fixture legacy)', () => {
    const inscriptions = migrerInscriptions(parseLegacyInscriptions(apero), 'session-5')
    const session = sessionMF()
    releve('apéro', session, inscriptions, genererCreneaux(session, lieuMF()))
  })

  it('jeu stress (xlsx, pipeline import réel)', async () => {
    const buffer = readFileSync(join(__dirname, '..', '..', 'tests', 'fixtures', 'balance-stress-test.xlsx'))
    const sheets = (await readXlsxFile(buffer, { getSheets: false } as never)) as unknown as Array<{
      sheet: string
      data: unknown[][]
    }>
    const detection = analyserSheetsExcel(
      sheets,
      'balance-stress-test.xlsx',
      buffer.length,
      { liste: MAPPING_LISTE_DEFAUT, stagiaires: MAPPING_STAGIAIRES_DEFAUT, proposes: MAPPING_PROPOSES_DEFAUT },
      [],
    )
    const coches = new Set(detection.onglets.filter((o) => o.destination !== null && o.statut === 'ok').map((o) => o.nom))
    const vide = Inscriptions.parse({ session_id: 'session-5', personnes: [], groupes: [] })
    const inscriptions = construireCandidatExcel(
      detection,
      { ongletsCoches: coches, destinationsManuelles: new Map() },
      vide,
      'session-5',
    )
    const session = sessionMF()
    releve('stress', session, inscriptions, genererCreneaux(session, lieuMF()))
  })
})
