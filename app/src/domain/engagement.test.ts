/**
 * Tests unitaires + invariant transversal : la définition unique de
 * « personne engagée » (fix CD 7057 point 2 / CD 6990 anomalie 3).
 *
 * Verrouille l'invariant : une personne présente UNIQUEMENT dans un
 * morceau imposé DOIT être considérée engagée par les 3 sites
 * consommateurs (pool / en-tête UI / alerte cohérence). Contre-exemple
 * négatif inclus (feedback CD 6701 : test invariant progression
 * itérative — le contre-exemple verrouille le bug pré-fix).
 */

import { describe, expect, it } from 'vitest'
import { comptageEngagements, estEngage } from './engagement'
import type { Inscriptions, Personne } from './model'

function personne(id: string, nom: string, pupitre: string): Personne {
  return {
    id,
    nom,
    discriminant: '',
    role: 'musicien',
    instruments: [{ pupitre, lourd: false }],
    indispos: [],
  }
}

function inscriptionsAvecImpose(): Inscriptions {
  return {
    session_id: 's',
    personnes: [
      personne('alice', 'Alice', 'chant'),
      personne('bob', 'Bob', 'chant'),
      personne('charlie', 'Charlie', 'basse'),
    ],
    groupes: [
      {
        id: 'g1',
        titre: 'Volontaire',
        auteur: '',
        responsable_id: 'r',
        style: '',
        tonalite: '',
        // Alice est dans un groupe volontaire.
        membres: [{ personne_id: 'alice', pupitre: 'chant' }],
        postes_cherches: [],
        repetitions_deja_faites: 0,
        echeance: 'apero_mercredi',
      },
    ],
    imposes: [
      {
        id: 'imp1',
        morceau: 'Concert vendredi',
        // Bob est dans un morceau IMPOSÉ uniquement, pas dans un groupe.
        // Alice est aussi dans l'imposé (double engagement).
        membres: ['alice', 'bob'],
        seances: [],
      },
    ],
    refus: [],
  }
}

describe('comptageEngagements', () => {
  it('compte les engagements de groupes ET les engagements d\'imposés', () => {
    const c = comptageEngagements(inscriptionsAvecImpose())
    // Alice : 1 groupe + 1 imposé = 2.
    expect(c.get('alice')).toBe(2)
    // Bob : uniquement dans un imposé — DOIT être compté 1, pas 0
    // (bug pré-fix : Bob était compté 0 → traité LIBRE partout).
    expect(c.get('bob')).toBe(1)
    // Charlie : ni groupe ni imposé → absent de la map.
    expect(c.get('charlie')).toBeUndefined()
  })

  it('dédup intra-source (impose citant 2× la même personne)', () => {
    const ins: Inscriptions = {
      session_id: 's',
      personnes: [personne('alice', 'Alice', 'chant')],
      groupes: [],
      imposes: [
        {
          id: 'imp1',
          morceau: 'Doublon',
          membres: ['alice', 'alice'],
          seances: [],
        },
      ],
      refus: [],
    }
    const c = comptageEngagements(ins)
    expect(c.get('alice')).toBe(1)
  })

  it('dédup intra-source (groupe citant 2× la même personne sur 2 pupitres)', () => {
    // Miroir du test précédent côté groupes (obs 2 review Leader PR #145) :
    // un groupe peut légitimement citer une personne deux fois si elle joue
    // 2 instruments dans le même morceau (Marc basse+chant). Le comptage
    // doit rester 1 par groupe (dédup par personne_id via Set).
    const ins: Inscriptions = {
      session_id: 's',
      personnes: [personne('marc', 'Marc', 'basse')],
      groupes: [
        {
          id: 'g1',
          titre: 'Multi-instrument',
          auteur: '',
          responsable_id: 'r',
          style: '',
          tonalite: '',
          membres: [
            { personne_id: 'marc', pupitre: 'basse' },
            { personne_id: 'marc', pupitre: 'chant' },
          ],
          postes_cherches: [],
          repetitions_deja_faites: 0,
          echeance: 'apero_mercredi',
        },
      ],
      imposes: [],
      refus: [],
    }
    const c = comptageEngagements(ins)
    expect(c.get('marc')).toBe(1)
  })

  it('inscriptions sans imposes : comportement rétrocompat identique à l\'ancien comptage', () => {
    const ins: Inscriptions = {
      session_id: 's',
      personnes: [personne('alice', 'Alice', 'chant')],
      groupes: [
        {
          id: 'g1',
          titre: 'X',
          auteur: '',
          responsable_id: 'r',
          style: '',
          tonalite: '',
          membres: [{ personne_id: 'alice', pupitre: 'chant' }],
          postes_cherches: [],
          repetitions_deja_faites: 0,
          echeance: 'apero_mercredi',
        },
      ],
      imposes: [],
      refus: [],
    }
    expect(comptageEngagements(ins).get('alice')).toBe(1)
  })
})

describe('estEngage', () => {
  it('personne dans un impose seul est engagée (contre-exemple négatif pré-fix)', () => {
    // Contre-exemple : AVANT le fix, Bob était traité comme LIBRE parce
    // qu'il n'apparaissait pas dans inscriptions.groupes — le solveur
    // proposait de le déplacer sur des postes cherches, alors qu'il est
    // en réalité fixé dans le concert imposé. Ce test verrouille l'invariant.
    const ins = inscriptionsAvecImpose()
    expect(estEngage('bob', ins)).toBe(true)
  })

  it('personne dans un groupe seul est engagée', () => {
    const ins = inscriptionsAvecImpose()
    // Alice est aussi dans un imposé mais l'important ici : groupe SEUL suffit.
    // On teste avec un cas isolé pour être précis :
    const insGroupeSeul: Inscriptions = {
      session_id: 's',
      personnes: [personne('alice', 'Alice', 'chant')],
      groupes: ins.groupes,
      imposes: [],
      refus: [],
    }
    expect(estEngage('alice', insGroupeSeul)).toBe(true)
  })

  it('personne sans groupe ni imposé est libre', () => {
    const ins = inscriptionsAvecImpose()
    expect(estEngage('charlie', ins)).toBe(false)
  })

  it('personne inexistante est libre (défensif)', () => {
    const ins = inscriptionsAvecImpose()
    expect(estEngage('inconnu-42', ins)).toBe(false)
  })
})

describe('invariant transversal (CD 7057 point 2)', () => {
  it("comptageEngagements et estEngage sont cohérents : count>0 ⇔ engagé=true", () => {
    const ins = inscriptionsAvecImpose()
    const counts = comptageEngagements(ins)
    for (const p of ins.personnes) {
      const compte = counts.get(p.id) ?? 0
      expect(estEngage(p.id, ins), `personne=${p.id}`).toBe(compte > 0)
    }
  })
})
