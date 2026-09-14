import { describe, expect, it } from 'vitest'
import { parseMaintenantUrlParam, propositionRejouer } from './maintenant'

describe('parseMaintenantUrlParam', () => {
  it('retourne null quand le paramètre est absent', () => {
    expect(parseMaintenantUrlParam(null)).toBeNull()
    expect(parseMaintenantUrlParam(undefined)).toBeNull()
    expect(parseMaintenantUrlParam('')).toBeNull()
    expect(parseMaintenantUrlParam('  ')).toBeNull()
  })

  it('accepte un format date-seule `YYYY-MM-DD` (midi local par défaut)', () => {
    // Midi local évite les frontières matin/soir qui rendraient le filtre
    // imprévisible selon la timezone de l'utilisateur (CD 6777).
    const d = parseMaintenantUrlParam('2026-08-23')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(7) // 0-indexed → août
    expect(d!.getDate()).toBe(23)
    expect(d!.getHours()).toBe(12)
    expect(d!.getMinutes()).toBe(0)
  })

  it('accepte un format date+heure `YYYY-MM-DDTHH:MM`', () => {
    const d = parseMaintenantUrlParam('2026-08-23T14:30')
    expect(d).not.toBeNull()
    expect(d!.getFullYear()).toBe(2026)
    expect(d!.getMonth()).toBe(7)
    expect(d!.getDate()).toBe(23)
    expect(d!.getHours()).toBe(14)
    expect(d!.getMinutes()).toBe(30)
  })

  it('retourne null sur un format invalide', () => {
    // Chaînes non reconnues comme date : `hier`, format US, etc.
    expect(parseMaintenantUrlParam('hier')).toBeNull()
    expect(parseMaintenantUrlParam('23/08/2026')).toBeNull()
    expect(parseMaintenantUrlParam('2026')).toBeNull()
  })

  it('retourne null sur une date impossible', () => {
    // `2026-02-30` produit une Date invalide sur `new Date(...)` — bord
    // à vérifier pour ne pas laisser passer un « faux présent » lié à
    // une saisie utilisateur maladroite.
    expect(parseMaintenantUrlParam('2026-02-30')).toBeNull()
  })
})

describe('propositionRejouer', () => {
  it('retourne null si la session finit dans le futur', () => {
    expect(propositionRejouer('2026-10-01', '2026-10-05', '2026-09-14')).toBeNull()
  })

  it('retourne null si la session finit aujourd’hui (inclus)', () => {
    // Une session qui se termine le jour même reste rejouable en temps
    // réel — pas de proposition.
    expect(propositionRejouer('2026-09-10', '2026-09-14', '2026-09-14')).toBeNull()
  })

  it('propose la veille de date_debut si dateFin est passée', () => {
    const p = propositionRejouer('2026-08-24', '2026-08-30', '2026-09-14')
    expect(p).not.toBeNull()
    expect(p!.dateFin).toBe('2026-08-30')
    expect(p!.dateProposee).toBe('2026-08-23')
  })

  it('gère le passage de mois pour la veille de date_debut', () => {
    // Session commence le 1er septembre → veille = 31 août.
    const p = propositionRejouer('2026-09-01', '2026-09-05', '2026-10-01')
    expect(p).not.toBeNull()
    expect(p!.dateProposee).toBe('2026-08-31')
  })

  it('gère le passage d’année pour la veille de date_debut', () => {
    // Session commence le 1er janvier → veille = 31 décembre de l’année N−1.
    const p = propositionRejouer('2027-01-01', '2027-01-03', '2027-02-01')
    expect(p).not.toBeNull()
    expect(p!.dateProposee).toBe('2026-12-31')
  })
})
