import { describe, expect, it } from 'vitest'
import type { Inscriptions } from '../domain/model'
import { MAPPING_LISTE_DEFAUT } from './liste-adapter'
import { MAPPING_PROPOSES_DEFAUT } from './proposes-adapter'
import { MAPPING_STAGIAIRES_DEFAUT } from './stagiaires-adapter'
import {
  analyserSheetsExcel,
  construireCandidatExcel,
  reconnaitreDestination,
} from './import-detection'
import type { DetectionExcel, SelectionExcel } from './import-detection'

const MAPPINGS = {
  liste: MAPPING_LISTE_DEFAUT,
  stagiaires: MAPPING_STAGIAIRES_DEFAUT,
  proposes: MAPPING_PROPOSES_DEFAUT,
}

describe('reconnaitreDestination — casse, accents, espaces', () => {
  it('reconnaît la casse basse', () => {
    expect(reconnaitreDestination('liste')).toBe('liste')
    expect(reconnaitreDestination('stagiaires')).toBe('stagiaires')
    expect(reconnaitreDestination('proposes')).toBe('proposes')
  })

  it('reconnaît la casse haute', () => {
    expect(reconnaitreDestination('LISTE')).toBe('liste')
    expect(reconnaitreDestination('STAGIAIRES')).toBe('stagiaires')
    expect(reconnaitreDestination('PROPOSES')).toBe('proposes')
  })

  it('reconnaît les accents', () => {
    expect(reconnaitreDestination('proposés')).toBe('proposes')
    expect(reconnaitreDestination('PROPOSÉS')).toBe('proposes')
  })

  it('reconnaît un nom avec espace initiale ou finale', () => {
    expect(reconnaitreDestination('Liste ')).toBe('liste')
    expect(reconnaitreDestination(' Stagiaires')).toBe('stagiaires')
    expect(reconnaitreDestination('  Proposés  ')).toBe('proposes')
  })

  it('ne devine PAS les synonymes courants — reconnaître à tort coûte cher', () => {
    // Volontairement : pas de reconnaissance de morceaux/inscrits/concert.
    // Le sélecteur manuel prendra le relais à l'écran de détection.
    expect(reconnaitreDestination('morceaux')).toBeNull()
    expect(reconnaitreDestination('inscrits')).toBeNull()
    expect(reconnaitreDestination('concert')).toBeNull()
    expect(reconnaitreDestination('imposes')).toBeNull()
  })

  it('renvoie null pour un nom inconnu ou vide', () => {
    expect(reconnaitreDestination('Autre')).toBeNull()
    expect(reconnaitreDestination('')).toBeNull()
  })
})

describe('analyserSheetsExcel — verrouille les défauts latents du brief', () => {
  it('défaut #1 : Liste avec colonnes non conformes → statut echec, actifParDefaut false', () => {
    // Onglet nommé « Liste » (reconnu) mais dont la colonne « Morceau »
    // manque. `extraireListe` retourne { groupes: [], warnings: […] } sans
    // lever d'exception. On veut que la détection classe ça en `echec`,
    // pas en import vide silencieux.
    const sheets = [
      { sheet: 'Liste', data: [['ColonneAutre'], ['ligne 1']] },
    ]
    const det = analyserSheetsExcel(sheets, 'test.xlsx', 100, MAPPINGS, [])
    const ongletListe = det.onglets.find((o) => o.nom === 'Liste')!
    expect(ongletListe.destination).toBe('liste')
    expect(ongletListe.statut).toBe('echec')
    expect(ongletListe.actifParDefaut).toBe(false)
    expect(ongletListe.warnings.some((w) => w.includes('Morceau'))).toBe(true)
  })

  it('défaut #2 : LISTE, Liste , Proposés (accents) reconnus par la détection', () => {
    const sheets = [
      { sheet: 'LISTE', data: [['Morceau'], ['Love']] },
      { sheet: 'Proposés', data: [['Morceau', 'Membres', 'Date', 'Début', 'Fin'], []] },
    ]
    const det = analyserSheetsExcel(sheets, 't.xlsx', 100, MAPPINGS, [])
    expect(det.onglets.find((o) => o.nom === 'LISTE')?.destination).toBe('liste')
    expect(det.onglets.find((o) => o.nom === 'Proposés')?.destination).toBe('proposes')
  })

  it("aucun onglet reconnu → warning global qui liste les onglets présents", () => {
    const sheets = [
      { sheet: 'Contacts', data: [['Nom']] },
      { sheet: 'Notes', data: [['Note']] },
    ]
    const det = analyserSheetsExcel(sheets, 't.xlsx', 100, MAPPINGS, [])
    expect(det.warningsGlobaux.length).toBeGreaterThan(0)
    expect(det.warningsGlobaux[0]).toContain('Contacts')
    expect(det.warningsGlobaux[0]).toContain('Notes')
    // Onglets présents mais tous en « ignore »
    expect(det.onglets.every((o) => o.destination === null)).toBe(true)
  })
})

