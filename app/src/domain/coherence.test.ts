/**
 * Tests Sujet C étendu — cohérence entre onglets (cas I à P du corrigé
 * Stéphane 2026-09-01, jeu `coherence-onglets.xlsx`).
 *
 * Tests unitaires par cas + test end-to-end contre la fixture xlsx +
 * corrige JSON (contrat versionné).
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import {
  detecterAlertesCoherence,
  grouperAlertesCoherence,
  type AlerteCoherence,
} from './coherence'
import type { Inscriptions } from './model'
import { extraireListe, MAPPING_LISTE_DEFAUT } from '../io/liste-adapter'
import { extraireProposes, MAPPING_PROPOSES_DEFAUT } from '../io/proposes-adapter'
import { extraireStagiaires, MAPPING_STAGIAIRES_DEFAUT } from '../io/stagiaires-adapter'
import { migrerInscriptions } from './migrate'

// ─── helpers ──────────────────────────────────────────────────────────

function inscriptionsVides(): Inscriptions {
  return { session_id: 's', personnes: [], groupes: [], imposes: [] }
}

// ─── J — pupitre contredit ────────────────────────────────────────────

describe('cas J — pupitre contredit (alerte)', () => {
  it('personne déclarée Piano, citée Batterie seule sur un morceau → alerte', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'clara', nom: 'Clara V.', discriminant: '', role: 'musicien',
          instruments: [{ pupitre: 'piano', lourd: false }], indispos: [] },
      ],
      groupes: [
        { id: 'g1', titre: 'Ligne de Fuite', auteur: '', style: '', tonalite: '',
          responsable_id: '', membres: [{ personne_id: 'clara', pupitre: 'batterie' }],
          postes_cherches: [], repetitions_deja_faites: 0 },
      ],
    }
    const alertes = detecterAlertesCoherence(insc)
    const j = alertes.filter((a) => a.type === 'pupitre_contredit')
    expect(j).toHaveLength(1)
    if (j[0].type !== 'pupitre_contredit') throw new Error('type')
    expect(j[0].personne).toBe('Clara V.')
    expect(j[0].pupitres_declares).toEqual(['piano'])
    expect(j[0].pupitre_cite).toBe('batterie')
    expect(j[0].morceau).toBe('Ligne de Fuite')
  })
})

// ─── K — pupitre additionnel légitime ─────────────────────────────────

describe('cas K — pupitre additionnel légitime (aucune alerte)', () => {
  it('Estelle Y. déclarée Chant + Piano, citée Piano → aucune alerte', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'estelle', nom: 'Estelle Y.', discriminant: '', role: 'musicien',
          instruments: [
            { pupitre: 'chant', lourd: false },
            { pupitre: 'piano', lourd: false },
          ],
          indispos: [] },
      ],
      groupes: [
        { id: 'g1', titre: 'Petit Matin', auteur: '', style: '', tonalite: '',
          responsable_id: '', membres: [{ personne_id: 'estelle', pupitre: 'piano' }],
          postes_cherches: [], repetitions_deja_faites: 0 },
      ],
    }
    expect(detecterAlertesCoherence(insc)).toEqual([])
  })
})

// ─── O — polyvalence avec pupitre non déclaré (signalement) ───────────

describe('cas O — polyvalence + pupitre non déclaré (signalement)', () => {
  it('Iris C. déclarée Guitare, citée Chant + Guitare sur Tramontane → signalement chant non déclaré', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'iris', nom: 'Iris C.', discriminant: '', role: 'musicien',
          instruments: [{ pupitre: 'guitare', lourd: false }], indispos: [] },
      ],
      groupes: [
        { id: 'g1', titre: 'Tramontane', auteur: '', style: '', tonalite: '',
          responsable_id: '', membres: [
            { personne_id: 'iris', pupitre: 'chant' },
            { personne_id: 'iris', pupitre: 'guitare' },
          ],
          postes_cherches: [], repetitions_deja_faites: 0 },
      ],
    }
    const alertes = detecterAlertesCoherence(insc)
    const o = alertes.filter((a) => a.type === 'pupitre_non_declare_polyvalent')
    expect(o).toHaveLength(1)
    if (o[0].type !== 'pupitre_non_declare_polyvalent') throw new Error('type')
    expect(o[0].personne).toBe('Iris C.')
    expect(o[0].pupitre_non_declare).toBe('chant')
    expect([...o[0].pupitres_cites].sort()).toEqual(['chant', 'guitare'])
    // Pas d'alerte J : la polyvalence sur le morceau prouve le rôle
    expect(alertes.filter((a) => a.type === 'pupitre_contredit')).toEqual([])
  })
})

// ─── M — indispo percutée (alerte contradiction insoluble) ────────────

describe('cas M — indisponibilité percutée par séance Proposés (alerte prioritaire)', () => {
  it('Gaëlle A. indispo lundi 14:30-16:00 + séance Petit Matin 2026-10-26 (lundi) 14:30-16:00 → alerte', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'gaelle', nom: 'Gaëlle A.', discriminant: '', role: 'musicien',
          instruments: [{ pupitre: 'basse', lourd: false }],
          indispos: [{ jours: ['lundi'], debut: '14:30', fin: '16:00', roles: [], motif: 'lundi 14:30 - 16:00' }] },
      ],
      groupes: [],
      imposes: [
        { id: 'imp1', morceau: 'Petit Matin', membres: ['gaelle'],
          seances: [{ date: '2026-10-26', debut: '14:30', fin: '16:00', salle_id: 'la-grange' }] },
      ],
    }
    const alertes = detecterAlertesCoherence(insc)
    const m = alertes.filter((a) => a.type === 'indispo_percutee')
    expect(m).toHaveLength(1)
    if (m[0].type !== 'indispo_percutee') throw new Error('type')
    expect(m[0].personne).toBe('Gaëlle A.')
    expect(m[0].morceau).toBe('Petit Matin')
    expect(m[0].date).toBe('2026-10-26')
    expect(m[0].debut).toBe('14:30')
  })

  it('date ISO explicite dans indispo.jours matche aussi', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'p', nom: 'X', discriminant: '', role: 'musicien', instruments: [],
          indispos: [{ jours: ['2026-10-26'], debut: '14:30', fin: '16:00', roles: [], motif: '' }] },
      ],
      groupes: [],
      imposes: [
        { id: 'i', morceau: 'M', membres: ['p'],
          seances: [{ date: '2026-10-26', debut: '15:00', fin: '17:00' }] },
      ],
    }
    expect(detecterAlertesCoherence(insc).filter((a) => a.type === 'indispo_percutee')).toHaveLength(1)
  })

  it('créneau non-chevauchant → aucune alerte', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'p', nom: 'X', discriminant: '', role: 'musicien', instruments: [],
          indispos: [{ jours: ['lundi'], debut: '14:30', fin: '16:00', roles: [], motif: '' }] },
      ],
      groupes: [],
      imposes: [
        { id: 'i', morceau: 'M', membres: ['p'],
          seances: [{ date: '2026-10-26', debut: '16:00', fin: '17:30' }] },  // débute quand indispo finit
      ],
    }
    expect(detecterAlertesCoherence(insc).filter((a) => a.type === 'indispo_percutee')).toEqual([])
  })

  it('journée entière (pas de debut/fin dans indispo) → alerte', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'p', nom: 'X', discriminant: '', role: 'musicien', instruments: [],
          indispos: [{ jours: ['lundi'], roles: [], motif: 'toute la journée' }] },
      ],
      groupes: [],
      imposes: [
        { id: 'i', morceau: 'M', membres: ['p'],
          seances: [{ date: '2026-10-26', debut: '09:00', fin: '10:00' }] },
      ],
    }
    expect(detecterAlertesCoherence(insc).filter((a) => a.type === 'indispo_percutee')).toHaveLength(1)
  })
})

// ─── I — resp non cité + stagiaire orphelin ───────────────────────────

describe('cas I — responsable non cité (signalement) + stagiaire orphelin', () => {
  it('resp d\'un morceau, pas dans ses membres → signalement', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'amandine', nom: 'Amandine R.', discriminant: '', role: 'musicien', instruments: [], indispos: [] },
      ],
      groupes: [
        { id: 'g', titre: 'Encore Sans Titre', auteur: '', style: '', tonalite: '',
          responsable_id: 'amandine', membres: [], postes_cherches: [], repetitions_deja_faites: 0 },
      ],
    }
    const alertes = detecterAlertesCoherence(insc)
    const r = alertes.filter((a) => a.type === 'responsable_non_cite')
    expect(r).toHaveLength(1)
    if (r[0].type !== 'responsable_non_cite') throw new Error('type')
    expect(r[0].personne).toBe('Amandine R.')
    expect(r[0].morceau).toBe('Encore Sans Titre')
  })

  it('stagiaire cité dans aucun morceau → signalement orphelin', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'boris', nom: 'Boris T.', discriminant: '', role: 'musicien',
          instruments: [{ pupitre: 'vents', lourd: false, precision: 'Trombone' }], indispos: [] },
      ],
    }
    const alertes = detecterAlertesCoherence(insc)
    expect(alertes.filter((a) => a.type === 'stagiaire_orphelin')).toHaveLength(1)
  })
})

// ─── L — latéralité sur non-batteur ───────────────────────────────────

describe('cas L — latéralité sur non-batteur (signalement)', () => {
  it('Fabien Z. guitare + gaucher → signalement', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'fabien', nom: 'Fabien Z.', discriminant: '', role: 'musicien',
          instruments: [{ pupitre: 'guitare', lourd: false, lateralite: 'gaucher' }],
          indispos: [] },
      ],
    }
    const alertes = detecterAlertesCoherence(insc)
    const l = alertes.filter((a) => a.type === 'lateralite_non_batteur')
    expect(l).toHaveLength(1)
    if (l[0].type !== 'lateralite_non_batteur') throw new Error('type')
    expect(l[0].personne).toBe('Fabien Z.')
    expect(l[0].instruments).toEqual(['guitare'])
  })

  it('batteur avec latéralité → aucune alerte (usage légitime)', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      personnes: [
        { id: 'hugo', nom: 'Hugo B.', discriminant: '', role: 'musicien',
          instruments: [{ pupitre: 'batterie', lourd: false, lateralite: 'droitier' }],
          indispos: [] },
      ],
    }
    expect(detecterAlertesCoherence(insc).filter((a) => a.type === 'lateralite_non_batteur')).toEqual([])
  })
})

// ─── N — nom cité, absent Stagiaires ──────────────────────────────────

describe('cas N — nom cité dans un morceau, absent de Stagiaires (signalement)', () => {
  it('Olivier X. cité Guitare sur Sous le Tilleul, absent → signalement', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      groupes: [
        { id: 'g', titre: 'Sous le Tilleul', auteur: '', style: '', tonalite: '',
          responsable_id: '', membres: [{ personne_id: 'olivier-x', pupitre: 'guitare' }],
          postes_cherches: [], repetitions_deja_faites: 0 },
      ],
    }
    // stagiaires_ids vide → Olivier n'est pas dans les officiels → signalement
    const alertes = detecterAlertesCoherence(insc, { stagiaires_ids: new Set() })
    const n = alertes.filter((a) => a.type === 'nom_cite_absent_stagiaires')
    expect(n).toHaveLength(1)
    if (n[0].type !== 'nom_cite_absent_stagiaires') throw new Error('type')
    expect(n[0].morceau).toBe('Sous le Tilleul')
    expect(n[0].pupitre).toBe('guitare')
  })

  it('sans `stagiaires_ids`, cas N est désactivé', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      groupes: [
        { id: 'g', titre: 'M', auteur: '', style: '', tonalite: '',
          responsable_id: '', membres: [{ personne_id: 'inconnu', pupitre: 'chant' }],
          postes_cherches: [], repetitions_deja_faites: 0 },
      ],
    }
    expect(detecterAlertesCoherence(insc).filter((a) => a.type === 'nom_cite_absent_stagiaires')).toEqual([])
  })
})

// ─── P — morceau sans membre ──────────────────────────────────────────

describe('cas P — morceau sans aucun membre (signalement)', () => {
  it('membres vides + postes_cherches vides → signalement', () => {
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      groupes: [
        { id: 'g', titre: 'Encore Sans Titre', auteur: '', style: '', tonalite: '',
          responsable_id: '', membres: [], postes_cherches: [], repetitions_deja_faites: 0 },
      ],
    }
    const alertes = detecterAlertesCoherence(insc)
    expect(alertes.filter((a) => a.type === 'morceau_vide')).toHaveLength(1)
  })

  it('membres vides même avec CHERCHE → signalement (cas Encore Sans Titre)', () => {
    // Corrigé Stéphane : signaler même si postes_cherches présent —
    // « groupe déclaré mais vide », le solveur ne peut rien en faire
    // avec des souhaits (CHERCHE ≠ membre).
    const insc: Inscriptions = {
      ...inscriptionsVides(),
      groupes: [
        { id: 'g', titre: 'Encore Sans Titre', auteur: '', style: '', tonalite: '',
          responsable_id: '', membres: [],
          postes_cherches: ['chant', 'piano'], repetitions_deja_faites: 0 },
      ],
    }
    expect(detecterAlertesCoherence(insc).filter((a) => a.type === 'morceau_vide')).toHaveLength(1)
  })
})

// ─── grouperAlertesCoherence — hiérarchie visuelle ────────────────────

describe('grouperAlertesCoherence — alertes rouges vs signalements orange', () => {
  it('J + M en alertes ; I/L/N/O/P en signalements', () => {
    const toutes: AlerteCoherence[] = [
      { type: 'pupitre_contredit', personne: 'X', pupitres_declares: [], pupitre_cite: 'x', morceau: 'M' },
      { type: 'indispo_percutee', personne: 'X', morceau: 'M', date: '2026-10-26', debut: '00:00', fin: '00:00', motif_indispo: '' },
      { type: 'responsable_non_cite', personne: 'X', morceau: 'M' },
      { type: 'stagiaire_orphelin', personne: 'X' },
      { type: 'lateralite_non_batteur', personne: 'X', instruments: [] },
      { type: 'nom_cite_absent_stagiaires', personne: 'X', morceau: 'M', pupitre: 'x' },
      { type: 'pupitre_non_declare_polyvalent', personne: 'X', pupitre_non_declare: 'x', pupitres_cites: [], pupitres_declares: [], morceau: 'M' },
      { type: 'morceau_vide', morceau: 'M' },
    ]
    const g = grouperAlertesCoherence(toutes)
    expect(g.alertes.map((a) => a.type)).toEqual(['pupitre_contredit', 'indispo_percutee'])
    expect(g.signalements.map((a) => a.type)).toEqual([
      'responsable_non_cite', 'stagiaire_orphelin', 'lateralite_non_batteur',
      'nom_cite_absent_stagiaires', 'pupitre_non_declare_polyvalent', 'morceau_vide',
    ])
  })
})

// ─── End-to-end contre fixture coherence-onglets.xlsx ─────────────────

const FIX_XLSX = join(__dirname, '..', '..', 'tests', 'fixtures', 'coherence-onglets.xlsx')
const FIX_CORRIGE = join(__dirname, '..', '..', 'tests', 'fixtures', 'coherence-onglets-corrige.json')

/**
 * Format du corrigé Stéphane 2026-09-01 (v2, occurrences).
 *
 * Le v1 comptait des catégories (« J (2 personnes) »), le v2 compte des
 * occurrences (une entrée par personne concernée) — voir `note_comptage`
 * dans le JSON. C'est cette forme qui est le contrat testé.
 */
