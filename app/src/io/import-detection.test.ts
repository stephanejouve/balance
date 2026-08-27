import { describe, expect, it } from 'vitest'
import type { Inscriptions } from '../domain/model'
import {
  construireCandidatExcel,
  reconnaitreDestination,
} from './import-detection'
import type { DetectionExcel, SelectionExcel } from './import-detection'

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

  it('accepte quelques synonymes utiles', () => {
    expect(reconnaitreDestination('morceaux')).toBe('liste')
    expect(reconnaitreDestination('inscrits')).toBe('stagiaires')
    expect(reconnaitreDestination('concert')).toBe('proposes')
  })

  it('renvoie null pour un nom inconnu', () => {
    expect(reconnaitreDestination('Autre')).toBeNull()
    expect(reconnaitreDestination('')).toBeNull()
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