describe('construireCandidatExcel — candidat complet, une seule affectation', () => {
  const insc = (o: Partial<Inscriptions> = {}): Inscriptions => ({
    session_id: 's',
    personnes: [],
    groupes: [],
    imposes: [],
    ...o,
  })

  const detection = (
    onglets: Array<{
      nom: string
      destination: 'liste' | 'stagiaires' | 'proposes' | null
      statut: 'ok' | 'echec' | 'ignore'
    }>,
    payloads: DetectionExcel['_payloads'],
  ): DetectionExcel => ({
    type: 'xlsx',
    nomFichier: 'test.xlsx',
    taille: 1000,
    onglets: onglets.map((o) => ({
      nom: o.nom,
      destination: o.destination,
      effet: o.destination === 'stagiaires' ? 'complete' : o.destination ? 'remplace' : 'ignore',
      statut: o.statut,
      resume: '',
      warnings: [],
      actifParDefaut: o.statut === 'ok',
    })),
    warningsGlobaux: [],
    _payloads: payloads,
  })

  it("un onglet non coché n'entre pas dans le candidat", () => {
    const actuel = insc({
      personnes: [{ id: 'existant', nom: 'X', discriminant: '', instruments: [], role: 'musicien', indispos: [] }],
    })
    const det = detection(
      [{ nom: 'Stagiaires', destination: 'stagiaires', statut: 'ok' }],
      new Map([
        [
          'Stagiaires',
          {
            destination: 'stagiaires',
            personnes: [{ id: 'nouveau', nom: 'N', discriminant: '', instruments: [], role: 'musicien', indispos: [] }],
          },
        ],
      ]),
    )
    const sel: SelectionExcel = { ongletsCoches: new Set(), destinationsManuelles: new Map() }
    const cand = construireCandidatExcel(det, sel, actuel, 's')
    expect(cand.personnes.map((p) => p.id)).toEqual(['existant'])
  })

  it("un onglet en échec de lecture n'entre pas, même s'il est coché", () => {
    const actuel = insc({
      groupes: [{ id: 'gExist', titre: 'G', auteur: '', style: '', tonalite: '', responsable_id: '', membres: [], postes_cherches: [], repetitions_deja_faites: 0 }],
    })
    const det = detection([{ nom: 'Liste', destination: 'liste', statut: 'echec' }], new Map())
    const sel: SelectionExcel = { ongletsCoches: new Set(['Liste']), destinationsManuelles: new Map() }
    const cand = construireCandidatExcel(det, sel, actuel, 's')
    // Groupes actuels préservés — la sélection cochée n'a pas remplacé
    expect(cand.groupes.map((g) => g.id)).toEqual(['gExist'])
  })

  it('Liste (remplace) écrase les groupes existants', () => {
    const actuel = insc({
      groupes: [{ id: 'ancien', titre: 'Ancien', auteur: '', style: '', tonalite: '', responsable_id: '', membres: [], postes_cherches: [], repetitions_deja_faites: 0 }],
    })
    const det = detection(
      [{ nom: 'Liste', destination: 'liste', statut: 'ok' }],
      new Map([
        [
          'Liste',
          {
            destination: 'liste',
            groupes: [{ id: 'nouveau', titre: 'Nouveau', auteur: '', style: '', tonalite: '', responsable_id: '', membres: [], postes_cherches: [], repetitions_deja_faites: 0 }],
          },
        ],
      ]),
    )
    const sel: SelectionExcel = { ongletsCoches: new Set(['Liste']), destinationsManuelles: new Map() }
    const cand = construireCandidatExcel(det, sel, actuel, 's')
    expect(cand.groupes.map((g) => g.id)).toEqual(['nouveau'])
  })

  it('Stagiaires (complète) fusionne — les doublons par id sont ignorés', () => {
    const actuel = insc({
      personnes: [
        { id: 'alice', nom: 'Alice', discriminant: '', instruments: [], role: 'musicien', indispos: [] },
      ],
    })
    const det = detection(
      [{ nom: 'Stagiaires', destination: 'stagiaires', statut: 'ok' }],
      new Map([
        [
          'Stagiaires',
          {
            destination: 'stagiaires',
            personnes: [
              // Alice déjà présente → ignorée
              { id: 'alice', nom: 'Alice v2', discriminant: '', instruments: [], role: 'musicien', indispos: [] },
              // Bob nouveau → ajouté
              { id: 'bob', nom: 'Bob', discriminant: '', instruments: [], role: 'musicien', indispos: [] },
            ],
          },
        ],
      ]),
    )
    const sel: SelectionExcel = { ongletsCoches: new Set(['Stagiaires']), destinationsManuelles: new Map() }
    const cand = construireCandidatExcel(det, sel, actuel, 's')
    expect(cand.personnes.map((p) => p.id)).toEqual(['alice', 'bob'])
    // Alice v1 préservée (pas écrasée)
    expect(cand.personnes[0].nom).toBe('Alice')
  })

  it("l'état actuel n'est pas muté (structural sharing OK)", () => {
    const actuel = insc({
      personnes: [{ id: 'alice', nom: 'Alice', discriminant: '', instruments: [], role: 'musicien', indispos: [] }],
    })
    const personnesRefAvant = actuel.personnes
    const det = detection(
      [{ nom: 'Stagiaires', destination: 'stagiaires', statut: 'ok' }],
      new Map([
        [
          'Stagiaires',
          {
            destination: 'stagiaires',
            personnes: [{ id: 'bob', nom: 'Bob', discriminant: '', instruments: [], role: 'musicien', indispos: [] }],
          },
        ],
      ]),
    )
    const sel: SelectionExcel = { ongletsCoches: new Set(['Stagiaires']), destinationsManuelles: new Map() }
    construireCandidatExcel(det, sel, actuel, 's')
    // La référence du tableau originel n'a pas gagné Bob
    expect(actuel.personnes).toBe(personnesRefAvant)
    expect(actuel.personnes.map((p) => p.id)).toEqual(['alice'])
  })
})
