/**
 * Lot 2b #164 — créer les personnes citées sur décision (arbitrage CD
 * 2026-10-22). Pipeline d'import réel : `analyserSheetsExcel` →
 * `construireCandidatExcel` → `preparerCreation` → `appliquerCreation`.
 */
import { describe, expect, it } from 'vitest'
import { Inscriptions } from '../domain/model'
import { analyserIdentitesCandidat } from './alertes-import'
import { analyserSheetsExcel, construireCandidatExcel, personnesCiteesSelection } from './import-detection'
import { MAPPING_LISTE_DEFAUT } from './liste-adapter'
import { MAPPING_PROPOSES_DEFAUT } from './proposes-adapter'
import { MAPPING_STAGIAIRES_DEFAUT } from './stagiaires-adapter'
import {
  appliquerCreation,
  cleRapprochement,
  fusionsRetenues,
  preparerCreation,
  rapprochementsATrancher,
  type DecisionRapprochement,
} from './personnes-citees'

const ENTETE = ['Morceau', 'Auteur', 'Style', 'Tona', 'Resp', 'Chant', 'Piano', 'Basse', 'Batterie', 'Guitare', 'Vents', 'Cherche']
const ligne = (morceau: string, cases: Partial<Record<'Chant' | 'Piano' | 'Basse' | 'Batterie' | 'Guitare' | 'Vents', string>>) =>
  ENTETE.map((c) => (c === 'Morceau' ? morceau : (cases as Record<string, string>)[c] ?? ''))

function importer(lignes: unknown[][], stagiaires?: string[][]) {
  const sheets = [{ sheet: 'Liste', data: [ENTETE, ...lignes] }]
  if (stagiaires) sheets.push({ sheet: 'Stagiaires', data: [['Nom', 'Pupitre'], ...stagiaires] })
  const detection = analyserSheetsExcel(sheets, 'releve.xlsx', 1, { liste: MAPPING_LISTE_DEFAUT, stagiaires: MAPPING_STAGIAIRES_DEFAUT, proposes: MAPPING_PROPOSES_DEFAUT }, [])
  const selection = { ongletsCoches: new Set(sheets.map((s) => s.sheet)), destinationsManuelles: new Map() }
  const candidat = construireCandidatExcel(detection, selection, Inscriptions.parse({ session_id: 's', personnes: [], groupes: [] }), 's')
  return { candidat, citees: personnesCiteesSelection(detection, selection) }
}

const nomsAbsents = (insc: Inscriptions) =>
  analyserIdentitesCandidat(insc).alertes_coherence.filter((a) => a.type === 'nom_cite_absent_stagiaires').length

describe('preparerCreation — rien n\'est créé d\'office', () => {
  it('Liste seule : le candidat reste sans personne, la liste à créer est prête', () => {
    const { candidat, citees } = importer([
      ligne('Blue Bossa', { Chant: 'Sophie Mercier', Basse: 'Yann Le Goff' }),
      ligne('Johnny B. Goode', { Chant: 'Marc Di Stefano', Guitare: 'Marc Di Stefano' }),
    ])
    expect(candidat.personnes).toEqual([])
    const c = preparerCreation(candidat, citees)
    expect(c.a_creer.map((p) => p.id).sort()).toEqual(['marc-di-stefano', 'sophie-mercier', 'yann-le-goff'])
    expect(c.rapprochements).toEqual([])
  })

  it('le pupitre vient de la colonne, plusieurs colonnes donnent plusieurs pupitres', () => {
    const { candidat, citees } = importer([
      ligne('Johnny B. Goode', { Chant: 'Marc Di Stefano', Guitare: 'Marc Di Stefano', Vents: 'Olivier Rouanet (saxophone)' }),
    ])
    const c = preparerCreation(candidat, citees)
    const marc = c.a_creer.find((p) => p.id === 'marc-di-stefano')!
    expect(marc.instruments.map((i) => i.pupitre).sort()).toEqual(['chant', 'guitare'])
    const olivier = c.a_creer.find((p) => p.id === 'olivier-rouanet')!
    expect(olivier.instruments).toEqual([expect.objectContaining({ pupitre: 'vents', precision: 'saxophone' })])
  })
})

