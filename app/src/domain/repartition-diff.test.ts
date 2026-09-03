/**
 * Tests `comparerRepartitions` — spec Stéphane 2026-09-02 (PR-B0).
 *
 * Ordre TDD (nano-précision Leader 14:15) :
 *
 * 1. **Cas nominal réaménagement** (échange 2 créneaux, cardinalité
 *    inchangée) — verrouille la formule `n_avant === n_apres AND
 *    (ajouts OR retraits)` contre l'implémentation naïve
 *    `deplacement_pur = (ajouts > 0 && retires > 0)`.
 * 2. Ordre inversé → `identiques: true` (garde-fou ensembliste).
 * 3. Un groupe perd une séance.
 * 4. Un groupe change d'horaire (1 ajout + 1 retrait).
 * 5. Un groupe entier disparaît.
 * 6. `a` vide, `b` peuplé.
 * 7. Les deux vides.
 * 8. Deux placements identiques (garde-fou trivial).
 */

import { describe, expect, it } from 'vitest'
import type { PlacementItem } from '../engine/solver'
import { comparerRepartitions } from './repartition-diff'

const P = (groupe_id: string, creneau_id: string): PlacementItem => ({ groupe_id, creneau_id })

describe('comparerRepartitions — cas nominal + garde-fous (ordre TDD Leader 2026-09-02)', () => {
  // ─── 1. CAS NOMINAL RÉAMÉNAGEMENT (le plus fréquent après modif saisie) ───
  it('[1] échange de 2 créneaux, cardinalité inchangée → deplacement_pur: true', () => {
    // g1 : [c1, c2] → [c3, c4]  (2 ajouts, 2 retraits, même nb séances)
    // Verrouille contre `deplacement_pur = ajouts > 0 && retires > 0` naïf :
    // ce test échoue si la formule ne check pas la cardinalité `n_avant === n_apres`.
    const a = [P('g1', 'c1'), P('g1', 'c2')]
    const b = [P('g1', 'c3'), P('g1', 'c4')]
    const diff = comparerRepartitions(a, b)
    expect(diff.identiques).toBe(false)
    expect(diff.groupes_modifies).toHaveLength(1)
    const g = diff.groupes_modifies[0]
    expect(g.deplacement_pur).toBe(true)
    expect([...g.creneaux_ajoutes].sort()).toEqual(['c3', 'c4'])
    expect([...g.creneaux_retires].sort()).toEqual(['c1', 'c2'])
    expect(diff.delta_places).toBe(0) // cardinalité inchangée
  })

  // ─── 2. GARDE-FOU ENSEMBLISTE (piège comparaison par index) ───
  it('[2] même placement, ordre du tableau inversé → identiques: true', () => {
    const a = [P('g1', 'c1'), P('g1', 'c2'), P('g2', 'c3')]
    const b = [P('g2', 'c3'), P('g1', 'c2'), P('g1', 'c1')] // même contenu, ordre différent
    const diff = comparerRepartitions(a, b)
    expect(diff.identiques).toBe(true)
    expect(diff.nb_groupes_modifies).toBe(0)
    expect(diff.nb_seances_ajoutees).toBe(0)
    expect(diff.nb_seances_retirees).toBe(0)
    expect(diff.groupes_modifies).toEqual([])
  })

  // ─── 3. Un groupe perd une séance (vraie dégradation) ───
  it('[3] un groupe perd une séance → deplacement_pur: false, delta_places: -1', () => {
    const a = [P('g1', 'c1'), P('g1', 'c2'), P('g1', 'c3')]
    const b = [P('g1', 'c1'), P('g1', 'c2')]
    const diff = comparerRepartitions(a, b)
    expect(diff.identiques).toBe(false)
    expect(diff.delta_places).toBe(-1)
    const g = diff.groupes_modifies[0]
    expect(g.creneaux_retires).toEqual(['c3'])
    expect(g.creneaux_ajoutes).toEqual([])
    expect(g.deplacement_pur).toBe(false)
  })

  // ─── 4. Un groupe change d'horaire (1 ajout + 1 retrait — cas dérivé du nominal) ───
  it('[4] un groupe change d\'horaire (1 ajout + 1 retrait) → deplacement_pur: true', () => {
    // g1 : [c1, c2, c3] → [c1, c2, c4]  (c3 remplacé par c4)
    const a = [P('g1', 'c1'), P('g1', 'c2'), P('g1', 'c3')]
    const b = [P('g1', 'c1'), P('g1', 'c2'), P('g1', 'c4')]
    const diff = comparerRepartitions(a, b)
    expect(diff.identiques).toBe(false)
    expect(diff.nb_groupes_modifies).toBe(1)
    expect(diff.nb_seances_ajoutees).toBe(1)
    expect(diff.nb_seances_retirees).toBe(1)
    const g = diff.groupes_modifies[0]
    expect(g.groupe_id).toBe('g1')
    expect(g.creneaux_ajoutes).toEqual(['c4'])
    expect(g.creneaux_retires).toEqual(['c3'])
    expect(g.deplacement_pur).toBe(true)
    expect(diff.delta_places).toBe(0)
  })

  // ─── 5. Un groupe entier disparaît ───
  it('[5] un groupe entier disparaît → tous ses créneaux en retires', () => {
    const a = [P('g1', 'c1'), P('g2', 'c2'), P('g2', 'c3')]
    const b = [P('g1', 'c1')] // g2 disparu
    const diff = comparerRepartitions(a, b)
    expect(diff.identiques).toBe(false)
    expect(diff.delta_places).toBe(-2)
    const g2 = diff.groupes_modifies.find((g) => g.groupe_id === 'g2')
    expect(g2).toBeDefined()
    expect([...g2!.creneaux_retires].sort()).toEqual(['c2', 'c3'])
    expect(g2!.creneaux_ajoutes).toEqual([])
    expect(g2!.deplacement_pur).toBe(false)
  })

  // ─── 6. `a` vide, `b` peuplé ───
  it('[6] a vide, b peuplé → tout en ajoutes', () => {
    const a: PlacementItem[] = []
    const b = [P('g1', 'c1'), P('g2', 'c2')]
    const diff = comparerRepartitions(a, b)
    expect(diff.identiques).toBe(false)
    expect(diff.delta_places).toBe(2)
    expect(diff.nb_seances_ajoutees).toBe(2)
    expect(diff.nb_seances_retirees).toBe(0)
    for (const g of diff.groupes_modifies) {
      expect(g.creneaux_retires).toEqual([])
      expect(g.creneaux_ajoutes).toHaveLength(1)
      expect(g.deplacement_pur).toBe(false)
    }
  })

  // ─── 7. Les deux vides ───
  it('[7] les deux vides → identiques: true', () => {
    const diff = comparerRepartitions([], [])
    expect(diff.identiques).toBe(true)
    expect(diff.delta_places).toBe(0)
    expect(diff.groupes_modifies).toEqual([])
  })

  // ─── 8. Deux placements identiques (trivial, garde-fou) ───
  it('[8] deux placements identiques → identiques: true, tous compteurs à 0', () => {
    const a = [P('g1', 'c1'), P('g2', 'c2')]
    const b = [P('g1', 'c1'), P('g2', 'c2')]
    const diff = comparerRepartitions(a, b)
    expect(diff.identiques).toBe(true)
    expect(diff.delta_places).toBe(0)
    expect(diff.nb_groupes_modifies).toBe(0)
    expect(diff.nb_seances_ajoutees).toBe(0)
    expect(diff.nb_seances_retirees).toBe(0)
  })
})

