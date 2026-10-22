/**
 * `descriptionBlocage` (#151, CD 2026-10-22) — la ligne « Cette règle compte
 * maintenant : elle bloque … » doit dire ce que `indispoBloque` bloque
 * réellement. Chaque libellé est confronté au prédicat sur des créneaux.
 */
import { describe, expect, it } from 'vitest'
import type { Creneau } from '../domain/grille'
import type { Indispo, Personne } from '../domain/model'
import { descriptionBlocage, indispoBloque } from './indispo'

const mardi = '2026-08-25'
const cr = (debut: string, fin: string, date = mardi): Creneau => ({ id: 'c', date, debut, fin, salles: [] }) as unknown as Creneau
const pers = (ind: Indispo): Personne =>
  ({ id: 'p', nom: 'Léa', discriminant: '', instruments: [], role: 'musicien', indispos: [ind] }) as Personne
const ind = (o: Partial<Indispo>): Indispo => ({ jours: [], roles: [], motif: '', saisie_editeur: true, ...o }) as Indispo

describe('descriptionBlocage', () => {
  it('« arrive mardi midi » marqué : toute la journée du mardi — et indispoBloque confirme', () => {
    const i = ind({ jours: ['mardi'], motif: 'arrive mardi midi' })
    expect(descriptionBlocage(i)).toBe('mardi, toute la journée')
    expect(indispoBloque(pers(i), cr('09:00', '10:00'), [])).toBe(true)
    expect(indispoBloque(pers(i), cr('22:00', '23:00'), [])).toBe(true)
  })

  it('début + durée : plage, et rien hors plage', () => {
    const i = ind({ jours: ['mardi'], debut: '12:00', duree_minutes: 90 })
    expect(descriptionBlocage(i)).toBe('mardi, 12:00 pendant 1h30')
    expect(indispoBloque(pers(i), cr('13:00', '14:00'), [])).toBe(true)
    expect(indispoBloque(pers(i), cr('14:00', '15:00'), [])).toBe(false)
  })

  it('début seul : le créneau qui démarre pile à cette heure', () => {
    const i = ind({ jours: ['mardi'], debut: '09:00' })
    expect(descriptionBlocage(i)).toBe('mardi, le créneau de 09:00')
    expect(indispoBloque(pers(i), cr('09:00', '10:00'), [])).toBe(true)
    expect(indispoBloque(pers(i), cr('10:00', '11:00'), [])).toBe(false)
  })

  it('rôles et jours vides', () => {
    const i = ind({ roles: ['chant'], debut: '09:00', duree_minutes: 60 })
    expect(descriptionBlocage(i)).toBe('tous les jours de la session, 09:00 pendant 1h, pour chant')
    expect(indispoBloque(pers(i), cr('09:00', '10:00'), ['piano'])).toBe(false)
  })

  it('durée courte en minutes', () => {
    expect(descriptionBlocage(ind({ jours: [mardi], debut: '09:00', duree_minutes: 45 }))).toBe(`${mardi}, 09:00 pendant 45 min`)
  })
})