describe('preparerCreation — noms proches tranchés AVANT création', () => {
  it('deux citations à une lettre près : rapprochement, pas deux personnes silencieuses', () => {
    const { candidat, citees } = importer([
      ligne('Blue Bossa', { Chant: 'Hélène Barrault' }),
      ligne('Autumn Leaves', { Chant: 'Hélène Barault' }),
    ])
    const c = preparerCreation(candidat, citees)
    expect(c.rapprochements).toHaveLength(1)
    expect([c.rapprochements[0].cite.nom, c.rapprochements[0].proche.nom].sort()).toEqual(['Hélène Barault', 'Hélène Barrault'])
    expect(c.rapprochements[0].proche_declaree).toBe(false)
  })

  it('onglet Stagiaires présent, citation proche d\'une personne déclarée : rapprochement vers la déclarée', () => {
    const { candidat, citees } = importer([ligne('Blue Bossa', { Chant: 'Hélène Barault' })], [['Hélène Barrault', 'chant']])
    const c = preparerCreation(candidat, citees)
    expect(c.a_creer.map((p) => p.id)).toEqual(['helene-barault'])
    expect(c.rapprochements).toEqual([
      expect.objectContaining({ proche_declaree: true, proche: expect.objectContaining({ id: 'helene-barrault' }) }),
    ])
  })

  it('noms nettement différents : aucun rapprochement', () => {
    const { candidat, citees } = importer([ligne('Blue Bossa', { Chant: 'Sophie Mercier', Basse: 'Yann Le Goff' })])
    expect(preparerCreation(candidat, citees).rapprochements).toEqual([])
  })
})

