/**
 * Lot dates (#172 + #173, arbitrage CD 2026-10-22).
 *
 * #173 : l'interface affiche JJ/MM/AAAA depuis #162, l'utilisateur recopie
 * ce qu'il voit. « 25/08/2026 » était ignoré en silence (0 créneau en
 * grille, aucune indispo bloquée) et la ligne « compte maintenant »
 * certifiait le contraire. Désormais : accepté et normalisé, et tout jour
 * illisible est signalé.
 *
 * #172 : les onglets de résultats affichaient MM/JJ (« 11/03 » pour le
 * 3 novembre). Garde-fou source : plus aucun gabarit mois/jour fait main.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Creneau } from './grille'
import {
  afficherSaisieJours,
  dateCourteFr,
  genererCreneaux,
  joursNonReconnus,
  lireSaisieJours,
  normaliserJourSaisi,
} from './grille'
import { Lieu, Session, type Indispo, type Personne } from './model'
import { descriptionBlocage, indispoBloque, raisonIndispoIgnoree } from '../engine/indispo'

describe('normaliserJourSaisi', () => {
  it.each([
    ['2026-08-25', '2026-08-25'],
    ['25/08/2026', '2026-08-25'],
    ['5/8/2026', '2026-08-05'],
    ['25.08.2026', '2026-08-25'],
    ['25-08-2026', '2026-08-25'],
    ['Mardi', 'mardi'],
    ['mércredi', 'mercredi'],
  ])('« %s » → %s', (saisi, attendu) => {
    expect(normaliserJourSaisi(saisi)).toBe(attendu)
  })

  it.each(['25/13/2026', '31/02/2026', '2026-02-30', 'lundo', '25/08', ''])('« %s » → non reconnu', (saisi) => {
    expect(normaliserJourSaisi(saisi)).toBeNull()
  })

  it('le champ stocke la forme canonique, garde l\'illisible tel quel, et réaffiche en JJ/MM/AAAA', () => {
    const stocke = lireSaisieJours('25/08/2026, Mardi, lundo')
    expect(stocke).toEqual(['2026-08-25', 'mardi', 'lundo'])
    expect(joursNonReconnus(stocke)).toEqual(['lundo'])
    expect(afficherSaisieJours(stocke)).toBe('25/08/2026, mardi, lundo')
  })
})

describe('grille 2B — la date affichée est une date acceptée', () => {
  const lieu = Lieu.parse({ id: 'l', nom: 'l', salles: [{ id: 's', nom: 's', jauge: 10 }] })
  const avecJours = (jours: string[]) => {
    const s = Session.parse({
      id: 's', nom: 'n', lieu_id: 'l', date_debut: '2026-08-24', date_fin: '2026-08-28', date_butoir: '2026-08-28',
      grille: [{ debut: '09:00', fin: '11:59', pas_minutes: 60 }],
    })
    s.grille[0].jours = jours // ce que fait l'éditeur, sans passer par Zod
    return genererCreneaux(s, lieu)
  }

  it('« 25/08/2026 » produit les mêmes 3 créneaux que « 2026-08-25 » (0 avant #173)', () => {
    expect(avecJours(['25/08/2026']).map((c) => c.id)).toEqual(avecJours(['2026-08-25']).map((c) => c.id))
    expect(avecJours(['25/08/2026'])).toHaveLength(3)
  })

  it('jour illisible : aucun créneau pour cette règle (et l\'éditeur le signale, test de mount)', () => {
    expect(avecJours(['25/13/2026'])).toHaveLength(0)
  })
})

describe('indispo 1D — la phrase affichée confrontée à indispoBloque (garde-fou CD)', () => {
  const lieu = Lieu.parse({ id: 'l', nom: 'l', salles: [{ id: 's', nom: 's', jauge: 10 }] })
  const session = Session.parse({
    id: 's', nom: 'n', lieu_id: 'l', date_debut: '2026-08-24', date_fin: '2026-08-28', date_butoir: '2026-08-28',
    grille: [{ debut: '09:00', fin: '11:59', pas_minutes: 60 }],
  })
  const creneaux = genererCreneaux(session, lieu)
  const le = (date: string): Creneau => creneaux.find((c) => c.date === date)!
  const pers = (ind: Indispo) =>
    ({ id: 'p', nom: 'P', discriminant: '', instruments: [], role: 'musicien', indispos: [ind] }) as unknown as Personne
  const regle = (jours: string[]): Indispo => ({ jours, roles: [], motif: '', saisie_editeur: true }) as Indispo

  it.each(['25/08/2026', '2026-08-25', '25.08.2026'])('« %s » : la phrase dit 25/08/2026 ET la règle bloque le 25/08, pas le 26', (saisi) => {
    const ind = regle([saisi])
    expect(raisonIndispoIgnoree(ind)).toBeNull()
    expect(descriptionBlocage(ind)).toBe('25/08/2026, toute la journée')
    expect(indispoBloque(pers(ind), le('2026-08-25'), [])).toBe(true)
    expect(indispoBloque(pers(ind), le('2026-08-26'), [])).toBe(false)
  })

  it.each([
    ['25/13/2026', 'Date inexistante (« 25/13/2026 ») — la règle ne bloque rien. Pour que la règle compte : vérifiez le jour et le mois.'],
    ['31/02/2026', 'Date inexistante (« 31/02/2026 ») — la règle ne bloque rien. Pour que la règle compte : vérifiez le jour et le mois.'],
    ['lundo', 'Jour non reconnu (« lundo ») — la règle ne bloque rien. Pour que la règle compte : écrivez une date JJ/MM/AAAA ou un nom de jour.'],
  ])('« %s » : jamais « compte maintenant » — ignorée, raison et remède justes (#180), ne bloque rien', (saisi, raison) => {
    const ind = regle([saisi])
    expect(raisonIndispoIgnoree(ind)).toBe(raison)
    expect(creneaux.some((c) => indispoBloque(pers(ind), c, []))).toBe(false)
  })

  it('date lisible HORS session (« 25/08/2025 », review Leader #178) : la phrase ne la certifie pas, et rien n\'est bloqué', () => {
    const joursSession = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28']
    const ind = regle(['25/08/2025'])
    expect(descriptionBlocage(ind, joursSession)).not.toContain('25/08/2025')
    expect(creneaux.some((c) => indispoBloque(pers(ind), c, []))).toBe(false)
    const mixte = regle(['25/08/2025', '26/08/2026'])
    expect(descriptionBlocage(mixte, joursSession)).toBe('26/08/2026, toute la journée')
    expect([...new Set(creneaux.filter((c) => indispoBloque(pers(mixte), c, [])).map((c) => c.date))]).toEqual(['2026-08-26'])
  })

  it('mélange lisible / illisible : la phrase ne cite que ce qui bloque vraiment', () => {
    const ind = regle(['25/08/2026', 'lundo'])
    expect(raisonIndispoIgnoree(ind)).toBeNull()
    expect(descriptionBlocage(ind)).toBe('25/08/2026, toute la journée')
    const bloques = creneaux.filter((c) => indispoBloque(pers(ind), c, [])).map((c) => c.date)
    expect([...new Set(bloques)]).toEqual(['2026-08-25'])
  })
})

describe('#172 — dates courtes en JJ/MM dans les plannings', () => {
  it('dateCourteFr : jour puis mois — « 03/11 » pour le 3 novembre, pas « 11/03 »', () => {
    expect(dateCourteFr('2026-11-03')).toBe('03/11')
    expect(dateCourteFr('2026-08-24')).toBe('24/08')
  })

  it('garde-fou source : aucune vue n\'assemble plus mois/jour à la main', () => {
    const dir = join(__dirname, '..', 'vues')
    const fautifs = readdirSync(dir)
      .filter((f) => f.endsWith('.svelte'))
      .filter((f) => /\.date\.slice\(5\)/.test(readFileSync(join(dir, f), 'utf8')))
    expect(fautifs).toEqual([])
  })
})