describe('comparerRepartitions — precisions deplacement_pur (nuance qui rend le message utile)', () => {
  it('deplacement_pur: false quand ajouts seuls (groupe gagne une séance)', () => {
    const a = [P('g1', 'c1')]
    const b = [P('g1', 'c1'), P('g1', 'c2')]
    const diff = comparerRepartitions(a, b)
    expect(diff.groupes_modifies[0].deplacement_pur).toBe(false)
    expect(diff.delta_places).toBe(1)
  })

  it('deplacement_pur: false quand |ajouts| ≠ |retires| (2 pour 1 = dégradation)', () => {
    // g1 : [c1, c2, c3] → [c4, c5]  (2 ajouts, 3 retraits)
    const a = [P('g1', 'c1'), P('g1', 'c2'), P('g1', 'c3')]
    const b = [P('g1', 'c4'), P('g1', 'c5')]
    const diff = comparerRepartitions(a, b)
    expect(diff.groupes_modifies[0].deplacement_pur).toBe(false)
  })
})

describe('comparerRepartitions — meta (delta_groupes_complets)', () => {
  it('sans meta → delta_groupes_complets = 0 (défaut à 0)', () => {
    const diff = comparerRepartitions([P('g1', 'c1')], [P('g1', 'c2')])
    expect(diff.delta_groupes_complets).toBe(0)
  })

  it('avec meta → delta_groupes_complets = b - a', () => {
    const metaA = {
      placement: [P('g1', 'c1')],
      groupes_complets: 1,
      places_totales: 1,
      jours_couverts: 1,
      essais_executes: 1,
      arret_precoce: 'complet' as const,
    }
    const metaB = { ...metaA, groupes_complets: 3, placement: [P('g1', 'c1'), P('g2', 'c2')] }
    const diff = comparerRepartitions([P('g1', 'c1')], [P('g1', 'c1'), P('g2', 'c2')], { a: metaA, b: metaB })
    expect(diff.delta_groupes_complets).toBe(2)
    expect(diff.delta_places).toBe(1)
  })
})

