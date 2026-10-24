/**
 * #208 : la raison d'une séance sans salle nomme sa cause. « Jauge de toutes
 * les salles restantes » se lisait « toutes les salles du lieu » ou « celles
 * encore libres », deux lectures qui commandent des gestes opposés.
 */
import { expect, it } from 'vitest'
import type { Creneau } from '../domain/grille'
import { FONCTIONS_ACTIVEES_TOUT_ACTIF } from '../domain/model'
import type { Inscriptions, Lieu } from '../domain/model'
import { attribuerSalles } from './allocate-rooms'

type S = { id: string; jauge: number; actif?: boolean; ferme?: boolean }

function lieu(salles: S[]): Lieu {
  return {
    id: 'l',
    nom: 'L',
    salles: salles.map((s) => ({
      id: s.id,
      nom: s.id,
      jauge: s.jauge,
      equipement: [],
      restrictions: s.ferme
        ? [{ jours: [], debut: '00:00', fin: '23:59', contrainte: 'interdit' as const, motif: '' }]
        : [],
      actif: s.actif ?? true,
    })),
    pupitres: ['piano'],
    fonctionsActivees: FONCTIONS_ACTIVEES_TOUT_ACTIF,
  }
}

function groupe(id: string, n: number): Inscriptions['groupes'][number] {
  return {
    id, titre: id, auteur: '', style: '', tonalite: '', responsable_id: '',
    membres: [...Array(n)].map((_, i) => ({ personne_id: `${id}${i}`, pupitre: 'piano' as const })),
    postes_cherches: [], repetitions_deja_faites: 0, echeance: 'apero_mercredi',
  }
}

function raison(salles: S[], groupes: Inscriptions['groupes']): string[] {
  const c: Creneau = { id: 'c1', date: '2026-10-28', debut: '09:00', fin: '10:00', salles: salles.map((s) => s.id) }
  const insc: Inscriptions = { session_id: 's', personnes: [], groupes, imposes: [], refus: [] }
  const placement = groupes.map((g) => ({ groupe_id: g.id, creneau_id: 'c1' }))
  return attribuerSalles(placement, lieu(salles), insc, [c]).groupesPerdus.map((gp) => gp.raison)
}

// Relevé CD : Le Garage et XVème à 2, Les Clapiers à 10, deux salles à 6.
const SALLES_CD: S[] = [
  { id: 'Les Clapiers', jauge: 10 },
  { id: 'Studio', jauge: 6 },
  { id: 'Salle B', jauge: 6 },
  { id: 'Le Garage', jauge: 2 },
  { id: 'XVème', jauge: 2 },
]

it('relevé CD : la grande salle est nommée, avec le groupe qui l\'occupe', () => {
  expect(raison(SALLES_CD, [groupe('Move On Up', 8), groupe('Love', 7)])).toEqual([
    'Love (7 musiciens), 28/10/2026 09:00 : Les Clapiers (10 places) est prise par Move On Up ; les 4 autres salles libres ont moins de 7 places',
  ])
})

it('aucune salle du lieu assez grande : la jauge est nommée comme cause', () => {
  expect(raison([{ id: 'A', jauge: 6 }, { id: 'B', jauge: 2 }], [groupe('Love', 7)])).toEqual([
    "Love (7 musiciens), 28/10/2026 09:00 : aucune salle du lieu n'accueille 7 musiciens (la plus grande a 6 places)",
  ])
})

it('grande salle fermée à ce créneau : pas « prise par des groupes précédents »', () => {
  expect(raison([{ id: 'A', jauge: 10, ferme: true }], [groupe('Love', 7)])).toEqual([
    'Love (7 musiciens), 28/10/2026 09:00 : A (10 places) est fermée à ce créneau',
  ])
})

it('grande salle désactivée, une petite libre', () => {
  expect(raison([{ id: 'A', jauge: 10, actif: false }, { id: 'B', jauge: 2 }], [groupe('Love', 7)])).toEqual([
    "Love (7 musiciens), 28/10/2026 09:00 : A (10 places) est désactivée ; l'autre salle libre a moins de 7 places",
  ])
})
