import { describe, expect, it } from 'vitest'
import { detacherNomInstrument, parseLegacyInscriptions } from './legacy'
import fixtureRaw from '../fixtures/apero_mercredi.json'

describe('parseLegacyInscriptions', () => {
  it('lit le jeu réel apero_mercredi (session 5)', () => {
    const d = parseLegacyInscriptions(fixtureRaw)
    expect(d.groupes.length).toBe(13)
    expect(d.identitesConnues.length).toBeGreaterThan(0)
    expect(d.indispos.length).toBe(1)
    expect(d.indispos[0].roles).toEqual(['chant'])
  })

  it('assigne des defaults pour les champs manquants', () => {
    const d = parseLegacyInscriptions({
      groupes: [{ nom: 'Test', membres: ['Alice (chant)'] }],
    })
    expect(d.groupes[0].resp).toBe('')
    expect(d.groupes[0].cherche).toBe('')
    expect(d.membresImposes).toEqual({})
    expect(d.indispos).toEqual([])
    expect(d.identitesConnues).toEqual([])
  })
})

describe('detacherNomInstrument', () => {
  it('sépare nom et instrument reconnu', () => {
    expect(detacherNomInstrument('Colette (piano)')).toEqual({
      nom: 'Colette',
      instrument: 'piano',
    })
  })

  it("conserve la parenthèse dans le nom quand ce n'est pas un instrument", () => {
    // Piège prototype : `Pierre (SIG)` et `Emmanuelle (B)` distinguent des
    // homonymes, pas des instruments — donc la parenthèse reste dans le nom.
    expect(detacherNomInstrument('Pierre (SIG)')).toEqual({
      nom: 'Pierre (SIG)',
      instrument: '',
    })
    expect(detacherNomInstrument('Emmanuelle (B)')).toEqual({
      nom: 'Emmanuelle (B)',
      instrument: '',
    })
  })

  it('gère les instruments avec accents et pluriel', () => {
    expect(detacherNomInstrument('Marianne (flûte)').instrument).toBe('flûte')
    expect(detacherNomInstrument('Pascal (vents)').instrument).toBe('vents')
  })

  it('normalise les espaces', () => {
    expect(detacherNomInstrument('  Colette   (piano)  ')).toEqual({
      nom: 'Colette',
      instrument: 'piano',
    })
  })
})
