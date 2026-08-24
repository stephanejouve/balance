import readXlsxFile from 'read-excel-file/browser'
import type { ExtractionListe, MappingListe } from './liste-adapter'
import { extraireListe } from './liste-adapter'

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
