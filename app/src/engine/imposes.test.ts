import { describe, expect, it } from 'vitest'
import type { Creneau } from '../domain/grille'
import { Inscriptions, Lieu } from '../domain/model'
import {
  enrichirIndispos,
  imposesOccupantCreneau,
  resoudreSalleImposeeVersLieu,
  warningsSalleImposeeInconnue,
} from './imposes'

describe('enrichirIndispos', () => {
  it("ajoute une Indispo sur chaque membre pour chaque séance d'un imposé", () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice', instruments: [{ pupitre: 'chant' }] },
        { id: 'bob', nom: 'Bob', instruments: [{ pupitre: 'piano' }] },
        { id: 'charlie', nom: 'Charlie', instruments: [{ pupitre: 'basse' }] },
      ],
      groupes: [],
      imposes: [
        {
          id: 'lady-bird',
          morceau: 'Lady Bird',
          membres: ['alice', 'bob'],
          seances: [
            { date: '2026-08-23', debut: '14:30', fin: '16:00' },
            { date: '2026-08-25', debut: '16:30', fin: '18:00' },
          ],
        },
      ],
    })
    const enrichie = enrichirIndispos(insc)
    const alice = enrichie.personnes.find((p) => p.id === 'alice')!
    expect(alice.indispos.length).toBe(2)
    expect(alice.indispos[0].jours).toEqual(['2026-08-23'])
    expect(alice.indispos[0].debut).toBe('14:30')
    expect(alice.indispos[0].fin).toBe('16:00')
    expect(alice.indispos[0].motif).toContain('Lady Bird')
    const charlie = enrichie.personnes.find((p) => p.id === 'charlie')!
    expect(charlie.indispos.length).toBe(0)
  })

  it("préserve les indispos existantes et ne mute pas l'entrée", () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        {
          id: 'alice',
          nom: 'Alice',
          instruments: [{ pupitre: 'chant' }],
          indispos: [{ debut: '09:00', roles: ['chant'] }],
        },
      ],
      groupes: [],
      imposes: [
        {
          id: 'x',
          morceau: 'X',
          membres: ['alice'],
          seances: [{ date: '2026-08-25', debut: '14:00', fin: '15:00' }],
        },
      ],
    })
    const enrichie = enrichirIndispos(insc)
    expect(enrichie.personnes[0].indispos.length).toBe(2)
    expect(insc.personnes[0].indispos.length).toBe(1) // pas muté
  })

  it('renvoie tel quel si aucun imposé', () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [],
    })
    expect(enrichirIndispos(insc)).toBe(insc)
  })
})

describe('resoudreSalleImposeeVersLieu — match texte libre → id lieu (CD 7016)', () => {
  const lieu = Lieu.parse({
    id: 'x',
    nom: 'X',
    salles: [
      { id: 'garage', nom: 'Le Garage', jauge: 6 },
      { id: 'xveme', nom: 'XVème', jauge: 12 },
    ],
  })

  it('match par nom exact', () => {
    expect(resoudreSalleImposeeVersLieu('Le Garage', lieu.salles)).toBe('garage')
  })

  it('match case-insensitive', () => {
    expect(resoudreSalleImposeeVersLieu('le garage', lieu.salles)).toBe('garage')
    expect(resoudreSalleImposeeVersLieu('LE GARAGE', lieu.salles)).toBe('garage')
  })

  it('match accents-insensitive (XVeme sans accent → XVème)', () => {
    // Cas de la fixture stress-test : le classeur porte « XVeme » sans
    // accent, la salle du lieu s'appelle « XVème ». Sans normalisation
    // NFD, on retomberait dans le silence de l'affichage.
    expect(resoudreSalleImposeeVersLieu('XVeme', lieu.salles)).toBe('xveme')
  })

  it('match par id', () => {
    expect(resoudreSalleImposeeVersLieu('garage', lieu.salles)).toBe('garage')
  })

  it('renvoie null pour une salle inconnue', () => {
    expect(resoudreSalleImposeeVersLieu('Salle Inconnue', lieu.salles)).toBeNull()
  })

  it('renvoie null pour vide/undefined', () => {
    expect(resoudreSalleImposeeVersLieu(undefined, lieu.salles)).toBeNull()
    expect(resoudreSalleImposeeVersLieu('', lieu.salles)).toBeNull()
    expect(resoudreSalleImposeeVersLieu('   ', lieu.salles)).toBeNull()
  })
})

