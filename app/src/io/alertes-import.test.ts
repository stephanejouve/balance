/**
 * Tests end-to-end wiring Sujet C — charge `identites-ambigues.xlsx`
 * (fixture Stéphane 2026-09-01) et vérifie que `analyserIdentitesImport`
 * remonte exactement les 8 cas du corrigé A-H.
 *
 * Le corrigé `identites-ambigues-corrige.json` sert de contrat :
 *   alertes_homonymie: 1     (cas A — Pierre)
 *   signalements_doublon: 1  (cas D — Pierre + Pierre Lemoine sur Sables Mouvants)
 *   rapprochements_proposes: 2 (cas C — Pierre ↔ Pierre Lemoine cross-morceaux,
 *                               cas G — Solène J. ↔ Solene J.)
 *   aucune alerte : B (polyvalent), E (7 prénoms distincts), F (normalisation),
 *                   H (accents proches, initiales distinctes)
 */
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import readXlsxFile from 'read-excel-file/node'

import {
  analyserIdentitesCandidat,
  analyserIdentitesImport,
  mentionsDepuisCandidat,
  mentionsDepuisGroupes,
  mentionsDepuisStagiaires,
} from './alertes-import'
import { extraireListe, MAPPING_LISTE_DEFAUT } from './liste-adapter'
import { extraireStagiaires, MAPPING_STAGIAIRES_DEFAUT } from './stagiaires-adapter'

const FIXTURE_XLSX = join(__dirname, '..', '..', 'tests', 'fixtures', 'identites-ambigues.xlsx')
const CORRIGE_JSON = join(__dirname, '..', '..', 'tests', 'fixtures', 'identites-ambigues-corrige.json')

const skipIfMissing = existsSync(FIXTURE_XLSX) ? it : it.skip

interface CorrigeJson {
  attendus: Array<{ cas: string; personnes: string[]; detail: string; attendu: string }>
  resume: {
    alertes_homonymie: number
    signalements_doublon: number
    rapprochements_proposes: number
    aucune_alerte_attendue: string[]
  }
}

async function chargerFixture() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sheets = (await (readXlsxFile as any)(FIXTURE_XLSX)) as Array<{
    sheet: string
    data: unknown[][]
  }>
  const stagiairesData = sheets.find((s) => s.sheet === 'Stagiaires')!.data
  const listeData = sheets.find((s) => s.sheet === 'Liste')!.data
  const stagiaires = extraireStagiaires(stagiairesData, MAPPING_STAGIAIRES_DEFAUT)
  const liste = extraireListe(listeData, MAPPING_LISTE_DEFAUT)
  return { stagiaires, liste }
}

