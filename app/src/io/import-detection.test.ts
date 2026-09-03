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

  it("robuste : un onglet reconnu dont data n'est pas un Array ne cratère pas la détection", () => {
    // Cas observé sur classeur réel — la lib peut retourner `undefined` ou
    // une structure non-tableau pour certaines feuilles (bug crash historique
    // « e.forEach is not a function »). L'onglet malformé doit passer en
    // `echec` et les autres onglets doivent continuer à être analysés.
    const sheets = [
      { sheet: 'Liste', data: undefined as unknown as unknown[][] },
      { sheet: 'Stagiaires', data: [['Nom', 'Pupitre'], ['Alice', 'chant']] },
    ]
    const det = analyserSheetsExcel(sheets, 't.xlsx', 100, MAPPINGS, [])
    const listeOnglet = det.onglets.find((o) => o.nom === 'Liste')!
    const stagOnglet = det.onglets.find((o) => o.nom === 'Stagiaires')!
    expect(listeOnglet.statut).toBe('echec')
    expect(listeOnglet.actifParDefaut).toBe(false)
    expect(stagOnglet.statut).toBe('ok') // autre onglet préservé
  })

  it("robuste : un onglet dont les rows contiennent des éléments non-array est nettoyé", () => {
    // Cas Excel : feuille avec en-tête + lignes vides pouvant tomber en null.
    // Le filtre défensif `filter(Array.isArray)` doit lisser ça.
    const sheets = [
      {
        sheet: 'Stagiaires',
        data: [
          ['Nom', 'Pupitre'],
          null as unknown as unknown[],
          ['Alice', 'chant'],
        ],
      },
    ]
    const det = analyserSheetsExcel(sheets, 't.xlsx', 100, MAPPINGS, [])
    const stagOnglet = det.onglets.find((o) => o.nom === 'Stagiaires')!
    expect(stagOnglet.statut).toBe('ok')
  })

  it("réordonne Stagiaires avant Proposés → membres résolus même si Proposés arrive en premier dans le classeur (audit Stéphane 2026-09-03)", () => {
    // Avant le fix : parcours dans l'ordre du fichier → Proposés lu avec
    // idsConnus vide → 1 warning « membre inconnu » faux par ligne, 30+
    // warnings sur balance-stress-test.xlsx. Le tri ORDRE_ANALYSE garantit
    // que Stagiaires alimente le référentiel avant que Proposés le consulte.
    const sheets = [
      {
        sheet: 'Proposés',
        data: [
          ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
          ['Autumn Leaves', 'Denis', '2026-08-28', '09:00', '10:00'],
        ],
      },
      {
        sheet: 'Stagiaires',
        data: [
          ['Nom', 'Pupitre'],
          ['Denis', 'chant'],
        ],
      },
    ]
    const det = analyserSheetsExcel(sheets, 't.xlsx', 100, MAPPINGS, [])
    const proposesOnglet = det.onglets.find((o) => o.nom === 'Proposés')!
    expect(proposesOnglet.statut).toBe('ok')
    // 0 warning « inconnu » : Denis est résolu grâce à Stagiaires parsé avant.
    expect(proposesOnglet.warnings.some((w) => w.includes('non trouvé'))).toBe(false)
    expect(proposesOnglet.warnings.some((w) => w.includes('à créer'))).toBe(false)
  })

  it("classeur Proposés seul → warning informatif « à créer côté Stagiaires » (pas trompeur)", () => {
    // Cas produit par l'import PDF de Leader (PR #58) : Stagiaires/Liste
    // vides, seul Proposés est peuplé. Le référentiel reste vide même après
    // réordonnancement — le message doit dire la vérité (à compléter côté
    // Stagiaires), pas suggérer une erreur de manip (« importe d'abord »).
    const sheets = [
      {
        sheet: 'Proposés',
        data: [
          ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
          ['Autumn Leaves', 'Denis (A)', '2026-08-28', '09:00', '10:00'],
        ],
      },
    ]
    const det = analyserSheetsExcel(sheets, 't.xlsx', 100, MAPPINGS, [])
    const proposesOnglet = det.onglets.find((o) => o.nom === 'Proposés')!
    expect(proposesOnglet.warnings.some((w) => w.includes('à créer ou à compléter'))).toBe(true)
    expect(proposesOnglet.warnings.some((w) => w.includes("importe d'abord"))).toBe(false)
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
      groupes: [{ id: 'gExist', titre: 'G', auteur: '', style: '', tonalite: '', responsable_id: '', membres: [], postes_cherches: [], repetitions_deja_faites: 0, echeance: 'apero_mercredi' }],
    })
    const det = detection([{ nom: 'Liste', destination: 'liste', statut: 'echec' }], new Map())
    const sel: SelectionExcel = { ongletsCoches: new Set(['Liste']), destinationsManuelles: new Map() }
    const cand = construireCandidatExcel(det, sel, actuel, 's')
    // Groupes actuels préservés — la sélection cochée n'a pas remplacé
    expect(cand.groupes.map((g) => g.id)).toEqual(['gExist'])
  })

  it('Liste (remplace) écrase les groupes existants', () => {
    const actuel = insc({
      groupes: [{ id: 'ancien', titre: 'Ancien', auteur: '', style: '', tonalite: '', responsable_id: '', membres: [], postes_cherches: [], repetitions_deja_faites: 0, echeance: 'apero_mercredi' }],
    })
    const det = detection(
      [{ nom: 'Liste', destination: 'liste', statut: 'ok' }],
      new Map([
        [
          'Liste',
          {
            destination: 'liste',
            groupes: [{ id: 'nouveau', titre: 'Nouveau', auteur: '', style: '', tonalite: '', responsable_id: '', membres: [], postes_cherches: [], repetitions_deja_faites: 0, echeance: 'apero_mercredi' }],
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
