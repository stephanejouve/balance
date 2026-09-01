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

import { analyserIdentitesImport, mentionsDepuisGroupes, mentionsDepuisStagiaires } from './alertes-import'
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