describe('analyserIdentitesImport — end-to-end contre fixture identites-ambigues.xlsx', () => {
  skipIfMissing('résumé conforme au corrigé (1 homonymie + 1 doublon + 2 rapprochements)', async () => {
    const corrige = JSON.parse(readFileSync(CORRIGE_JSON, 'utf-8')) as CorrigeJson
    const { stagiaires, liste } = await chargerFixture()
    const analyse = analyserIdentitesImport({
      groupes: liste.groupes,
      stagiaires: stagiaires.personnes,
    })

    // Le corrigé annonce précisément les nombres attendus
    const homonymies = analyse.alertes_identite.filter((a) => a.type === 'homonymie_probable')
    const doublons = analyse.alertes_identite.filter((a) => a.type === 'doublon_intra_groupe')
    const rapprochements = analyse.alertes_identite.filter((a) => a.type === 'rapprochement_propose')

    expect(homonymies).toHaveLength(corrige.resume.alertes_homonymie)
    expect(doublons).toHaveLength(corrige.resume.signalements_doublon)
    expect(rapprochements).toHaveLength(corrige.resume.rapprochements_proposes)
  })

  skipIfMissing('cas A — homonymie Pierre (batterie/guitare cross-morceaux)', async () => {
    const { stagiaires, liste } = await chargerFixture()
    const analyse = analyserIdentitesImport({ groupes: liste.groupes, stagiaires: stagiaires.personnes })
    const homonymies = analyse.alertes_identite.filter((a) => a.type === 'homonymie_probable')
    expect(homonymies).toHaveLength(1)
    if (homonymies[0].type !== 'homonymie_probable') throw new Error('type')
    expect(homonymies[0].nom).toBe('Pierre')
    expect(homonymies[0].instruments.sort()).toEqual(['batterie', 'guitare'])
  })

  skipIfMissing('cas D — doublon Pierre + Pierre Lemoine sur Sables Mouvants', async () => {
    const { stagiaires, liste } = await chargerFixture()
    const analyse = analyserIdentitesImport({ groupes: liste.groupes, stagiaires: stagiaires.personnes })
    const doublons = analyse.alertes_identite.filter((a) => a.type === 'doublon_intra_groupe')
    expect(doublons).toHaveLength(1)
    if (doublons[0].type !== 'doublon_intra_groupe') throw new Error('type')
    expect(doublons[0].groupe).toBe('Sables Mouvants')
  })

  skipIfMissing('cas C + G — 2 rapprochements proposés (Pierre↔Lemoine cross, Solène↔Solene accents)', async () => {
    const { stagiaires, liste } = await chargerFixture()
    const analyse = analyserIdentitesImport({ groupes: liste.groupes, stagiaires: stagiaires.personnes })
    const rapprochements = analyse.alertes_identite.filter((a) => a.type === 'rapprochement_propose')
    expect(rapprochements).toHaveLength(2)
    // Un préfixe (Pierre / Pierre Lemoine) + un accent (Solène J. / Solene J.)
    const paires = rapprochements.map((r) =>
      r.type === 'rapprochement_propose' ? [r.nom_court, r.nom_long].sort().join(' / ') : '',
    ).sort()
    expect(paires).toContain('Pierre / Pierre Lemoine')
    expect(paires.some((p) => p.includes('Solène') && p.includes('Solene'))).toBe(true)
  })

  skipIfMissing('cas B — Pierre-Yves L. polyvalent chant+guitare : AUCUNE alerte le concernant', async () => {
    const { stagiaires, liste } = await chargerFixture()
    const analyse = analyserIdentitesImport({ groupes: liste.groupes, stagiaires: stagiaires.personnes })
    const alertesPY = analyse.alertes_identite.filter((a) => {
      if (a.type === 'homonymie_probable') return a.nom.startsWith('Pierre-Yves')
      if (a.type === 'doublon_intra_groupe') return a.nom.startsWith('Pierre-Yves')
      if (a.type === 'rapprochement_propose')
        return a.nom_court.startsWith('Pierre-Yves') || a.nom_long.startsWith('Pierre-Yves')
      return false
    })
    expect(alertesPY).toEqual([])
  })

  skipIfMissing('cas E — 3 Camille + 2 Marie + 2 Jean- distingués : aucune alerte les concernant', async () => {
    const { stagiaires, liste } = await chargerFixture()
    const analyse = analyserIdentitesImport({ groupes: liste.groupes, stagiaires: stagiaires.personnes })
    const prenomsBruit = ['Camille', 'Marie', 'Jean-Louis', 'Jean-Michel']
    for (const p of prenomsBruit) {
      const alertes = analyse.alertes_identite.filter((a) => {
        if (a.type === 'homonymie_probable') return a.nom === p
        if (a.type === 'rapprochement_propose')
          return a.nom_court === p || a.nom_long === p
        return false
      })
      expect(alertes, `${p} ne devrait pas déclencher d'alerte`).toEqual([])
    }
  })

  skipIfMissing('cas F — normalisation « Sofia  T. » ↔ « sofia t. », « BRUNO V. » ↔ « Bruno V. » : aucune alerte', async () => {
    const { stagiaires, liste } = await chargerFixture()
    const analyse = analyserIdentitesImport({ groupes: liste.groupes, stagiaires: stagiaires.personnes })
    for (const prenom of ['Sofia', 'Bruno', 'BRUNO']) {
      const alertes = analyse.alertes_identite.filter((a) => {
        if (a.type === 'homonymie_probable') return a.nom.toLowerCase().startsWith(prenom.toLowerCase())
        if (a.type === 'rapprochement_propose')
          return (
            a.nom_court.toLowerCase().startsWith(prenom.toLowerCase()) ||
            a.nom_long.toLowerCase().startsWith(prenom.toLowerCase())
          )
        return false
      })
      expect(alertes, `${prenom} ne devrait pas déclencher d'alerte`).toEqual([])
    }
  })

  skipIfMissing('cas H — Renée B. / Renee C. : AUCUN rapprochement (initiales distinctes)', async () => {
    const { stagiaires, liste } = await chargerFixture()
    const analyse = analyserIdentitesImport({ groupes: liste.groupes, stagiaires: stagiaires.personnes })
    const rapprochementsRenee = analyse.alertes_identite.filter((a) => {
      if (a.type === 'rapprochement_propose')
        return (
          a.nom_court.startsWith('Renée') || a.nom_court.startsWith('Renee') ||
          a.nom_long.startsWith('Renée') || a.nom_long.startsWith('Renee')
        )
      return false
    })
    expect(rapprochementsRenee).toEqual([])
  })

  skipIfMissing('baseline personnes_relecture : nombre de personnes distinctes après normalisation', async () => {
    // Baseline demandée par Stéphane : mesurer combien de personnes sont
    // créées aujourd'hui, comme point de comparaison contre PR1.
    const { stagiaires, liste } = await chargerFixture()
    const analyse = analyserIdentitesImport({ groupes: liste.groupes, stagiaires: stagiaires.personnes })
    // Documentation vivante — le nombre exact dépend de la fixture et
    // de l'inclusion des mentions Stagiaires (avec `groupe_titre = ''`).
    // On vérifie juste que le pipeline retourne une liste non-vide et
    // que les cas normalisés (Sofia T. et BRUNO V.) sont bien regroupés
    // en 1 personne chacun.
    expect(analyse.personnes_relecture.length).toBeGreaterThan(15)
    const noms = analyse.personnes_relecture.map((p) => p.nom_affichage.toLowerCase().trim())
    // Sofia : une seule entrée (peu importe la casse d'affichage)
    const sofias = noms.filter((n) => n.replace(/\s+/g, ' ').startsWith('sofia'))
    expect(sofias, `attendu 1 Sofia regroupée, vu ${sofias}`).toHaveLength(1)
    // Bruno : idem
    const brunos = noms.filter((n) => n.replace(/\s+/g, ' ').startsWith('bruno'))
    expect(brunos, `attendu 1 Bruno regroupé, vu ${brunos}`).toHaveLength(1)
  })
})

