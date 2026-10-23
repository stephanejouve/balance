/**
 * Issue #163 (smoke CD 2026-10-22) : un fichier d'import portant le seul
 * onglet Liste ne crée aucune personne. La répartition annonçait pourtant
 * « 12/12 groupes complets · 0 problème » et « Aucun conflit détecté par la
 * vérification indépendante » — la vérification sautait en silence les
 * membres absents du modèle (indispos, planning individuel).
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import { analyserSheetsExcel, construireCandidatExcel } from '../io/import-detection'
import { MAPPING_LISTE_DEFAUT } from '../io/liste-adapter'
import { MAPPING_PROPOSES_DEFAUT } from '../io/proposes-adapter'
import { MAPPING_STAGIAIRES_DEFAUT } from '../io/stagiaires-adapter'
import { attribuerSalles } from './allocate-rooms'
import { repartir } from './solver'
import type { Assignation } from './types'
import { verifier } from './verify'

const lieu = Lieu.parse({
  id: 'l',
  nom: 'L',
  salles: [
    { id: 'a', nom: 'A', jauge: 10, equipement: ['batterie', 'piano'] },
    { id: 'b', nom: 'B', jauge: 10, equipement: ['batterie', 'piano'] },
    { id: 'c', nom: 'C', jauge: 10, equipement: ['batterie', 'piano'] },
  ],
})
const session = Session.parse({
  id: 's', nom: 'S', lieu_id: 'l',
  date_debut: '2026-08-24', date_fin: '2026-08-28', date_butoir: '2026-08-28', butoir_heure: '23:59',
  grille: [{ debut: '09:00', fin: '11:59', pas_minutes: 60 }, { debut: '14:00', fin: '17:59', pas_minutes: 60 }],
})
const creneaux = genererCreneaux(session, lieu)

describe('verifier — membres absents du modèle (#163)', () => {
  it('modèle sans aucune personne : UN signalement global, pas un par groupe', () => {
    const insc = Inscriptions.parse({
      session_id: 's', personnes: [],
      groupes: [
        { id: 'g1', titre: 'Blue Bossa', membres: [{ personne_id: 'olivier-rouanet', pupitre: 'vents' }] },
        { id: 'g2', titre: 'Autumn Leaves', membres: [{ personne_id: 'ines-tabet', pupitre: 'vents' }] },
      ],
    })
    const ass: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'a' },
      { groupe_id: 'g2', creneau_id: creneaux[1].id, salle_id: 'a' },
    ]
    const pbs = verifier(session, lieu, insc, creneaux, ass)
    expect(pbs.map((p) => p.type)).toEqual(['aucune-personne'])
    expect(pbs[0].message).toMatch(/^Aucune personne dans le modèle/)
  })

  it('membre inconnu dans un groupe placé : nommé, groupe par groupe', () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'alice', nom: 'Alice', instruments: [{ pupitre: 'chant' }] }],
      groupes: [
        { id: 'g1', titre: 'Blue Bossa', membres: [
          { personne_id: 'alice', pupitre: 'chant' },
          { personne_id: 'olivier-rouanet', pupitre: 'vents' },
        ] },
        { id: 'g2', titre: 'Résolu', membres: [{ personne_id: 'alice', pupitre: 'chant' }] },
        { id: 'g3', titre: 'Non placé', membres: [{ personne_id: 'inconnu', pupitre: 'vents' }] },
      ],
    })
    const ass: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'a' },
      { groupe_id: 'g2', creneau_id: creneaux[1].id, salle_id: 'a' },
    ]
    const pbs = verifier(session, lieu, insc, creneaux, ass)
    expect(pbs).toEqual([
      expect.objectContaining({ type: 'membre-inconnu', groupe_id: 'g1', message: expect.stringContaining('olivier-rouanet') }),
    ])
    // #202 : accord au singulier pour un seul membre absent.
    expect(pbs[0].message).toBe(
      '« Blue Bossa » : 1 membre absent des personnes (olivier-rouanet) — ni ses indisponibilités ni son planning individuel ne sont vérifiés',
    )
  })

  it('#202 : deux membres absents dans un groupe, au pluriel', () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'alice', nom: 'Alice', instruments: [{ pupitre: 'chant' }] }],
      groupes: [{ id: 'g1', titre: 'Blue Bossa', membres: [
        { personne_id: 'alice', pupitre: 'chant' },
        { personne_id: 'olivier-rouanet', pupitre: 'vents' },
        { personne_id: 'ines-tabet', pupitre: 'vents' },
      ] }],
    })
    const pbs = verifier(session, lieu, insc, creneaux, [{ groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'a' }])
    expect(pbs[0].message).toBe(
      '« Blue Bossa » : 2 membres absents des personnes (olivier-rouanet, ines-tabet) — ni leurs indisponibilités ni leur planning individuel ne sont vérifiés',
    )
  })

  it('rien de placé : rien à signaler', () => {
    const insc = Inscriptions.parse({ session_id: 's', personnes: [], groupes: [] })
    expect(verifier(session, lieu, insc, creneaux, [])).toEqual([])
  })

  it('pipeline réel, onglet Liste seul : le planning produit n\'est plus déclaré sans problème', async () => {
    const buffer = readFileSync(join(__dirname, '..', '..', 'tests', 'fixtures', 'balance-stress-test.xlsx'))
    const sheets = (await readXlsxFile(buffer, { getSheets: false } as never)) as unknown as Array<{ sheet: string; data: unknown[][] }>
    const detection = analyserSheetsExcel(
      sheets, 'balance-stress-test.xlsx', buffer.length,
      { liste: MAPPING_LISTE_DEFAUT, stagiaires: MAPPING_STAGIAIRES_DEFAUT, proposes: MAPPING_PROPOSES_DEFAUT }, [],
    )
    const listes = detection.onglets.filter((o) => o.destination === 'liste' && o.statut === 'ok').map((o) => o.nom)
    expect(listes.length).toBeGreaterThan(0)
    const insc = construireCandidatExcel(
      detection,
      { ongletsCoches: new Set(listes), destinationsManuelles: new Map() },
      Inscriptions.parse({ session_id: 's', personnes: [], groupes: [] }),
      's',
    )
    // L'état du smoke : des groupes avec membres, aucune personne.
    expect(insc.personnes).toEqual([])
    expect(insc.groupes.length).toBeGreaterThan(0)
    expect(insc.groupes.some((g) => g.membres.length > 0)).toBe(true)

    const { placement } = repartir(session, lieu, insc, creneaux, { seed: 42, maxEssais: 50 })
    expect(placement.length).toBeGreaterThan(0)
    const { assignations } = attribuerSalles(placement, lieu, insc, creneaux)
    const pbs = verifier(session, lieu, insc, creneaux, assignations)
    expect(pbs.map((p) => p.type)).toContain('aucune-personne')
  })
})
