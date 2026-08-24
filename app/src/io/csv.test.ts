import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import type { Assignation } from '../engine/types'
import { csvParGroupe, csvParMusicien, csvParSalle } from './csv'

function fixture() {
  const lieu = Lieu.parse({
    id: 'lieu',
    nom: 'Lieu',
    salles: [
      { id: 'A', nom: 'Salle A', jauge: 8 },
      { id: 'B', nom: 'Salle B', jauge: 5 },
    ],
  })
  const session = Session.parse({
    id: 's',
    nom: 'S',
    lieu_id: 'lieu',
    date_debut: '2026-08-24',
    date_fin: '2026-08-25',
    date_butoir: '2026-08-25',
    butoir_heure: '20:00',
    grille: [{ debut: '09:00', fin: '11:00', pas_minutes: 60 }],
    repetitions_visees: 2,
  })
  const inscriptions = Inscriptions.parse({
    session_id: 's',
    personnes: [
      { id: 'alice', nom: 'Alice', instruments: [{ pupitre: 'chant' }] },
      { id: 'bob', nom: 'Bob', instruments: [{ pupitre: 'piano' }] },
    ],
    groupes: [
      {
        id: 'g1',
        titre: 'Duo',
        style: 'Jazz',
        tonalite: 'C',
        responsable_id: 'alice',
        membres: [
          { personne_id: 'alice', pupitre: 'chant' },
          { personne_id: 'bob', pupitre: 'piano' },
        ],
      },
    ],
  })
  const creneaux = genererCreneaux(session, lieu)
  return { session, lieu, inscriptions, creneaux }
}

describe('csvParGroupe', () => {
  it('produit un BOM UTF-8 et un séparateur point-virgule', () => {
    const { session, lieu, inscriptions, creneaux } = fixture()
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
      { groupe_id: 'g1', creneau_id: creneaux[1].id, salle_id: 'B' },
    ]
    const csv = csvParGroupe(session, lieu, inscriptions, creneaux, assignations)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('N°;Groupe;Responsable;Style;Tonalité;Effectif')
    expect(csv).toContain('Duo')
    expect(csv).toContain('2026-08-24')
    expect(csv).toContain('Salle A')
  })

  it('remplit les colonnes vides quand une répé manque', () => {
    const { session, lieu, inscriptions, creneaux } = fixture()
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
    ]
    const csv = csvParGroupe(session, lieu, inscriptions, creneaux, assignations)
    // Cible = 2 : la 2ᵉ répé absente laisse 3 champs vides consécutifs
    expect(csv).toContain(';;;')
  })
})

describe('csvParSalle', () => {
  it('liste chaque créneau × salle avec état occupé/libre', () => {
    const { lieu, inscriptions, creneaux } = fixture()
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
    ]
    const csv = csvParSalle(lieu, inscriptions, creneaux, assignations)
    expect(csv).toContain('Salle;Jour;Horaire;Groupe;Responsable;État')
    expect(csv).toContain('occupée')
    expect(csv).toContain('libre')
    // 2 jours × 2 tours × 2 salles = 8 lignes de données
    const lignes = csv.split('\r\n').filter(Boolean)
    expect(lignes.length).toBe(1 + 8)
  })

  it("groupe chaque musicien puis trie ses engagements par ordre chronologique", () => {
    const { lieu, inscriptions, creneaux } = fixture()
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[1].id, salle_id: 'B' },
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
    ]
    const csv = csvParMusicien(lieu, inscriptions, creneaux, assignations)
    expect(csv).toContain('Musicien;Jour;Horaire;Groupe;Salle')
    // Alice figure 2× (2 répés du groupe où elle joue)
    const lignes = csv.split('\r\n').filter(Boolean)
    const alice = lignes.filter((l) => l.startsWith('Alice;'))
    expect(alice).toHaveLength(2)
    // Ordre chronologique préservé
    expect(alice[0]).toContain('09:00')
    expect(alice[1]).toContain('10:00')
  })

  it('échappe les valeurs contenant ; ou "', () => {
    const { lieu, inscriptions, creneaux } = fixture()
    const inscMod = Inscriptions.parse({
      ...inscriptions,
      groupes: [{ ...inscriptions.groupes[0], titre: 'Duo; special "test"' }],
    })
    const assignations: Assignation[] = [
      { groupe_id: 'g1', creneau_id: creneaux[0].id, salle_id: 'A' },
    ]
    const csv = csvParSalle(lieu, inscMod, creneaux, assignations)
    expect(csv).toContain('"Duo; special ""test"""')
  })
})