describe('comparerRepartitions — déterminisme et stabilité', () => {
  it('résultat reproductible : mêmes inputs → même output', () => {
    const a = [P('g1', 'c1'), P('g2', 'c2')]
    const b = [P('g1', 'c3'), P('g3', 'c4')]
    const d1 = comparerRepartitions(a, b)
    const d2 = comparerRepartitions(a, b)
    expect(d1).toEqual(d2)
  })

  it('groupes_modifies ordonnés déterministe (tri sur groupe_id)', () => {
    const a = [P('zebra', 'c1'), P('alpha', 'c2')]
    const b = [P('alpha', 'c3'), P('zebra', 'c4')]
    const diff = comparerRepartitions(a, b)
    const ids = diff.groupes_modifies.map((g) => g.groupe_id)
    expect(ids).toEqual([...ids].sort())
  })

  it('creneaux_ajoutes/retires triés déterministe', () => {
    const a = [P('g1', 'zebra'), P('g1', 'alpha')]
    const b = [P('g1', 'delta'), P('g1', 'bravo')]
    const diff = comparerRepartitions(a, b)
    const g = diff.groupes_modifies[0]
    expect(g.creneaux_ajoutes).toEqual([...g.creneaux_ajoutes].sort())
    expect(g.creneaux_retires).toEqual([...g.creneaux_retires].sort())
  })
})

// ─── Changements de salle (extension spec Stéphane 2026-09-03 v20260903.1623)
//
// Bug initial : désactiver une salle occupée → relance → « aucun changement »,
// alors que plusieurs séances migrent ailleurs. Cause : PlacementItem ne porte
// que (groupe_id, creneau_id) ; les salles étaient exclues du comparateur.
// Correction : accepter un 4e paramètre optionnel `assignationsAvecSalles`
// qui porte les triplets complets, et signaler les changements salle sur
// les créneaux communs. Rétro-compat : sans ce paramètre, comportement
// inchangé (`nb_changements_salle = 0`).

const A = (groupe_id: string, creneau_id: string, salle_id: string) => ({
  groupe_id,
  creneau_id,
  salle_id,
})

