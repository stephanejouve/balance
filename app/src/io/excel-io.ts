import { readSheet } from 'read-excel-file/browser'
import type { Personne } from '../domain/model'
import type { ExtractionListe, MappingListe } from './liste-adapter'
import { extraireListe } from './liste-adapter'
import type { ExtractionProposes, MappingProposes } from './proposes-adapter'
import { extraireProposes } from './proposes-adapter'
import type { ExtractionStagiaires, MappingStagiaires } from './stagiaires-adapter'
import { extraireStagiaires } from './stagiaires-adapter'

/**
 * Wrapper navigateur autour de `read-excel-file` : lit le classeur
 * fourni (Blob/File), extrait l'onglet demandé, puis délègue à
 * `extraireListe()` pour la conversion → `LegacyGroupe[]`.
 *
 * L'application charge le classeur via `<input type="file">` ; le
 * fichier reste local, aucune donnée ne part côté serveur (contrainte
 * §8 : offline, sans réseau).
 */
export async function importerListeExcel(
  file: Blob | File,
  onglet: string,
  mapping: MappingListe,
): Promise<ExtractionListe> {
  const rows = (await readSheet(file, onglet)) as unknown[][]
  return extraireListe(rows, mapping)
}

/**
 * Import de l'onglet `Stagiaires` (référentiel complet des inscrits du
 * stage). Chaque ligne devient une `Personne` sans engagement dans un
 * groupe — utilisable comme réservoir de renforts.
 */
export async function importerStagiairesExcel(
  file: Blob | File,
  onglet: string,
  mapping: MappingStagiaires,
): Promise<ExtractionStagiaires> {
  const rows = (await readSheet(file, onglet)) as unknown[][]
  return extraireStagiaires(rows, mapping)
}

/**
 * Import de l'onglet `Proposés` (morceaux du concert du vendredi
 * proposés par l'intervenant). Chaque ligne = une séance ; les lignes
 * de même titre sont fusionnées en un `Impose` avec plusieurs séances.
 * Les membres sont résolus contre `personnesConnues` — importer d'abord
 * l'onglet `Liste` ou `Stagiaires` pour peupler le référentiel.
 */
export async function importerProposesExcel(
  file: Blob | File,
  onglet: string,
  mapping: MappingProposes,
  personnesConnues: readonly Personne[],
): Promise<ExtractionProposes> {
  const rows = (await readSheet(file, onglet)) as unknown[][]
  return extraireProposes(rows, mapping, personnesConnues)
}
