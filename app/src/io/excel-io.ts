import readXlsxFile from 'read-excel-file/browser'
import type { ExtractionListe, MappingListe } from './liste-adapter'
import { extraireListe } from './liste-adapter'
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
  const rows = (await readXlsxFile(file, { sheet: onglet })) as unknown[][]
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
  const rows = (await readXlsxFile(file, { sheet: onglet })) as unknown[][]
  return extraireStagiaires(rows, mapping)
}