describe('mesure jeu de stress (livraison Stéphane 2026-09-01)', () => {
  const STRESS_XLSX = join(__dirname, '..', '..', 'tests', 'fixtures', 'balance-stress-test.xlsx')
  const skipIfStressMissing = existsSync(STRESS_XLSX) ? it : it.skip

  skipIfStressMissing('mesure volume écran relecture — attendu 84 stagiaires + 20 morceaux', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sheets = (await (readXlsxFile as any)(STRESS_XLSX)) as Array<{ sheet: string; data: unknown[][] }>
    const st = extraireStagiaires(sheets.find((s) => s.sheet === 'Stagiaires')!.data, MAPPING_STAGIAIRES_DEFAUT)
    const li = extraireListe(sheets.find((s) => s.sheet === 'Liste')!.data, MAPPING_LISTE_DEFAUT)
    const analyse = analyserIdentitesImport({ groupes: li.groupes, stagiaires: st.personnes })
    // eslint-disable-next-line no-console
    console.log(`
=== VOLUME JEU DE STRESS (mesure PR3 écran de relecture) ===
Stagiaires extraits    : ${st.personnes.length}
Morceaux extraits      : ${li.groupes.length}
Personnes relecture    : ${analyse.personnes_relecture.length}
Alertes total          : ${analyse.alertes_identite.length}
  homonymies           : ${analyse.alertes_identite.filter((a) => a.type === 'homonymie_probable').length}
  doublons             : ${analyse.alertes_identite.filter((a) => a.type === 'doublon_intra_groupe').length}
  rapprochements       : ${analyse.alertes_identite.filter((a) => a.type === 'rapprochement_propose').length}
===========================================================
`)
    // Ordres de grandeur attendus (Stéphane) : 84 stagiaires, 20 morceaux
    expect(st.personnes.length).toBeGreaterThanOrEqual(80)
    expect(li.groupes.length).toBeGreaterThanOrEqual(15)
  })
})

