import writeXlsxFile from 'write-excel-file/browser'
import type { MappingListe } from './liste-adapter'
import type { MappingProposes } from './proposes-adapter'
import type { MappingStagiaires } from './stagiaires-adapter'

/**
 * Génère un classeur `.xlsx` template avec les 3 onglets attendus par
 * les importeurs de Balance (`Liste`, `Stagiaires`, `Proposés`), leurs
 * en-têtes complètes et deux lignes d'exemple par onglet. Réutilise les
 * mappings passés en paramètre pour que les noms de colonnes du template
 * soient toujours cohérents avec ce que l'app importe — source de vérité
 * unique, pas de dérive.
 *
 * Le fichier reste local (write-excel-file/browser génère un Blob que
 * l'utilisateur télécharge). Offline garanti (brief §8).
 */

type SheetCell = { value: string | number | null; fontWeight?: 'bold' }

function ligneEnTete(labels: string[]): SheetCell[] {
  return labels.map((v) => ({ value: v, fontWeight: 'bold' as const }))
}

function ligneDonnees(values: Array<string | number | null>): SheetCell[] {
  return values.map((v) => ({ value: v }))
}

function ongletListe(mapping: MappingListe): SheetCell[][] {
  // Ordre stable : colonnes ordinaires puis les 6 pupitres dans l'ordre canonique.
  const colonnes: string[] = [
    mapping.colonneMorceau,
    ...(mapping.colonneAuteur ? [mapping.colonneAuteur] : []),
    ...(mapping.colonneStyle ? [mapping.colonneStyle] : []),
    ...(mapping.colonneTona ? [mapping.colonneTona] : []),
    ...(mapping.colonneResp ? [mapping.colonneResp] : []),
    ...(mapping.colonneCherche ? [mapping.colonneCherche] : []),
    ...(mapping.colonnesPupitres.chant ? [mapping.colonnesPupitres.chant] : []),
    ...(mapping.colonnesPupitres.piano ? [mapping.colonnesPupitres.piano] : []),
    ...(mapping.colonnesPupitres.basse ? [mapping.colonnesPupitres.basse] : []),
    ...(mapping.colonnesPupitres.batterie ? [mapping.colonnesPupitres.batterie] : []),
    ...(mapping.colonnesPupitres.guitare ? [mapping.colonnesPupitres.guitare] : []),
    ...(mapping.colonnesPupitres.vents ? [mapping.colonnesPupitres.vents] : []),
  ]
  const indexPar = new Map(colonnes.map((c, i) => [c, i]))

  // Deux lignes d'exemple concrets — reprises des exemples du README pour cohérence
  const exemples: Array<Record<string, string>> = [
    {
      [mapping.colonneMorceau]: 'Love',
      ...(mapping.colonneAuteur ? { [mapping.colonneAuteur]: 'Nat King Cole' } : {}),
      ...(mapping.colonneStyle ? { [mapping.colonneStyle]: 'Jazz' } : {}),
      ...(mapping.colonneResp ? { [mapping.colonneResp]: 'Emma' } : {}),
      ...(mapping.colonnesPupitres.chant ? { [mapping.colonnesPupitres.chant]: 'Emma (B), Bianca (B)' } : {}),
      ...(mapping.colonnesPupitres.piano ? { [mapping.colonnesPupitres.piano]: 'Prune' } : {}),
      ...(mapping.colonnesPupitres.basse ? { [mapping.colonnesPupitres.basse]: 'Rose' } : {}),
      ...(mapping.colonnesPupitres.batterie ? { [mapping.colonnesPupitres.batterie]: 'CHERCHE' } : {}),
      ...(mapping.colonnesPupitres.guitare ? { [mapping.colonnesPupitres.guitare]: 'Cyril' } : {}),
      ...(mapping.colonnesPupitres.vents ? { [mapping.colonnesPupitres.vents]: 'Serge' } : {}),
    },
    {
      [mapping.colonneMorceau]: 'Autumn Leaves',
      ...(mapping.colonneAuteur ? { [mapping.colonneAuteur]: 'Cosma' } : {}),
      ...(mapping.colonneStyle ? { [mapping.colonneStyle]: 'Jazz' } : {}),
      ...(mapping.colonneTona ? { [mapping.colonneTona]: 'Bb' } : {}),
      ...(mapping.colonneResp ? { [mapping.colonneResp]: 'Karl' } : {}),
      ...(mapping.colonnesPupitres.chant ? { [mapping.colonnesPupitres.chant]: 'Léa' } : {}),
      ...(mapping.colonnesPupitres.piano ? { [mapping.colonnesPupitres.piano]: 'Karl' } : {}),
      ...(mapping.colonnesPupitres.basse ? { [mapping.colonnesPupitres.basse]: 'Prune (contrebasse)' } : {}),
      ...(mapping.colonnesPupitres.batterie ? { [mapping.colonnesPupitres.batterie]: 'Zoltan (SIG)' } : {}),
      ...(mapping.colonnesPupitres.guitare ? { [mapping.colonnesPupitres.guitare]: 'NON' } : {}),
      ...(mapping.colonnesPupitres.vents ? { [mapping.colonnesPupitres.vents]: 'Cédric (sax alto)' } : {}),
    },
  ]

  const lignes: SheetCell[][] = [ligneEnTete(colonnes)]
  for (const ex of exemples) {
    const row: Array<string | null> = colonnes.map(() => null)
    for (const [colName, valeur] of Object.entries(ex)) {
      const i = indexPar.get(colName)
      if (i !== undefined) row[i] = valeur
    }
    lignes.push(ligneDonnees(row))
  }
  return lignes
}

