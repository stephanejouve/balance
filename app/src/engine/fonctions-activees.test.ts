import { describe, expect, it } from 'vitest'
import { FonctionsActivees, Lieu } from '../domain/model'
import type { Inscriptions } from '../domain/model'
import {
  normaliserFonctionsActivees,
  preparerInscriptionsPourSolveur,
} from './fonctions-activees'

describe('FonctionsActivees — piège migration', () => {
  it('un JSON hérité SANS champ fonctionsActivees → tout à true (comportement inchangé)', () => {
    // Reproduit le cas exact du piège du brief : un `.json` enregistré
    // avant cette version n'a pas ce champ. Si le défaut n'était pas
    // `true`, la session rouvrirait en perdant silencieusement ses
    // contraintes — exactement le défaut qu'on cherche à éviter, à
    // l'envers.
    const lieu = Lieu.parse({
      id: 'l',
      nom: 'L',
      salles: [{ id: 's1', nom: 's1', jauge: 10 }],
    })
    expect(lieu.fonctionsActivees).toEqual({
      proposes: true,
      conducteur: true,
      ordre_passage: true,
      charge: true,
      renforts: true,
    })
  })

  it('un JSON hérité avec fonctionsActivees partiel → complète les manquants à true', () => {
    const lieu = Lieu.parse({
      id: 'l',
      nom: 'L',
      salles: [],
      fonctionsActivees: { proposes: false },
    })
    expect(lieu.fonctionsActivees.proposes).toBe(false)
    // Les autres champs conservent leur défaut true
    expect(lieu.fonctionsActivees.conducteur).toBe(true)
    expect(lieu.fonctionsActivees.charge).toBe(true)
  })

  it('FonctionsActivees.parse({}) retourne les 5 champs à true', () => {
    const f = FonctionsActivees.parse({})
    expect(f).toEqual({
      proposes: true,
      conducteur: true,
      ordre_passage: true,
      charge: true,
      renforts: true,
    })
  })
})

describe('normaliserFonctionsActivees — dépendances entre bascules', () => {
  it('conducteur implique ordre_passage — force à true si incohérent', () => {
    const f = FonctionsActivees.parse({ conducteur: true, ordre_passage: false })
    const norm = normaliserFonctionsActivees(f)
    expect(norm.ordre_passage).toBe(true)
    expect(norm.conducteur).toBe(true)
  })

  it("laisse l'état intact si cohérent (conducteur=false, ordre_passage=false)", () => {
    const f = FonctionsActivees.parse({ conducteur: false, ordre_passage: false })
    expect(normaliserFonctionsActivees(f)).toEqual(f)
  })

  it("laisse l'état intact quand tout à true (cas par défaut)", () => {
    const f = FonctionsActivees.parse({})
    expect(normaliserFonctionsActivees(f)).toEqual(f)
  })

  it("ne mute pas l'entrée (retour = nouvel objet quand normalisation)", () => {
    const f = FonctionsActivees.parse({ conducteur: true, ordre_passage: false })
    const orig = { ...f }
    normaliserFonctionsActivees(f)
    expect(f).toEqual(orig)
  })
})

describe('preparerInscriptionsPourSolveur — cascade solveur', () => {
  const inscBase: Inscriptions = {
    session_id: 's',
    personnes: [],
    groupes: [],
    imposes: [
      {
        id: 'imp1',
        morceau: 'Concert vendredi',
        membres: ['alice'],
        seances: [{ date: '2026-08-28', debut: '14:00', fin: '15:00' }],
      },
    ],
  }
  const lieuBase = Lieu.parse({
    id: 'l',
    nom: 'L',
    salles: [{ id: 's1', nom: 's1', jauge: 10 }],
  })

  it("par défaut (proposes=true) : imposés préservés dans le pipeline solveur", () => {
    const out = preparerInscriptionsPourSolveur(inscBase, lieuBase)
    expect(out.imposes).toHaveLength(1)
    // Structural sharing : rien à filtrer → même référence
    expect(out).toBe(inscBase)
  })

  it("proposes=false : imposés vidés — le solveur ne voit plus les contraintes", () => {
    const lieu = { ...lieuBase, fonctionsActivees: { ...lieuBase.fonctionsActivees, proposes: false } }
    const out = preparerInscriptionsPourSolveur(inscBase, lieu)
    expect(out.imposes).toEqual([])
    // Le reste des inscriptions est préservé
    expect(out.personnes).toBe(inscBase.personnes)
    expect(out.groupes).toBe(inscBase.groupes)
  })

  it("proposes=false ne mute pas l'inscription originale", () => {
    const lieu = { ...lieuBase, fonctionsActivees: { ...lieuBase.fonctionsActivees, proposes: false } }
    const imposesAvant = inscBase.imposes
    preparerInscriptionsPourSolveur(inscBase, lieu)
    expect(inscBase.imposes).toBe(imposesAvant)
    expect(inscBase.imposes).toHaveLength(1)
  })
})
