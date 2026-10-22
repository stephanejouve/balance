/**
 * #151 option B (arbitrage CD 2026-10-22) — marqueur `saisie_editeur`.
 *
 * Invariants verrouillés :
 *  1. une saisie de l'éditeur (jours / horaire / rôles en champs, motif
 *     libellé) n'est plus soumise au check de résidu → elle bloque ;
 *  2. l'ABSENCE de marqueur conserve exactement le comportement antérieur
 *     (parser texte, migrate legacy) — « migrate ne marque rien » ;
 *  3. le marqueur survit au round-trip JSON (reprise de session).
 */
import { describe, expect, it } from 'vitest'
import type { Creneau } from '../domain/grille'
import { parseLegacyInscriptions } from '../domain/legacy'
import { migrerInscriptions } from '../domain/migrate'
import { Indispo, type Personne } from '../domain/model'
import { construireCandidatJson } from '../io/import-detection'
import { parserIndispoLibre } from '../io/stagiaires-adapter'
import { estIndispoInterpretable, indispoBloque } from './indispo'
// eslint-disable-next-line import/no-relative-parent-imports
import apero from '../fixtures/apero_mercredi.json'

const personne = (indispos: Personne['indispos']): Personne =>
  ({ id: 'p', nom: 'P', discriminant: '', instruments: [], role: 'musicien', indispos }) as Personne
// 2026-08-25 est un mardi
const creneauMardi: Creneau = { id: '2026-08-25T0900', date: '2026-08-25', debut: '09:00', fin: '10:00', salles: [] }

describe('saisie_editeur — marqueur de provenance (#151)', () => {
  it('saisie éditeur « mardi, motif kiné » : interprétable ET bloque le mardi', () => {
    const ind = { jours: ['mardi'], roles: [], motif: 'kiné', saisie_editeur: true }
    expect(estIndispoInterpretable(ind)).toBe(true)
    expect(indispoBloque(personne([ind]), creneauMardi, ['chant'])).toBe(true)
  })

  it('contre-exemple : la même règle SANS marqueur reste ignorée (comportement antérieur)', () => {
    const ind = { jours: ['mardi'], roles: [], motif: 'kiné' }
    expect(estIndispoInterpretable(ind)).toBe(false)
    expect(indispoBloque(personne([ind]), creneauMardi, ['chant'])).toBe(false)
  })

  it('saisie éditeur début sans durée + rôle + motif : interprétable', () => {
    expect(estIndispoInterpretable({ jours: [], debut: '09:00', roles: ['chant'], motif: 'RDV médecin', saisie_editeur: true })).toBe(true)
  })

  it('le marqueur ne rend pas interprétable une règle sans aucun champ', () => {
    expect(estIndispoInterpretable({ jours: [], roles: [], motif: 'convalescence', saisie_editeur: true })).toBe(false)
  })

  it('parser texte : ne pose jamais le marqueur, « arrive mardi midi » reste ignorée', () => {
    const ind = parserIndispoLibre('arrive mardi midi')!
    expect(ind.saisie_editeur).toBeUndefined()
    expect(estIndispoInterpretable(ind)).toBe(false)
  })

  it('migrate ne marque rien : les indispos legacy de la démo restent ignorées', () => {
    const insc = migrerInscriptions(parseLegacyInscriptions(apero), 'session-5')
    const indispos = insc.personnes.flatMap((p) => p.indispos)
    expect(indispos.length).toBeGreaterThan(0)
    for (const ind of indispos) {
      expect(ind.saisie_editeur).toBeUndefined()
      expect(estIndispoInterpretable(ind)).toBe(false)
    }
  })

  it('schéma Indispo : le marqueur est un champ connu, conservé au parse', () => {
    const apres = Indispo.parse({ jours: ['2026-08-25'], roles: [], motif: 'kiné', saisie_editeur: true })
    expect(apres.saisie_editeur).toBe(true)
  })

  it('reprise de session JSON réelle (construireCandidatJson) : le marqueur est conservé', () => {
    const insc = {
      session_id: 's', groupes: [], imposes: [], refus: [],
      personnes: [personne([{ jours: ['mardi'], roles: [], motif: 'kiné', saisie_editeur: true }])],
    }
    const out = construireCandidatJson(
      { type: 'json', nomFichier: 'x.json', taille: 0, warningsGlobaux: [],
        payload: { inscriptions: JSON.parse(JSON.stringify(insc)) } },
      's',
    )
    const ind = out.inscriptions!.personnes[0].indispos[0]
    expect(ind.saisie_editeur).toBe(true)
    expect(estIndispoInterpretable(ind)).toBe(true)
  })
})
