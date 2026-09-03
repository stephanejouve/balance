import writeXlsxFile from 'write-excel-file/browser'
import type { MappingListe } from './liste-adapter'
import type { MappingProposes } from './proposes-adapter'
import type { MappingStagiaires } from './stagiaires-adapter'

/**
 * Génère un classeur `.xlsx` template avec les 3 onglets attendus par
 * les importeurs de Balance (`Liste`, `Stagiaires`, `Proposés`) + un
 * onglet `Mode d'emploi`. Réutilise les mappings passés en paramètre
 * pour que les noms de colonnes du template soient toujours cohérents
 * avec ce que l'app importe — source de vérité unique, pas de dérive.
 *
 * Décision structurante (revue Claude Desktop) : **les 3 onglets de
 * données ne contiennent que leur ligne d'en-tête**. Les exemples et
 * conventions vivent dans l'onglet `Mode d'emploi`, où ils sont utiles
 * et inoffensifs. Un utilisateur qui remplit son classeur ne peut plus
 * laisser passer par mégarde des lignes « Love » ou « Emma (B) » dans
 * une vraie session (bug historique qu'un `title` de bouton ne pouvait
 * pas prévenir).
 *
 * Le fichier reste local (write-excel-file/browser génère un Blob que
 * l'utilisateur télécharge). Offline garanti (brief §8).
 */

type SheetCell = { value: string | number | null; fontWeight?: 'bold' }

function ligneEnTete(labels: string[]): SheetCell[] {
  return labels.map((v) => ({ value: v, fontWeight: 'bold' as const }))
}

function ongletListe(mapping: MappingListe): SheetCell[][] {
  // Colonnes ordinaires + les pupitres du mapping (ordre d'insertion),
  // pas les 6 canoniques figés — un lieu peut avoir un pupitre custom
  // (accordéon, cordes…), le template doit sortir avec ses colonnes.
  const colonnes: string[] = [
    mapping.colonneMorceau,
    ...(mapping.colonneAuteur ? [mapping.colonneAuteur] : []),
    ...(mapping.colonneStyle ? [mapping.colonneStyle] : []),
    ...(mapping.colonneTona ? [mapping.colonneTona] : []),
    ...(mapping.colonneResp ? [mapping.colonneResp] : []),
    ...(mapping.colonneCherche ? [mapping.colonneCherche] : []),
    ...Object.values(mapping.colonnesPupitres).filter((v): v is string => Boolean(v)),
  ]
  return [ligneEnTete(colonnes)]
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
  return [ligneEnTete(colonnes)]
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
  return [ligneEnTete(colonnes)]
}

/**
 * Onglet `Mode d'emploi` — porte les conventions qu'aucun en-tête ne
 * peut exprimer, avec les exemples que le brief demandait de placer
 * ici plutôt que dans les onglets de données.
 *
 * Format : 2 colonnes (Exemple, Que ça signifie), avec des sections en
 * gras pour séparer les blocs. La 1ʳᵉ colonne peut aussi porter le titre
 * de section sans valeur en 2ᵉ colonne.
 */
function ongletModeEmploi(): SheetCell[][] {
  const g = (s: string): SheetCell => ({ value: s, fontWeight: 'bold' as const })
  const v = (s: string | null): SheetCell => ({ value: s })
  return [
    [g('Exemple'), g('Que ça signifie')],
    [g('— Onglet Liste : cellules d\'un pupitre —'), v(null)],
    [v('(cellule vide)'), v('Pas de personne à ce pupitre pour ce morceau (défaut)')],
    [v('NON'), v('Explicitement pas ce pupitre (équivalent à vide, plus lisible)')],
    [v('CHERCHE'), v("Poste à pourvoir — les renforts compatibles seront suggérés dans l'UI")],
    [v('Emma, Bianca'), v('Plusieurs personnes au même pupitre (séparateur virgule)')],
    [
      v('Colette (contrebasse)'),
      v("Parenthèse = instrument : precision libre appliquée à cette personne"),
    ],
    [
      v('Pierre (SIG), Pierre (L)'),
      v("Parenthèses discriminantes : deux personnes distinctes (homonymes du même prénom)"),
    ],
    [v(null), v(null)],
    [g('— Onglet Stagiaires : colonne Indispos —'), v(null)],
    [v('mercredi 09h-10h chant'), v('Jour de la semaine + plage horaire + rôle ciblé')],
    [v('mardi 14:30 - 16:00'), v('Jour et plage horaire seuls')],
    [
      v('convalescence'),
      v('Texte libre conservé sans horaire spécifique (motif pour relecture humaine)'),
    ],
    [v(null), v(null)],
    [g('— Onglet Stagiaires : intervenants inclus —'), v(null)],
    [
      v("Bertrand au piano d'un morceau de stagiaires"),
      v(
        "L'onglet Stagiaires accueille toutes les personnes du stage, intervenants compris. Un intervenant qui vient jouer dans un morceau se déclare ici comme les autres, avec son pupitre.",
      ),
    ],
    [v(null), v(null)],
    [g('— Onglet Proposés : concert du vendredi —'), v(null)],
    [
      v('1 ligne = 1 séance'),
      v('Plusieurs séances du même morceau : autant de lignes avec le même titre'),
    ],
    [
      v('Date : 2026-08-28 ou 28/08/2026'),
      v('ISO ou format FR — les deux sont tolérés à l\'import'),
    ],
    [v('Heure : 09:00 ou 9h30'), v('HH:MM ou format libre avec « h »')],
    [v(null), v(null)],
    [g('— Exemple concret d\'une ligne Liste —'), v(null)],
    [v('Morceau'), v('Love')],
    [v('Auteur'), v('Nat King Cole')],
    [v('Style'), v('Jazz')],
    [v('Resp'), v('Emma')],
    [v('Chant'), v('Emma (B), Bianca (B)')],
    [v('Piano'), v('Prune')],
    [v('Basse'), v('Rose')],
    [v('Batterie'), v('CHERCHE')],
    [v('Guitare'), v('Cyril')],
    [v('Vents'), v('Serge')],
  ]
}

export interface TemplateMappings {
  liste: MappingListe
  stagiaires: MappingStagiaires
  proposes: MappingProposes
}

/**
 * Version pure (sans IO) — construit la structure des 4 onglets pour
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
    { sheet: "Mode d'emploi", data: ongletModeEmploi() },
  ]
}

/**
 * Génère et télécharge le classeur template `.xlsx`. Le fichier est
 * nommé `balance-template.xlsx` par défaut.
 */
export async function genererTemplateXlsx(
  mappings: TemplateMappings,
  nomFichier = 'balance-template.xlsx',
): Promise<void> {
  const sheets = construireTemplate(mappings)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (writeXlsxFile as any)(sheets).toFile(nomFichier)
}