interface Corrige {
  resume: {
    alertes: { total: number; detail: readonly string[] }
    signalements: { total: number; detail: readonly string[] }
    aucune_alerte: readonly string[]
  }
  note_comptage: string
}

const skipMissing = existsSync(FIX_XLSX) ? it : it.skip

describe('cas I à P end-to-end contre coherence-onglets.xlsx', () => {
  skipMissing('détecte les 8 cas conformément au corrigé JSON de Stéphane', async () => {
    const corrige = JSON.parse(readFileSync(FIX_CORRIGE, 'utf-8')) as Corrige
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sheets = (await (readXlsxFile as any)(FIX_XLSX)) as Array<{ sheet: string; data: unknown[][] }>
    const stagiairesData = sheets.find((s) => s.sheet === 'Stagiaires')!.data
    const listeData = sheets.find((s) => s.sheet === 'Liste')!.data
    const proposesData = sheets.find((s) => s.sheet === 'Proposés')?.data ?? []
    const st = extraireStagiaires(stagiairesData, MAPPING_STAGIAIRES_DEFAUT)
    const li = extraireListe(listeData, MAPPING_LISTE_DEFAUT)
    const legacy = {
      groupes: li.groupes,
      membresImposes: {},
      indispos: [],
      identitesConnues: [],
    }
    const inscsBase = migrerInscriptions(legacy, 's-coherence')
    // Injecter stagiaires (l'adapter stagiaires les crée déjà avec ids)
    const inscs: Inscriptions = {
      ...inscsBase,
      personnes: [...st.personnes, ...inscsBase.personnes.filter((p) => !st.personnes.some((s) => s.id === p.id))],
    }
    // Import Proposés (imposes) — nécessite personnesConnues pour résoudre
    const pr = extraireProposes(proposesData, MAPPING_PROPOSES_DEFAUT, inscs.personnes)
    inscs.imposes = pr.imposes

    const stagiairesIds = new Set(st.personnes.map((p) => p.id))
    const alertes = detecterAlertesCoherence(inscs, { stagiaires_ids: stagiairesIds })
    const g = grouperAlertesCoherence(alertes)

    // eslint-disable-next-line no-console
    console.log(`\ncoherence-onglets: ${g.alertes.length} alertes / ${g.signalements.length} signalements\n  alertes: ${g.alertes.map((a) => a.type).join(', ')}\n  signalements: ${g.signalements.map((a) => a.type).join(', ')}`)

    // Attendus corrigé Stéphane :
    // - J (2 personnes = Clara V., Damien W.) → 2 alertes pupitre_contredit
    // - M (Gaëlle A.) → 1 alerte indispo_percutee
    // Total alertes attendues : 3 (2 J + 1 M)
    expect(g.alertes.filter((a) => a.type === 'pupitre_contredit')).toHaveLength(2)
    expect(g.alertes.filter((a) => a.type === 'indispo_percutee')).toHaveLength(1)
    // Signalements : au moins I (2 personnes : resp Amandine + orphelin Boris),
    // L (Fabien), N (Olivier), O (Iris), P (Encore Sans Titre)
    expect(g.signalements.filter((a) => a.type === 'responsable_non_cite').length).toBeGreaterThanOrEqual(1)
    expect(g.signalements.filter((a) => a.type === 'stagiaire_orphelin').length).toBeGreaterThanOrEqual(1)
    expect(g.signalements.filter((a) => a.type === 'lateralite_non_batteur')).toHaveLength(1)
    expect(g.signalements.filter((a) => a.type === 'nom_cite_absent_stagiaires')).toHaveLength(1)
    expect(g.signalements.filter((a) => a.type === 'pupitre_non_declare_polyvalent').length).toBeGreaterThanOrEqual(1)
    expect(g.signalements.filter((a) => a.type === 'morceau_vide')).toHaveLength(1)
    // K (Estelle Y.) ne doit générer aucune alerte
    const estelleAlertes = alertes.filter((a) => 'personne' in a && a.personne === 'Estelle Y.')
    expect(estelleAlertes).toEqual([])

    // Contrat externe (compte-occurrences du corrigé v2 Stéphane 2026-09-01)
    // — chaque personne concernée compte pour 1, pas chaque type.
    expect(corrige.resume.alertes.total).toBe(g.alertes.length)
    expect(corrige.resume.alertes.total).toBe(3)
    expect(corrige.resume.signalements.total).toBe(g.signalements.length)
    expect(corrige.resume.signalements.total).toBe(8)
  })
})