describe('comparerRepartitions — changements de salle', () => {
  it('même groupe, même créneau, salle différente → 1 changement salle, pas de déplacement', () => {
    const a = [P('g1', 'c1')]
    const b = [P('g1', 'c1')]
    const assignations = {
      avant: [A('g1', 'c1', 'salle-A')],
      apres: [A('g1', 'c1', 'salle-B')],
    }
    const diff = comparerRepartitions(a, b, undefined, assignations)
    expect(diff.nb_changements_salle).toBe(1)
    expect(diff.identiques).toBe(false)
    expect(diff.delta_places).toBe(0)
    const g = diff.groupes_modifies[0]
    expect(g.deplacement_pur).toBe(false)
    expect(g.creneaux_ajoutes).toEqual([])
    expect(g.creneaux_retires).toEqual([])
    expect(g.changements_salle).toEqual([
      { creneau_id: 'c1', salle_avant: 'salle-A', salle_apres: 'salle-B' },
    ])
  })

  it('même groupe, même créneau, même salle → aucun changement', () => {
    const a = [P('g1', 'c1')]
    const b = [P('g1', 'c1')]
    const assignations = {
      avant: [A('g1', 'c1', 'salle-A')],
      apres: [A('g1', 'c1', 'salle-A')],
    }
    const diff = comparerRepartitions(a, b, undefined, assignations)
    expect(diff.identiques).toBe(true)
    expect(diff.nb_changements_salle).toBe(0)
    expect(diff.groupes_modifies).toEqual([])
  })

  it('groupe déplacé ET changé de salle sur créneau commun → compté dans les 2', () => {
    // g1 : [c1, c2] → [c1, c3]  (c2 → c3 = déplacement, salle c1 change)
    const a = [P('g1', 'c1'), P('g1', 'c2')]
    const b = [P('g1', 'c1'), P('g1', 'c3')]
    const assignations = {
      avant: [A('g1', 'c1', 'salle-A'), A('g1', 'c2', 'salle-A')],
      apres: [A('g1', 'c1', 'salle-B'), A('g1', 'c3', 'salle-A')],
    }
    const diff = comparerRepartitions(a, b, undefined, assignations)
    expect(diff.nb_changements_salle).toBe(1)
    const g = diff.groupes_modifies[0]
    expect(g.deplacement_pur).toBe(true) // 1 ajout + 1 retrait, cardinalité inchangée
    expect(g.creneaux_ajoutes).toEqual(['c3'])
    expect(g.creneaux_retires).toEqual(['c2'])
    expect(g.changements_salle).toEqual([
      { creneau_id: 'c1', salle_avant: 'salle-A', salle_apres: 'salle-B' },
    ])
  })

  it('meta et assignations absents → mode dégradé, nb_changements_salle=0, aucune erreur', () => {
    // Contrat rétro-compatible : les 8+ cas historiques n'ont jamais passé
    // d'assignations. Le comparateur DOIT continuer à fonctionner en mode
    // dégradé (nb_changements_salle=0) plutôt qu'échouer.
    const diff = comparerRepartitions([P('g1', 'c1')], [P('g1', 'c1')])
    expect(diff.identiques).toBe(true)
    expect(diff.nb_changements_salle).toBe(0)
    expect(diff.groupes_modifies).toEqual([])
  })

  it('plusieurs changements salle sur un même groupe → tous listés + tri déterministe', () => {
    // g1 : c1 c2 c3 gardés, toutes salles changent
    const a = [P('g1', 'c1'), P('g1', 'c2'), P('g1', 'c3')]
    const b = [P('g1', 'c1'), P('g1', 'c2'), P('g1', 'c3')]
    const assignations = {
      avant: [A('g1', 'c1', 'sa'), A('g1', 'c2', 'sa'), A('g1', 'c3', 'sa')],
      apres: [A('g1', 'c1', 'sb'), A('g1', 'c2', 'sb'), A('g1', 'c3', 'sb')],
    }
    const diff = comparerRepartitions(a, b, undefined, assignations)
    expect(diff.nb_changements_salle).toBe(3)
    const g = diff.groupes_modifies[0]
    expect(g.changements_salle.map((c) => c.creneau_id)).toEqual(['c1', 'c2', 'c3'])
  })
})
