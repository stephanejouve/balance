import { describe, expect, it } from 'vitest'
import type { Creneau } from '../domain/grille'
import type { Personne } from '../domain/model'
import { estIndispoInterpretable, indispoBloque } from './indispo'

const personne = (indispos: Personne['indispos']): Personne => ({
  id: 'p',
  nom: 'P',
  discriminant: '',
  instruments: [],
  role: 'musicien',
  indispos,
})

const creneau = (debut: string, fin: string, date = '2026-08-28'): Creneau => ({
  id: `${date}-${debut}`,
  date,
  debut,
  fin,
  salles: ['s1'],
})

describe('indispoBloque — cas de base', () => {
  it('journée entière (ni debut ni fin) bloque tous les créneaux du jour ciblé', () => {
    const p = personne([{ jours: ['2026-08-28'], roles: [], motif: 'RDV médecin' }])
    expect(indispoBloque(p, creneau('09:00', '10:00'), [])).toBe(true)
    expect(indispoBloque(p, creneau('16:00', '17:00'), [])).toBe(true)
    // Autre jour → OK
    expect(indispoBloque(p, creneau('09:00', '10:00', '2026-08-29'), [])).toBe(false)
  })

  it('debut seul → match exact début créneau (compat legacy prototype)', () => {
    const p = personne([{ jours: [], debut: '09:00', roles: [], motif: '' }])
    expect(indispoBloque(p, creneau('09:00', '10:00'), [])).toBe(true)
    expect(indispoBloque(p, creneau('09:30', '10:30'), [])).toBe(false) // pas exact
    expect(indispoBloque(p, creneau('10:00', '11:00'), [])).toBe(false)
  })
})

describe('indispoBloque — intersection partielle (fix bug audit Leader)', () => {
  const p = personne([{ jours: [], debut: '09:00', fin: '11:00', roles: [], motif: '' }])

  it('créneau inclus dans l\'indispo → bloque', () => {
    expect(indispoBloque(p, creneau('09:00', '10:00'), [])).toBe(true)
    expect(indispoBloque(p, creneau('10:00', '11:00'), [])).toBe(true)
  })

  it('créneau chevauchant le début de l\'indispo (BUG historique) → bloque', () => {
    // 08:30-09:30 intersecte [09:00, 09:30[ avec l'indispo 09:00-11:00
    // Ancien code : c.debut < ind.debut → return false → NON BLOQUÉ (bug)
    // Nouveau code : intersection non vide → BLOQUÉ ✓
    expect(indispoBloque(p, creneau('08:30', '09:30'), [])).toBe(true)
  })

  it('créneau chevauchant la fin de l\'indispo → bloque', () => {
    // 10:30-11:30 intersecte [10:30, 11:00[
    expect(indispoBloque(p, creneau('10:30', '11:30'), [])).toBe(true)
  })

  it('créneau qui englobe l\'indispo → bloque', () => {
    // 08:00-12:00 englobe entièrement 09:00-11:00
    expect(indispoBloque(p, creneau('08:00', '12:00'), [])).toBe(true)
  })

  it('créneau collé au début de l\'indispo (touche mais ne chevauche pas) → OK', () => {
    // 08:00-09:00 : c.fin === ind.debut → intersection vide
    expect(indispoBloque(p, creneau('08:00', '09:00'), [])).toBe(false)
  })

  it('créneau collé à la fin de l\'indispo (touche mais ne chevauche pas) → OK', () => {
    // 11:00-12:00 : c.debut === ind.fin → intersection vide
    expect(indispoBloque(p, creneau('11:00', '12:00'), [])).toBe(false)
  })

  it('créneau totalement en dehors → OK', () => {
    expect(indispoBloque(p, creneau('14:00', '15:00'), [])).toBe(false)
    expect(indispoBloque(p, creneau('06:00', '07:00'), [])).toBe(false)
  })
})

