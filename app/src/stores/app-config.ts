import type { IdContrainte } from '../engine/contraintes'
import type { MappingListe } from '../io/liste-adapter'
import type { MappingStagiaires } from '../io/stagiaires-adapter'

/**
 * Configuration statique de l'app Balance : libellés des contraintes,
 * mappings Excel par défaut, état initial des contraintes activables.
 *
 * Extrait de App.svelte (audit Leader — P1 « God script »). Contient
 * uniquement des constantes pures — pas de state, pas de logique.
 * Le state réactif reste dans App.svelte pour cette 1ʳᵉ passe ;
 * la migration vers un `AppStore` class-based est prévue dans une PR
 * ultérieure une fois les fondations posées.
 */

export const LIBELLE_CONTRAINTE: Record<IdContrainte, string> = {
  'personne-unique-moment': 'Une personne à un seul endroit à la fois',
  'salle-unique-groupe': 'Une salle à un seul groupe à la fois',
  'jauge-salle': 'Effectif ≤ jauge de la salle',
  'personne-indispo': 'Respect des indisponibilités déclarées',
  'avant-butoir': 'Répétitions avant la date butoir',
  'salle-hors-creneau': 'Salle attribuée ouverte au créneau',
  'restriction-horaire-salle': 'Restrictions horaires par salle (dortoirs, autres usages)',
  'creneaux-consecutifs': 'Pas deux répétitions accolées pour un même groupe',
  'preference-espacement-12h': '≥ 12 h entre deux répétitions d\'un même morceau (prioritaire)',
  'preference-repos-musicien-12h': '≥ 12 h de repos entre deux engagements d\'un même musicien (secondaire)',
  'preference-equilibre-tardif': 'Éviter qu\'un musicien ait toutes ses répés en soirée',
  'preference-salle-stable-lourd': 'Regrouper les répés d\'un musicien à instrument lourd (contrebasse…) dans la même salle',
}

/** Toutes les contraintes activées par défaut au 1er lancement. */
export const CONTRAINTES_ACTIVES_DEFAUT: Record<IdContrainte, boolean> = {
  'personne-unique-moment': true,
  'salle-unique-groupe': true,
  'jauge-salle': true,
  'personne-indispo': true,
  'avant-butoir': true,
  'salle-hors-creneau': true,
  'restriction-horaire-salle': true,
  'creneaux-consecutifs': true,
  'preference-espacement-12h': true,
  'preference-repos-musicien-12h': true,
  'preference-equilibre-tardif': true,
  'preference-salle-stable-lourd': true,
}

/** Mapping par défaut du classeur `Liste` (onglet principal des morceaux). */
export const MAPPING_LISTE_DEFAUT: MappingListe = {
  colonneMorceau: 'Morceau',
  colonneAuteur: 'Auteur',
  colonneStyle: 'Style',
  colonneTona: 'Tona',
  colonneResp: 'Resp',
  colonneCherche: 'Cherche',
  colonnesPupitres: {
    chant: 'Chant',
    piano: 'Piano',
    basse: 'Basse',
    batterie: 'Batterie',
    guitare: 'Guitare',
    vents: 'Vents',
  },
}

/** Mapping par défaut du classeur `Stagiaires` (référentiel des inscrits). */
export const MAPPING_STAGIAIRES_DEFAUT: MappingStagiaires = {
  colonneNom: 'Nom',
  colonnePupitrePrincipal: 'Pupitre',
  colonnePupitresAdditionnels: 'Pupitres additionnels',
  colonneInstrument: 'Instrument',
  colonneLateralite: 'Latéralité',
  colonneIndispos: 'Indispos',
}