describe('mentionsDepuisGroupes / mentionsDepuisStagiaires — helpers unitaires', () => {
  it('mentionsDepuisGroupes parse « Pierre (L) (batterie) » correctement', () => {
    const groupes = [
      { nom: 'Test', m1: 'Test', m2: '', style: '', ton: '', resp: '',
        membres: ['Pierre (L) (batterie)', 'Emma (chant)'], cherche: '' },
    ]
    const mentions = mentionsDepuisGroupes(groupes)
    expect(mentions).toEqual([
      { nom: 'Pierre', discriminant: '(L)', pupitre: 'batterie', groupe_titre: 'Test' },
      { nom: 'Emma', discriminant: '', pupitre: 'chant', groupe_titre: 'Test' },
    ])
  })

  it('mentionsDepuisStagiaires marque groupe_titre = "" pour distinguer', () => {
    const personnes = [
      { id: 'p1', nom: 'Pierre Lemoine', discriminant: '', role: 'musicien' as const,
        instruments: [{ pupitre: 'guitare', lourd: false }], indispos: [] },
    ]
    const mentions = mentionsDepuisStagiaires(personnes)
    expect(mentions).toEqual([
      { nom: 'Pierre Lemoine', discriminant: '', pupitre: 'guitare', groupe_titre: '' },
    ])
  })

  it('stagiaire sans instrument déclaré → 1 mention avec pupitre vide', () => {
    const personnes = [
      { id: 'p1', nom: 'Ghost', discriminant: '', role: 'musicien' as const,
        instruments: [], indispos: [] },
    ]
    const mentions = mentionsDepuisStagiaires(personnes)
    expect(mentions).toHaveLength(1)
    expect(mentions[0].pupitre).toBe('')
  })
})

