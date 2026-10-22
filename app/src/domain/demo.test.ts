/**
 * #195 : la démo publique était vide depuis septembre (dates figées au
 * 24-28/08/2026, « Session terminée » sans `?maintenant=`).
 */
import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/apero_mercredi.json'
import { creneauxAvantButoir, genererCreneaux } from './grille'
import { datesSessionDemo } from './demo'
import { parseLegacyInscriptions } from './legacy'
import { migrerInscriptions } from './migrate'
import { Lieu, Session } from './model'

const lieu = Lieu.parse({
  id: 'mf', nom: 'MF',
  salles: [
    { id: 'le-garage', nom: 'Le Garage', jauge: 10 },
    { id: 'xveme', nom: 'XVème', jauge: 10 },
    { id: 'les-clapiers', nom: 'Les Clapiers', jauge: 10 },
    { id: 'l-esperance', nom: "L'Espérance", jauge: 6 },
    { id: 'la-chenaie', nom: 'La Chênaie', jauge: 6 },
  ],
})
const sessionDemo = (reference: Date, fixee: boolean) =>
  Session.parse({
    id: 'session-5', nom: 'S', lieu_id: 'mf',
    ...datesSessionDemo(reference, fixee),
    butoir_heure: '18:30',
    grille: [
      { debut: '09:00', fin: '11:59', pas_minutes: 60 },
      { debut: '13:30', fin: '18:29', pas_minutes: 60 },
      { debut: '22:00', fin: '23:59', pas_minutes: 60 },
    ],
    repetitions_visees: 3,
  })

describe('datesSessionDemo — sans ?maintenant= : le lundi suivant, strictement après aujourd\'hui', () => {
  it('un jeudi : le lundi suivant, butoir le mercredi, fin le vendredi', () => {
    expect(datesSessionDemo(new Date(2026, 9, 22, 23, 0), false)).toEqual({
      date_debut: '2026-10-26', date_butoir: '2026-10-28', date_fin: '2026-10-30',
    })
  })
  it('un lundi : le lundi d\'après, jamais ce lundi même', () => {
    expect(datesSessionDemo(new Date(2026, 9, 26, 8, 0), false).date_debut).toBe('2026-11-02')
  })
  it('un dimanche : le lendemain', () => {
    expect(datesSessionDemo(new Date(2026, 9, 25, 20, 0), false).date_debut).toBe('2026-10-26')
  })
  it('changement de mois et d\'année', () => {
    expect(datesSessionDemo(new Date(2026, 11, 31, 12, 0), false)).toEqual({
      date_debut: '2027-01-04', date_butoir: '2027-01-06', date_fin: '2027-01-08',
    })
  })
  it('le butoir apéro tombe toujours un mercredi (« vraie ou absente », lecture Leader)', () => {
    for (let j = 1; j <= 14; j++) {
      const { date_butoir } = datesSessionDemo(new Date(2026, 9, j, 12, 0), false)
      const [y, m, d] = date_butoir.split('-').map(Number)
      expect(new Date(y, m - 1, d).getDay()).toBe(3)
    }
  })
})

describe('datesSessionDemo — avec ?maintenant= : le lundi de sa semaine, montages d\'origine intacts', () => {
  it.each([['2026-08-24T08:00'], ['2026-08-27T08:00'], ['2026-08-28T10:00']])('%s redonne la démo du 24-28/08/2026', (iso) => {
    expect(datesSessionDemo(new Date(iso), true)).toEqual({
      date_debut: '2026-08-24', date_butoir: '2026-08-26', date_fin: '2026-08-28',
    })
  })
})

describe('la démo ne se périme plus (test au jour réel, sans maintenant fixé)', () => {
  it('au présent réel : des créneaux, et des créneaux avant le butoir apéro', () => {
    const maintenant = new Date()
    const session = sessionDemo(maintenant, false)
    const creneaux = genererCreneaux(session, lieu, { maintenant })
    expect(creneaux.length).toBeGreaterThan(0)
    expect(creneauxAvantButoir(session, 'apero_mercredi', creneaux).length).toBeGreaterThan(0)
    expect(migrerInscriptions(parseLegacyInscriptions(fixture), session.id).groupes.length).toBeGreaterThan(0)
  })
})