describe('indispoBloque — filtrage par rôle', () => {
  const p = personne([{ jours: [], debut: '09:00', fin: '10:00', roles: ['chant'], motif: '' }])

  it('bloque si un pupitre du créneau matche le rôle ciblé', () => {
    expect(indispoBloque(p, creneau('09:00', '10:00'), ['chant'])).toBe(true)
    expect(indispoBloque(p, creneau('09:00', '10:00'), ['chant', 'piano'])).toBe(true)
  })

  it('ne bloque pas si aucun pupitre ne matche le rôle ciblé', () => {
    expect(indispoBloque(p, creneau('09:00', '10:00'), ['piano'])).toBe(false)
    expect(indispoBloque(p, creneau('09:00', '10:00'), [])).toBe(false)
  })
})

describe('indispoBloque — filtrage par jour', () => {
  const p = personne([
    { jours: ['2026-08-28'], debut: '09:00', fin: '10:00', roles: [], motif: '' },
  ])

  it('bloque uniquement le jour ciblé', () => {
    expect(indispoBloque(p, creneau('09:00', '10:00', '2026-08-28'), [])).toBe(true)
    expect(indispoBloque(p, creneau('09:00', '10:00', '2026-08-29'), [])).toBe(false)
  })
})

// ─── estIndispoInterpretable + garde-fou "convalescence" ──────────────────
// Bug smoke Stéphane 2026-09-03 #1 : Olivier (B) avait `motif = "convalescence"`
// (texte libre sans horaire, sans jour, sans rôle) → indispoBloque retournait
// true sur TOUS les créneaux → 0 offre → placement impossible. Arbitrage
// Stéphane 2026-09-02 : une indispo non interprétable ne contraint rien.

describe('estIndispoInterpretable', () => {
  it('non interprétable : ni jour ni horaire ni rôle (« convalescence »)', () => {
    expect(estIndispoInterpretable({ jours: [], roles: [], motif: 'convalescence' })).toBe(false)
    expect(estIndispoInterpretable({ jours: [], roles: [], motif: 'en arrêt maladie' })).toBe(false)
  })

  it('interprétable : jours seuls (« absent lundi »)', () => {
    // Nuance critique Stéphane 2026-09-02 : sans horaire mais avec jours → OK
    expect(
      estIndispoInterpretable({ jours: ['lundi'], roles: [], motif: 'absent lundi' }),
    ).toBe(true)
    expect(
      estIndispoInterpretable({ jours: ['2026-08-25'], roles: [], motif: '' }),
    ).toBe(true)
  })

  it('interprétable : horaire seul (« 9h-10h »)', () => {
    expect(
      estIndispoInterpretable({ jours: [], debut: '09:00', fin: '10:00', roles: [], motif: '' }),
    ).toBe(true)
    expect(estIndispoInterpretable({ jours: [], debut: '09:00', roles: [], motif: '' })).toBe(true)
  })

  it('interprétable : rôle seul', () => {
    expect(estIndispoInterpretable({ jours: [], roles: ['batterie'], motif: '' })).toBe(true)
  })
})

describe('indispoBloque — garde-fou "convalescence" (bug smoke #1)', () => {
  it('indispo non interprétable → ne bloque aucun créneau', () => {
    const p = personne([{ jours: [], roles: [], motif: 'convalescence' }])
    expect(indispoBloque(p, creneau('09:00', '10:00'), [])).toBe(false)
    expect(indispoBloque(p, creneau('16:00', '17:00', '2026-08-29'), [])).toBe(false)
  })

  it('« absent lundi » (jours seuls, sans horaire) → bloque bien tous les créneaux du lundi', () => {
    // Nuance critique Stéphane : le vrai critère de rejet est absence
    // d'horaire ET absence de jour. Un jour précisé sans horaire reste
    // valide et doit bloquer.
    const p = personne([{ jours: ['2026-08-25'], roles: [], motif: 'absent lundi' }])
    expect(indispoBloque(p, creneau('09:00', '10:00', '2026-08-25'), [])).toBe(true)
    expect(indispoBloque(p, creneau('14:00', '15:00', '2026-08-25'), [])).toBe(true)
    // Autre jour → OK
    expect(indispoBloque(p, creneau('09:00', '10:00', '2026-08-26'), [])).toBe(false)
  })
})