describe('mentionsDepuisCandidat / analyserIdentitesCandidat — wire post-construireCandidatExcel', () => {
  const inscriptions = {
    session_id: 's',
    personnes: [
      { id: 'p1', nom: 'Pierre', discriminant: '', role: 'musicien' as const,
        instruments: [{ pupitre: 'batterie', lourd: false }], indispos: [] },
      { id: 'p2', nom: 'Pierre Lemoine', discriminant: '', role: 'musicien' as const,
        instruments: [{ pupitre: 'guitare', lourd: false }], indispos: [] },
      { id: 'p3', nom: 'Ghost', discriminant: '', role: 'musicien' as const,
        instruments: [{ pupitre: 'chant', lourd: false }], indispos: [] },
    ],
    groupes: [
      { id: 'g1', titre: 'Sables Mouvants', auteur: '', style: '', tonalite: '',
        responsable_id: '', postes_cherches: [], repetitions_deja_faites: 0,
        membres: [
          { personne_id: 'p1', pupitre: 'batterie' },
          { personne_id: 'p2', pupitre: 'guitare' },
        ] },
    ],
    imposes: [],
  }

  it('mentionsDepuisCandidat produit 1 mention par instrument stagiaire + 1 par MembreGroupe', () => {
    const mentions = mentionsDepuisCandidat(inscriptions)
    // 3 stagiaires (chacun 1 instrument) + 2 MembreGroupe = 5 mentions
    expect(mentions).toHaveLength(5)
    // Ghost apparaît uniquement en stagiaire
    const ghostMentions = mentions.filter((m) => m.nom === 'Ghost')
    expect(ghostMentions).toHaveLength(1)
    expect(ghostMentions[0].groupe_titre).toBe('')
  })

  it('analyserIdentitesCandidat détecte doublon Pierre + Pierre Lemoine (cas D)', () => {
    const analyse = analyserIdentitesCandidat(inscriptions)
    const doublons = analyse.alertes_identite.filter((a) => a.type === 'doublon_intra_groupe')
    expect(doublons).toHaveLength(1)
    // Ghost apparaît dans la relecture avec sans_engagement=true
    const ghost = analyse.personnes_relecture.find((p) => p.nom_affichage === 'Ghost')
    expect(ghost).toBeDefined()
    expect(ghost!.sans_engagement).toBe(true)
    expect(ghost!.nb_engagements).toBe(0)
  })

  it('analyserIdentitesCandidat produit aussi des alertes de cohérence (I-P)', () => {
    // Ghost est déclaré (p3) mais jamais cité → cas I stagiaire_orphelin
    const analyse = analyserIdentitesCandidat(inscriptions)
    const orphelins = analyse.alertes_coherence.filter((a) => a.type === 'stagiaire_orphelin')
    expect(orphelins).toHaveLength(1)
    expect(orphelins[0]).toMatchObject({ type: 'stagiaire_orphelin', personne: 'Ghost' })
  })

  it('cas N (nom_cite_absent_stagiaires) activé via stagiaires_ids dérivé de candidat.personnes', () => {
    // p1 déclaré + cité, p2 cité mais absent de personnes → cas N
    const inscriptionsCasN = {
      session_id: 's',
      personnes: [
        { id: 'p1', nom: 'Alice', discriminant: '', role: 'musicien' as const,
          instruments: [{ pupitre: 'chant' as const, lourd: false }], indispos: [] },
      ],
      groupes: [
        { id: 'g1', titre: 'M', auteur: '', style: '', tonalite: '',
          responsable_id: '', postes_cherches: [], repetitions_deja_faites: 0,
          membres: [
            { personne_id: 'p1', pupitre: 'chant' as const },
            { personne_id: 'p2', pupitre: 'batterie' as const },
          ] },
      ],
      imposes: [],
    }
    const analyse = analyserIdentitesCandidat(inscriptionsCasN)
    const absents = analyse.alertes_coherence.filter((a) => a.type === 'nom_cite_absent_stagiaires')
    expect(absents).toHaveLength(1)
    expect(absents[0]).toMatchObject({ personne: 'p2', pupitre: 'batterie', morceau: 'M' })
  })

  it('personne_id inconnu dans MembreGroupe → ignoré silencieusement', () => {
    const inscriptionsOrphelin = {
      session_id: 's',
      personnes: [
        { id: 'p1', nom: 'Alpha', discriminant: '', role: 'musicien' as const,
          instruments: [{ pupitre: 'chant', lourd: false }], indispos: [] },
      ],
      groupes: [
        { id: 'g1', titre: 'X', auteur: '', style: '', tonalite: '',
          responsable_id: '', postes_cherches: [], repetitions_deja_faites: 0,
          membres: [
            { personne_id: 'p1', pupitre: 'chant' },
            { personne_id: 'inexistant', pupitre: 'batterie' },
          ] },
      ],
      imposes: [],
    }
    const mentions = mentionsDepuisCandidat(inscriptionsOrphelin)
    // 1 stagiaire + 1 membre valide (l'inexistant est skippé)
    expect(mentions).toHaveLength(2)
  })
})