function ongletStagiaires(mapping: MappingStagiaires): SheetCell[][] {
  const colonnes: string[] = [
    mapping.colonneNom,
    ...(mapping.colonnePupitrePrincipal ? [mapping.colonnePupitrePrincipal] : []),
    ...(mapping.colonnePupitresAdditionnels ? [mapping.colonnePupitresAdditionnels] : []),
    ...(mapping.colonneInstrument ? [mapping.colonneInstrument] : []),
    ...(mapping.colonneLateralite ? [mapping.colonneLateralite] : []),
    ...(mapping.colonneIndispos ? [mapping.colonneIndispos] : []),
  ]
  const indexPar = new Map(colonnes.map((c, i) => [c, i]))

  const exemples: Array<Record<string, string>> = [
    {
      [mapping.colonneNom]: 'Emma (B)',
      ...(mapping.colonnePupitrePrincipal ? { [mapping.colonnePupitrePrincipal]: 'chant' } : {}),
      ...(mapping.colonneIndispos ? { [mapping.colonneIndispos]: 'vendredi 14:00-16:00' } : {}),
    },
    {
      [mapping.colonneNom]: 'Prune',
      ...(mapping.colonnePupitrePrincipal ? { [mapping.colonnePupitrePrincipal]: 'piano' } : {}),
      ...(mapping.colonnePupitresAdditionnels ? { [mapping.colonnePupitresAdditionnels]: 'basse' } : {}),
      ...(mapping.colonneInstrument ? { [mapping.colonneInstrument]: 'contrebasse' } : {}),
    },
    {
      [mapping.colonneNom]: 'Zoltan (SIG)',
      ...(mapping.colonnePupitrePrincipal ? { [mapping.colonnePupitrePrincipal]: 'batterie' } : {}),
      ...(mapping.colonneLateralite ? { [mapping.colonneLateralite]: 'droitier' } : {}),
    },
  ]

  const lignes: SheetCell[][] = [ligneEnTete(colonnes)]
  for (const ex of exemples) {
    const row: Array<string | null> = colonnes.map(() => null)
    for (const [colName, valeur] of Object.entries(ex)) {
      const i = indexPar.get(colName)
      if (i !== undefined) row[i] = valeur
    }
    lignes.push(ligneDonnees(row))
  }
  return lignes
}

function ongletProposes(mapping: MappingProposes): SheetCell[][] {
  const colonnes: string[] = [
    mapping.colonneMorceau,
    mapping.colonneMembres,
    mapping.colonneDate,
    mapping.colonneDebut,
    mapping.colonneFin,
    ...(mapping.colonneSalle ? [mapping.colonneSalle] : []),
  ]

  const exemples: Array<string[]> = [
    ['Blowin in the wind', 'Emma (B), Prune, Zoltan (SIG)', '2026-08-28', '09:00', '10:00', 'XVème'],
    ['Blowin in the wind', 'Emma (B), Prune, Zoltan (SIG)', '2026-08-29', '14:00', '15:00', ''],
    ['Autumn Leaves', 'Karl, Cédric (sax alto)', '2026-08-28', '10:00', '11:00', 'Le Garage'],
  ]

  const lignes: SheetCell[][] = [ligneEnTete(colonnes)]
  for (const ex of exemples) {
    // Tronque si `Salle` n'est pas dans le mapping
    const row = ex.slice(0, colonnes.length).map((v) => (v === '' ? null : v))
    lignes.push(ligneDonnees(row))
  }
  return lignes
}

export interface TemplateMappings {
  liste: MappingListe
  stagiaires: MappingStagiaires
  proposes: MappingProposes
}

/**
 * Version pure (sans IO) — construit la structure des 3 onglets pour
 * les tests unitaires. `genererTemplateXlsx()` s'appuie dessus puis
 * appelle `write-excel-file` pour l'écriture navigateur.
 */
export function construireTemplate(mappings: TemplateMappings): Array<{
  sheet: string
  data: SheetCell[][]
}> {
  return [
    { sheet: 'Liste', data: ongletListe(mappings.liste) },
    { sheet: 'Stagiaires', data: ongletStagiaires(mappings.stagiaires) },
    { sheet: 'Proposés', data: ongletProposes(mappings.proposes) },
  ]
}

/**
 * Génère et télécharge le classeur template `.xlsx` avec les 3 onglets
 * `Liste`, `Stagiaires`, `Proposés`. Le fichier est nommé
 * `balance-template.xlsx` par défaut.
 */
export async function genererTemplateXlsx(
  mappings: TemplateMappings,
  nomFichier = 'balance-template.xlsx',
): Promise<void> {
  const sheets = construireTemplate(mappings)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (writeXlsxFile as any)(sheets).toFile(nomFichier)
}
