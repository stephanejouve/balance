import { describe, expect, it } from 'vitest'
import { decouper, genererCreneaux, joursDeSession } from './grille'
import { Lieu, Session } from './model'

describe('decouper', () => {
  it('découpe une plage en tours du pas demandé', () => {
    const tours = decouper('09:00', '10:00', 60)
    expect(tours).toEqual([{ debut: '09:00', fin: '10:00' }])
  })

  it("découpe 16:30-20:30 en 4 tours d'une heure", () => {
    const tours = decouper('16:30', '20:30', 60)
    expect(tours).toHaveLength(4)
    expect(tours[0]).toEqual({ debut: '16:30', fin: '17:30' })
    expect(tours[3]).toEqual({ debut: '19:30', fin: '20:30' })
  })

  it("découpe en pas de 30 minutes", () => {
    const tours = decouper('09:00', '10:00', 30)
    expect(tours).toEqual([
      { debut: '09:00', fin: '09:30' },
      { debut: '09:30', fin: '10:00' },
    ])
  })

  it('renvoie vide si la plage est invalide ou vide', () => {
    expect(decouper('10:00', '09:00', 60)).toEqual([])
    expect(decouper('09:00', '09:00', 60)).toEqual([])
    expect(decouper('09:00', '10:00', 0)).toEqual([])
  })

  it('ignore le reste quand la plage ne divise pas exactement', () => {
    const tours = decouper('09:00', '10:15', 60)
    expect(tours).toHaveLength(1)
    expect(tours[0]).toEqual({ debut: '09:00', fin: '10:00' })
  })
})

describe('joursDeSession', () => {
  it('énumère les jours entre debut et fin inclus', () => {
    const j = joursDeSession('2026-08-24', '2026-08-28')
    expect(j).toEqual([
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27',
      '2026-08-28',
    ])
  })

  it('gère un jour unique', () => {
    expect(joursDeSession('2026-08-24', '2026-08-24')).toEqual(['2026-08-24'])
  })

  it('gère un changement de mois', () => {
    const j = joursDeSession('2026-08-30', '2026-09-02')
    expect(j).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02'])
  })
})

describe('genererCreneaux', () => {
  const lieu = Lieu.parse({
    id: 'demo',
    nom: 'Site de démo',
    salles: [
      { id: 'A', nom: 'Salle A', jauge: 8 },
      { id: 'B', nom: 'Salle B', jauge: 5 },
    ],
  })

  it('déploie une règle quotidienne sur les jours de la session', () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-26',
      date_butoir: '2026-08-27',
      grille: [{ debut: '09:00', fin: '10:00' }],
    })
    const c = genererCreneaux(session, lieu)
    expect(c).toHaveLength(3)
    expect(c.every((x) => x.salles.length === 2)).toBe(true)
  })

  it("découpe une plage longue en tours d'une heure", () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-24',
      date_butoir: '2026-08-25',
      grille: [{ debut: '16:30', fin: '20:30', pas_minutes: 60 }],
    })
    const c = genererCreneaux(session, lieu)
    expect(c).toHaveLength(4)
    expect(c[0].debut).toBe('16:30')
    expect(c[3].debut).toBe('19:30')
  })

  it('restreint aux salles listées quand la règle précise', () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-24',
      date_butoir: '2026-08-25',
      grille: [{ debut: '09:00', fin: '10:00', salles: ['B'] }],
    })
    const c = genererCreneaux(session, lieu)
    expect(c).toHaveLength(1)
    expect(c[0].salles).toEqual(['B'])
  })

  it('applique le butoir : coupe les créneaux au-delà de la scène', () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-28',
      date_butoir: '2026-08-26',
      butoir_heure: '18:00',
      grille: [{ debut: '09:00', fin: '10:00' }, { debut: '19:00', fin: '20:00' }],
    })
    const c = genererCreneaux(session, lieu)
    // 24, 25, 26 (matin uniquement pour le 26)
    expect(c.map((x) => x.id)).toEqual([
      '2026-08-24T0900',
      '2026-08-24T1900',
      '2026-08-25T0900',
      '2026-08-25T1900',
      '2026-08-26T0900',
    ])
  })

  it('bloque une plage via une règle bloque=true (exception)', () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-26',
      date_butoir: '2026-08-27',
      grille: [
        { debut: '09:00', fin: '10:00' },
        { jours: ['2026-08-25'], debut: '09:00', fin: '10:00', bloque: true },
      ],
    })
    const c = genererCreneaux(session, lieu)
    expect(c.map((x) => x.date)).toEqual(['2026-08-24', '2026-08-26'])
  })

  it('ignore les salles inactives', () => {
    const lieuAvecInactif = Lieu.parse({
      id: 'demo',
      nom: 'Site',
      salles: [
        { id: 'A', nom: 'A', jauge: 8 },
        { id: 'B', nom: 'B', jauge: 5, actif: false },
      ],
    })
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-24',
      date_butoir: '2026-08-25',
      grille: [{ debut: '09:00', fin: '10:00' }],
    })
    const c = genererCreneaux(session, lieuAvecInactif)
    expect(c[0].salles).toEqual(['A'])
  })

  it('trie les créneaux chronologiquement', () => {
    const session = Session.parse({
      id: 's',
      nom: 'Test',
      lieu_id: 'demo',
      date_debut: '2026-08-24',
      date_fin: '2026-08-25',
      date_butoir: '2026-08-26',
      grille: [{ debut: '13:30', fin: '14:30' }, { debut: '09:00', fin: '10:00' }],
    })
    const c = genererCreneaux(session, lieu)
    const ids = c.map((x) => x.id)
    expect(ids).toEqual([...ids].sort())
  })
})
