/**
 * Issue #164 (smoke CD 2026-10-22) : un fichier portant le SEUL onglet
 * Liste — le relevé d'intentions d'un organisateur d'apéro-concert.
 *
 * 1. Verrous AVANT toute évolution de la résolution des citations (demande
 *    CD) : noms de famille (composés, particules), parenthèse d'instrument
 *    qui ne dédouble pas, multi-pupitre.
 * 2. L'absence d'onglet Stagiaires est dite à l'extraction, et le
 *    signalement de relecture ne suppose plus un onglet inexistant.
 */
import { describe, expect, it } from 'vitest'
import { Inscriptions, Personne } from '../domain/model'
import { analyserSheetsExcel, construireCandidatExcel } from './import-detection'
import { MAPPING_LISTE_DEFAUT } from './liste-adapter'
import { MAPPING_PROPOSES_DEFAUT } from './proposes-adapter'
import { MAPPING_STAGIAIRES_DEFAUT } from './stagiaires-adapter'

const ENTETE = ['Morceau', 'Auteur', 'Style', 'Tona', 'Resp', 'Chant', 'Piano', 'Basse', 'Batterie', 'Guitare', 'Vents', 'Cherche']
const LISTE = {
  sheet: 'Liste',
  data: [
    ENTETE,
    ['Blue Bossa', '', '', '', 'Jean-Pierre Delaunay', 'Sophie Mercier-Lacroix', 'Jean-Pierre Delaunay', 'Yann Le Goff', '', '', 'Olivier Rouanet (saxophone)', ''],
    ['Johnny B. Goode', '', '', '', 'Marc Di Stefano', 'Marc Di Stefano', '', '', 'Agnès Vidal-Perrin', 'Marc Di Stefano', 'Olivier Rouanet', 'Basse'],
  ],
}
const MAPPINGS = { liste: MAPPING_LISTE_DEFAUT, stagiaires: MAPPING_STAGIAIRES_DEFAUT, proposes: MAPPING_PROPOSES_DEFAUT }

function importer(sheets: Array<{ sheet: string; data: unknown[][] }>, connues: Personne[] = []) {
  const detection = analyserSheetsExcel(sheets, 'releve.xlsx', 1, MAPPINGS, connues)
  const coches = new Set(detection.onglets.filter((o) => o.destination !== null && o.statut === 'ok').map((o) => o.nom))
  const candidat = construireCandidatExcel(
    detection,
    { ongletsCoches: coches, destinationsManuelles: new Map() },
    Inscriptions.parse({ session_id: 's', personnes: connues, groupes: [] }),
    's',
  )
  return { detection, candidat }
}

describe('Liste seule — verrous de résolution des citations (#164)', () => {
  const { candidat } = importer([LISTE])
  const ids = new Set(candidat.groupes.flatMap((g) => g.membres.map((m) => m.personne_id)))

  it('noms de famille : composés et particules donnent le bon identifiant', () => {
    for (const id of ['jean-pierre-delaunay', 'sophie-mercier-lacroix', 'marc-di-stefano', 'yann-le-goff', 'agnes-vidal-perrin']) {
      expect(ids).toContain(id)
    }
  })

  it('la parenthèse d\'instrument ne dédouble pas : un seul olivier-rouanet, précision portée au poste', () => {
    expect([...ids].filter((id) => id.startsWith('olivier'))).toEqual(['olivier-rouanet'])
    const blue = candidat.groupes.find((g) => g.titre === 'Blue Bossa')!
    expect(blue.membres).toContainEqual({ personne_id: 'olivier-rouanet', pupitre: 'vents', precision: 'saxophone' })
    expect(ids.size).toBe(6)
  })

  it('multi-pupitre : marc-di-stefano compté en chant ET en guitare sur Johnny B. Goode', () => {
    const johnny = candidat.groupes.find((g) => g.titre === 'Johnny B. Goode')!
    const pupitres = johnny.membres.filter((m) => m.personne_id === 'marc-di-stefano').map((m) => m.pupitre)
    expect(pupitres.sort()).toEqual(['chant', 'guitare'])
  })
})