describe('imposesOccupantCreneau — matching temporel + salle (CD 7016)', () => {
  const lieu = Lieu.parse({
    id: 'x',
    nom: 'X',
    salles: [
      { id: 'garage', nom: 'Le Garage', jauge: 6 },
      { id: 'xveme', nom: 'XVème', jauge: 12 },
    ],
  })
  const insc = Inscriptions.parse({
    session_id: 's',
    personnes: [{ id: 'alice', nom: 'Alice' }],
    groupes: [],
    imposes: [
      {
        id: 'autumn',
        morceau: 'Autumn Leaves',
        membres: ['alice'],
        seances: [
          { date: '2026-08-26', debut: '14:30', fin: '16:00', salle_id: 'Le Garage' },
        ],
      },
      {
        id: 'watermelon',
        morceau: 'Watermelon Man',
        membres: ['alice'],
        seances: [
          { date: '2026-08-26', debut: '11:15', fin: '12:45', salle_id: 'XVeme' },
        ],
      },
    ],
  })

  const creneau = (id: string, date: string, debut: string, fin: string): Creneau => ({
    id,
    date,
    debut,
    fin,
    salles: ['garage', 'xveme'],
  })

  it('marque Le Garage occupé quand Autumn Leaves 14:30-16:00 chevauche créneau 14:30', () => {
    const c = creneau('c1', '2026-08-26', '14:30', '15:30')
    const occ = imposesOccupantCreneau(insc, c, lieu.salles)
    expect(occ.get('garage')).toEqual({ impose_id: 'autumn', morceau: 'Autumn Leaves' })
    expect(occ.has('xveme')).toBe(false)
  })

  it('couvre le 2ème créneau de la plage (chevauchement 15:30-16:00)', () => {
    // Autumn Leaves va de 14:30 à 16:00. Le créneau 15:30-16:30 est
    // partiellement recouvert (dernière minute occupée = 15:59, seance
    // exclusive à 16:00 vs créneau exclusif à 16:30) → chevauchement.
    const c = creneau('c2', '2026-08-26', '15:30', '16:30')
    const occ = imposesOccupantCreneau(insc, c, lieu.salles)
    expect(occ.get('garage')).toEqual({ impose_id: 'autumn', morceau: 'Autumn Leaves' })
  })

  it("n'attribue pas la salle quand le créneau est hors plage (16:30-17:30 après Autumn)", () => {
    const c = creneau('c3', '2026-08-26', '16:30', '17:30')
    const occ = imposesOccupantCreneau(insc, c, lieu.salles)
    expect(occ.has('garage')).toBe(false)
  })

  it("ignore une seance dont la salle_id ne correspond à aucune salle du lieu", () => {
    // Si le classeur porte « Salle X », l'imposé n'est pas rattaché —
    // c'est le cas frontière que CD 7016 signale via warning à
    // l'import (voir warningsSalleImposeeInconnue).
    const inscInconnue = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [],
      imposes: [
        {
          id: 'i',
          morceau: 'X',
          membres: ['a'],
          seances: [{ date: '2026-08-26', debut: '14:00', fin: '15:00', salle_id: 'Salle Fantome' }],
        },
      ],
    })
    const c = creneau('c', '2026-08-26', '14:00', '15:00')
    expect(imposesOccupantCreneau(inscInconnue, c, lieu.salles).size).toBe(0)
  })

  it('ignore un imposé sans salle_id', () => {
    const inscSansSalle = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [],
      imposes: [
        {
          id: 'i',
          morceau: 'X',
          membres: ['a'],
          seances: [{ date: '2026-08-26', debut: '14:00', fin: '15:00' }],
        },
      ],
    })
    const c = creneau('c', '2026-08-26', '14:00', '15:00')
    expect(imposesOccupantCreneau(inscSansSalle, c, lieu.salles).size).toBe(0)
  })

  it("n'attribue pas sur un jour différent", () => {
    const c = creneau('c', '2026-08-27', '14:30', '15:30')
    expect(imposesOccupantCreneau(insc, c, lieu.salles).size).toBe(0)
  })
})

describe('warningsSalleImposeeInconnue — alerte import (CD 7016)', () => {
  const lieu = Lieu.parse({
    id: 'x',
    nom: 'X',
    salles: [{ id: 'garage', nom: 'Le Garage', jauge: 6 }],
  })

  it('signale une salle_id qui ne correspond à aucune salle du lieu', () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [],
      imposes: [
        {
          id: 'i',
          morceau: 'Autumn Leaves',
          membres: ['a'],
          seances: [
            { date: '2026-08-26', debut: '14:30', fin: '16:00', salle_id: 'Salle Inconnue' },
          ],
        },
      ],
    })
    const ws = warningsSalleImposeeInconnue(insc, lieu.salles)
    expect(ws).toHaveLength(1)
    expect(ws[0]).toContain('Autumn Leaves')
    expect(ws[0]).toContain('Salle Inconnue')
    expect(ws[0]).toContain('2026-08-26')
  })

  it("ne signale pas une salle qui matche (accents insensible)", () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [],
      imposes: [
        {
          id: 'i',
          morceau: 'X',
          membres: ['a'],
          seances: [
            { date: '2026-08-26', debut: '14:00', fin: '15:00', salle_id: 'le garage' },
          ],
        },
      ],
    })
    expect(warningsSalleImposeeInconnue(insc, lieu.salles)).toEqual([])
  })

  it("ignore les séances sans salle_id (champ vide légitime)", () => {
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'a', nom: 'A' }],
      groupes: [],
      imposes: [
        {
          id: 'i',
          morceau: 'X',
          membres: ['a'],
          seances: [{ date: '2026-08-26', debut: '14:00', fin: '15:00' }],
        },
      ],
    })
    expect(warningsSalleImposeeInconnue(insc, lieu.salles)).toEqual([])
  })
})