describe('appliquerCreation', () => {
  it('sans rapprochement : les personnes sont créées et les signalements « absent » disparaissent', () => {
    const { candidat, citees } = importer([ligne('Blue Bossa', { Chant: 'Sophie Mercier', Basse: 'Yann Le Goff' })])
    expect(nomsAbsents(candidat)).toBe(2)
    const apres = appliquerCreation(candidat, preparerCreation(candidat, citees), new Map())
    expect(apres.personnes.map((p) => p.id).sort()).toEqual(['sophie-mercier', 'yann-le-goff'])
    expect(nomsAbsents(apres)).toBe(0)
    expect(candidat.personnes).toEqual([]) // pas de mutation
  })

  it('refuse de créer tant qu\'un rapprochement n\'est pas tranché', () => {
    const { candidat, citees } = importer([
      ligne('Blue Bossa', { Chant: 'Hélène Barrault' }),
      ligne('Autumn Leaves', { Chant: 'Hélène Barault' }),
    ])
    const c = preparerCreation(candidat, citees)
    expect(rapprochementsATrancher(c, new Map())).toHaveLength(1)
    expect(() => appliquerCreation(candidat, c, new Map())).toThrow(/non tranchés/)
  })

  it('« même personne » : une seule personne créée, les citations des deux orthographes la désignent', () => {
    const { candidat, citees } = importer([
      ligne('Blue Bossa', { Chant: 'Hélène Barrault' }),
      ligne('Autumn Leaves', { Piano: 'Hélène Barault' }),
    ])
    const c = preparerCreation(candidat, citees)
    const d = new Map<string, DecisionRapprochement>([[cleRapprochement(c.rapprochements[0]), { garder: 'helene-barrault' }]])
    const apres = appliquerCreation(candidat, c, d)
    expect(apres.personnes.map((p) => p.id)).toEqual(['helene-barrault'])
    // pupitre de l'orthographe fusionnée ajouté à la personne retenue
    expect(apres.personnes[0].instruments.map((i) => i.pupitre).sort()).toEqual(['chant', 'piano'])
    const ids = apres.groupes.flatMap((g) => g.membres.map((m) => m.personne_id))
    expect(ids).toEqual(['helene-barrault', 'helene-barrault'])
    expect(nomsAbsents(apres)).toBe(0)
  })

  it('« deux personnes » : les deux sont créées, aucune citation réécrite', () => {
    const { candidat, citees } = importer([
      ligne('Blue Bossa', { Chant: 'Tom Vidal' }),
      ligne('Autumn Leaves', { Chant: 'Tim Vidal' }),
    ])
    const c = preparerCreation(candidat, citees)
    expect(c.rapprochements).toHaveLength(1)
    const apres = appliquerCreation(candidat, c, new Map([[cleRapprochement(c.rapprochements[0]), 'distinctes' as const]]))
    expect(apres.personnes.map((p) => p.id).sort()).toEqual(['tim-vidal', 'tom-vidal'])
    expect(apres.groupes.map((g) => g.membres[0].personne_id)).toEqual(['tom-vidal', 'tim-vidal'])
  })

  it('rattachement à la personne déclarée : rien n\'est créé, la citation pointe la déclarée', () => {
    const { candidat, citees } = importer([ligne('Blue Bossa', { Chant: 'Hélène Barault' })], [['Hélène Barrault', 'chant']])
    const c = preparerCreation(candidat, citees)
    const apres = appliquerCreation(candidat, c, new Map([[cleRapprochement(c.rapprochements[0]), { garder: 'helene-barrault' }]]))
    expect(apres.personnes.map((p) => p.id)).toEqual(['helene-barrault'])
    expect(apres.groupes[0].membres[0].personne_id).toBe('helene-barrault')
    expect(nomsAbsents(apres)).toBe(0)
  })

  it('même personne citée deux fois au même pupitre après fusion : un seul membre', () => {
    const { candidat, citees } = importer([ligne('Blue Bossa', { Chant: 'Hélène Barrault, Hélène Barault' })])
    const c = preparerCreation(candidat, citees)
    const apres = appliquerCreation(candidat, c, new Map([[cleRapprochement(c.rapprochements[0]), { garder: 'helene-barrault' }]]))
    expect(apres.groupes[0].membres).toEqual([expect.objectContaining({ personne_id: 'helene-barrault', pupitre: 'chant' })])
  })

  it('trois noms proches deux à deux, trois « même personne » qui gardent chacun un nom différent : UNE personne, celle annoncée (review Leader #185)', () => {
    const { candidat, citees } = importer([
      ligne('Blue Bossa', { Chant: 'Martin' }),
      ligne('Autumn Leaves', { Piano: 'Martine' }),
      ligne('So What', { Basse: 'Martins' }),
    ])
    const c = preparerCreation(candidat, citees)
    expect(c.rapprochements).toHaveLength(3)
    // Chaque paire garde un nom différent : avant le correctif, les arêtes
    // formaient un cycle et les trois personnes étaient créées.
    expect(c.rapprochements.map(cleRapprochement)).toEqual(['martin|martine', 'martin|martins', 'martine|martins'])
    const d = new Map<string, DecisionRapprochement>([
      ['martin|martine', { garder: 'martin' }],
      ['martine|martins', { garder: 'martine' }],
      ['martin|martins', { garder: 'martins' }],
    ])
    const apres = appliquerCreation(candidat, c, d)
    expect(apres.personnes).toHaveLength(1)
    // ce que l'écran annonce (noms barrés) est ce qui est créé
    const fusions = fusionsRetenues(c, d)
    expect(fusions.size).toBe(2)
    expect(apres.personnes.map((p) => p.id)).toEqual(c.a_creer.filter((p) => !fusions.has(p.id)).map((p) => p.id))
    const ids = new Set(apres.groupes.flatMap((g) => g.membres.map((m) => m.personne_id)))
    expect([...ids]).toEqual([apres.personnes[0].id])
    expect(apres.personnes[0].instruments.map((i) => i.pupitre).sort()).toEqual(['basse', 'chant', 'piano'])
    expect(nomsAbsents(apres)).toBe(0)
  })

  it('un nom rattaché à deux orthographes différentes : la seconde décision n\'efface pas la première', () => {
    // martin ~ martine, martin ~ marti ; martine et marti sont à deux lettres.
    const { candidat, citees } = importer([
      ligne('Blue Bossa', { Chant: 'Martin' }),
      ligne('Autumn Leaves', { Piano: 'Martine' }),
      ligne('So What', { Basse: 'Marti' }),
    ])
    const c = preparerCreation(candidat, citees)
    expect(c.rapprochements.map(cleRapprochement).sort()).toEqual(['martin|marti', 'martin|martine'])
    const d = new Map<string, DecisionRapprochement>(c.rapprochements.map((r) => [cleRapprochement(r), { garder: r.proche.id }]))
    const apres = appliquerCreation(candidat, c, d)
    expect(apres.personnes).toHaveLength(1)
    expect(fusionsRetenues(c, d).size).toBe(2)
  })

  it('composante qui touche une personne déclarée : la déclarée est retenue, rien n\'est créé', () => {
    const { candidat, citees } = importer(
      [ligne('Blue Bossa', { Chant: 'Martin' }), ligne('Autumn Leaves', { Piano: 'Martine' })],
      [['Martins', 'basse']],
    )
    const c = preparerCreation(candidat, citees)
    // la première décision garde une citation, la déclarée doit quand même primer
    const d = new Map<string, DecisionRapprochement>(
      c.rapprochements.map((r) => [cleRapprochement(r), { garder: r.proche_declaree ? r.proche.id : r.cite.id }]),
    )
    const apres = appliquerCreation(candidat, c, d)
    expect(apres.personnes.map((p) => p.id)).toEqual(['martins'])
    expect(new Set(apres.groupes.flatMap((g) => g.membres.map((m) => m.personne_id)))).toEqual(new Set(['martins']))
  })
})
