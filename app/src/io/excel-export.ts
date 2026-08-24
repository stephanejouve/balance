import writeXlsxFile from 'write-excel-file/browser'
import type { Creneau } from '../domain/grille'
import type { Inscriptions, Lieu, Session } from '../domain/model'
import type { Assignation } from '../engine/types'
import { tableauParGroupe, tableauParMusicien, tableauParSalle } from './csv'

/**
 * Restitution `.xlsx` — 3 onglets miroirs des 3 vues (§0/§5) :
 *  - « Par groupe »   : feuille de route par morceau
 *  - « Résa salles »  : occupation chronologique salle par salle (nom
 *                       repris de l'onglet historique du classeur)
 *  - « Par musicien » : agenda personnel chronologique
 *
 * Le fichier reste local (write-excel-file/browser génère un Blob que
 * l'utilisateur télécharge). Offline garanti (brief §8).
 */

function toSheetData(rows: unknown[][]): Array<Array<{ value: string | number | null; fontWeight?: 'bold' }>> {
  return rows.map((r, i) =>
    r.map((c) => {
      const value: string | number | null = c == null ? null : typeof c === 'number' ? c : String(c)
      return i === 0 ? { value, fontWeight: 'bold' as const } : { value }
    }),
  )
}

export async function exporterClasseurExcel(
  nomFichier: string,
  session: Session,
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  assignations: Assignation[],
): Promise<void> {
  const sheets = [
    {
      name: 'Par groupe',
      data: toSheetData(tableauParGroupe(session, lieu, inscriptions, creneaux, assignations)),
    },
    {
      name: 'Résa salles',
      data: toSheetData(tableauParSalle(lieu, inscriptions, creneaux, assignations)),
    },
    {
      name: 'Par musicien',
      data: toSheetData(tableauParMusicien(lieu, inscriptions, creneaux, assignations)),
    },
  ]
  await writeXlsxFile(sheets, { fileName: nomFichier })
}
