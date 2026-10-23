/** #202 : convention d'accord tranchée par #196 — singulier à 0 et à 1. */
import { expect, it } from 'vitest'
import { accord } from './accord'

it('singulier à 0 et à 1, pluriel au-delà', () => {
  expect([0, 1, 2, 12].map((n) => `${n} ${accord(n, 'groupe')}`)).toEqual(['0 groupe', '1 groupe', '2 groupes', '12 groupes'])
})

it('pluriel irrégulier et groupe nom + adjectif', () => {
  expect(accord(0, 'créneau généré', 'créneaux générés')).toBe('créneau généré')
  expect(accord(50, 'créneau généré', 'créneaux générés')).toBe('créneaux générés')
})
