/**
 * Tests Sujet C — détection alertes d'identité (intra-session).
 *
 * Couvre les 5 cas de la table de cadrage Stéphane 2026-09-01 :
 *
 * | Cas | Attendu |
 * |---|---|
 * | Quatre Pierre désambiguïsés par initiale | aucune alerte |
 * | Pierre-Yves au chant ET à la guitare sur le même morceau | aucune alerte |
 * | Même prénom, deux instruments, dans deux groupes distincts | alerte |
 * | « Pierre » et « Pierre (L) » sur le même morceau | signalement doublon |
 * | Sept prénoms seuls dans plusieurs groupes | pas d'alerte, visibles écran |
 */
import { describe, expect, it } from 'vitest'
import {
  detecterAlertesIdentite,
  normaliserNom,
  normaliserSansAccents,
  personnesPourRelecture,
  type MembreMention,
} from './identites'

function m(
  nom: string,
  discriminant: string,
  pupitre: string,
  groupe_titre: string,
): MembreMention {
  return { nom, discriminant, pupitre, groupe_titre }
}

describe('detecterAlertesIdentite — 5 cas cadrage Stéphane', () => {
  it('cas 1 : quatre Pierre désambiguïsés par initiale → aucune alerte', () => {
    const mentions = [
      m('Pierre', '(L)', 'batterie', 'Marée Basse'),
      m('Pierre', '(SIG)', 'guitare', 'Hiver 84'),
      m('Pierre', '(M)', 'basse', 'Blue Corridor'),
      m('Pierre', '(F)', 'chant', 'Fanfare de Poche'),
    ]
    const alertes = detecterAlertesIdentite(mentions)
    expect(alertes).toEqual([])
  })

  it('cas 2 : polyvalent chant+guitare sur même morceau → aucune alerte', () => {
    const mentions = [
      m('Pierre-Yves', '', 'chant', 'Marée Basse'),
      m('Pierre-Yves', '', 'guitare', 'Marée Basse'),
    ]
    const alertes = detecterAlertesIdentite(mentions)
    expect(alertes).toEqual([])
  })

  it('cas 3 : même prénom, 2 instruments, 2 groupes distincts → alerte homonymie', () => {
    const mentions = [
      m('Pierre', '', 'batterie', 'Marée Basse'),
      m('Pierre', '', 'guitare', 'Hiver 84'),
    ]
    const alertes = detecterAlertesIdentite(mentions)
    expect(alertes).toHaveLength(1)
    expect(alertes[0]).toMatchObject({
      type: 'homonymie_probable',
      nom: 'Pierre',
      instruments: ['batterie', 'guitare'],
      groupes: ['Hiver 84', 'Marée Basse'],
    })
  })

  it('cas 4 : « Pierre » + « Pierre (L) » sur même morceau → signalement doublon', () => {
    const mentions = [
      m('Pierre', '', 'batterie', 'Marée Basse'),
      m('Pierre', '(L)', 'batterie', 'Marée Basse'),
    ]
    const alertes = detecterAlertesIdentite(mentions)
    const doublons = alertes.filter((a) => a.type === 'doublon_intra_groupe')
    expect(doublons).toHaveLength(1)
    expect(doublons[0]).toMatchObject({
      type: 'doublon_intra_groupe',
      nom: 'Pierre',
      discriminants: ['', '(L)'],
      groupe: 'Marée Basse',
    })
  })

  it('cas 5 : 7 prénoms seuls dans plusieurs groupes → 0 alerte, visibles écran', () => {
    // Sept prénoms distincts, chacun apparaissant dans plusieurs groupes
    // au même instrument (pas d'ambiguïté d'instrument).
    const prenoms = ['Alice', 'Bianca', 'Colette', 'Dorine', 'Emma', 'Fabienne', 'Gaëlle']
    const mentions: MembreMention[] = []
    for (const p of prenoms) {
      mentions.push(m(p, '', 'chant', 'Marée Basse'))
      mentions.push(m(p, '', 'chant', 'Hiver 84'))
    }
    const alertes = detecterAlertesIdentite(mentions)
    expect(alertes).toEqual([])
    // Mais visibles dans l'écran de relecture (7 personnes, 2 engagements chacune)
    const personnes = personnesPourRelecture(mentions)
    expect(personnes).toHaveLength(7)
    for (const p of personnes) {
      expect(p.nb_engagements).toBe(2)
      expect(p.instruments).toEqual(['chant'])
    }
  })
})

describe('detecterAlertesIdentite — cas complémentaires', () => {
  it('empty input → aucune alerte', () => {
    expect(detecterAlertesIdentite([])).toEqual([])
  })

  it('personne unique 1 instrument 1 groupe → aucune alerte', () => {
    expect(
      detecterAlertesIdentite([m('Solo', '', 'batterie', 'Unique')]),
    ).toEqual([])
  })

  it('homonymie sur nom SANS discriminant uniquement — pas d\'alerte si discriminant explicite', () => {
    // « Pierre (L) » et « Pierre (SIG) » : désambiguïsation volontaire,
    // aucune alerte même sur instruments différents.
    const alertes = detecterAlertesIdentite([
      m('Pierre', '(L)', 'batterie', 'Morceau A'),
      m('Pierre', '(SIG)', 'guitare', 'Morceau B'),
    ])
    expect(alertes).toEqual([])
  })

  it('polyvalent partiel : chant+guitare dans A, seulement chant dans B → pas d\'alerte (au moins un groupe couvre tout)', () => {
    const alertes = detecterAlertesIdentite([
      m('Pierre-Yves', '', 'chant', 'A'),
      m('Pierre-Yves', '', 'guitare', 'A'),
      m('Pierre-Yves', '', 'chant', 'B'),
    ])
    expect(alertes).toEqual([])
  })

  it('trois instruments distincts, jamais tous ensemble → alerte', () => {
    const alertes = detecterAlertesIdentite([
      m('Camille', '', 'batterie', 'A'),
      m('Camille', '', 'guitare', 'B'),
      m('Camille', '', 'basse', 'C'),
    ])
    expect(alertes).toHaveLength(1)
    if (alertes[0].type !== 'homonymie_probable') throw new Error('type')
    expect(alertes[0].instruments).toEqual(['basse', 'batterie', 'guitare'])
    expect(alertes[0].groupes).toEqual(['A', 'B', 'C'])
  })

  it('doublon avec 2 discriminants explicites distincts sur même morceau → alerte', () => {
    const alertes = detecterAlertesIdentite([
      m('Pierre', '(L)', 'batterie', 'Morceau'),
      m('Pierre', '(SIG)', 'guitare', 'Morceau'),
    ])
    const doublons = alertes.filter((a) => a.type === 'doublon_intra_groupe')
    expect(doublons).toHaveLength(1)
    if (doublons[0].type !== 'doublon_intra_groupe') throw new Error('type')
    expect(doublons[0].discriminants).toEqual(['(L)', '(SIG)'])
  })

  it('tri déterministe alertes (par nom alpha via mise en mémoire Set→sort)', () => {
    // 2 homonymes : Zorro et Alpha. Alertes doivent sortir dans l'ordre alpha.
    const alertes = detecterAlertesIdentite([
      m('Zorro', '', 'chant', 'A'),
      m('Zorro', '', 'piano', 'B'),
      m('Alpha', '', 'batterie', 'A'),
      m('Alpha', '', 'guitare', 'B'),
    ])
    const homonymies = alertes.filter((a) => a.type === 'homonymie_probable')
    expect(homonymies.map((a) => a.nom)).toEqual(['Alpha', 'Zorro'])
  })
})

describe('normaliserNom — les 5 étapes documentées', () => {
  it('NFC : é décomposé (e + accent combinant) vs composé', () => {
    const compose = 'Sol\u00E8ne'         // « Solène » composé
    const decompose = 'Sole\u0300ne'      // « Solène » décomposé (e + `)
    expect(normaliserNom(compose)).toBe(normaliserNom(decompose))
  })

  it('NBSP U+00A0 → espace normal', () => {
    expect(normaliserNom('Pierre\u00A0Lemoine')).toBe('pierre lemoine')
  })

  it('trim des extrémités (« BRUNO V. » avec espace final)', () => {
    expect(normaliserNom('BRUNO V. ')).toBe('bruno v.')
  })

  it('lowercase', () => {
    expect(normaliserNom('BRUNO V.')).toBe('bruno v.')
  })

  it('espaces multiples → un seul (« Sofia  T. » double espace)', () => {
    expect(normaliserNom('Sofia  T.')).toBe('sofia t.')
  })

  it('chaîne complète (5 étapes cumulées)', () => {
    // Un cas de test artificiel qui déclenche tout : NBSP + majuscules +
    // double espace + espace de tête + accent décomposé
    expect(normaliserNom(' \u00A0Sole\u0300ne\u00A0 M.  '))
      .toBe('solène m.')
  })

  it('n\'enlève PAS les accents (Solène ≠ Solene)', () => {
    // Décision Stéphane : la fusion sans accents va dans rapprochement
    // proposé, pas dans la normalisation directe
    expect(normaliserNom('Solène')).not.toBe(normaliserNom('Solene'))
  })
})

describe('normaliserSansAccents — pour rapprochement seulement', () => {
  it('Solène ↔ Solene', () => {
    expect(normaliserSansAccents('Solène')).toBe(normaliserSansAccents('Solene'))
  })

  it('accents multiples (é, è, ê, à, î)', () => {
    expect(normaliserSansAccents('Éléonore')).toBe('eleonore')
    expect(normaliserSansAccents('Frédérique')).toBe('frederique')
    expect(normaliserSansAccents('Étienne')).toBe('etienne')
  })
})

describe('cas F — normalisation (feedback Stéphane 2026-09-01)', () => {
  it('« Sofia  T. » (double espace) et « sofia t. » rapprochées SANS alerte', () => {
    const mentions = [
      m('Sofia  T.', '', 'chant', 'Comptine d\'Hiver'),   // stagiaires
      m('sofia t.', '', 'basse', 'Comptine d\'Hiver'),     // liste
    ]
    // Aucune alerte d'homonymie ni de rapprochement — la normalisation
    // règle le cas complètement
    const alertes = detecterAlertesIdentite(mentions)
    const homonymies = alertes.filter((a) => a.type === 'homonymie_probable')
    const rapprochements = alertes.filter((a) => a.type === 'rapprochement_propose')
    expect(homonymies).toEqual([])
    expect(rapprochements).toEqual([])
    // Mais l'écran de relecture montre 1 seule personne (rapprochées)
    const personnes = personnesPourRelecture(mentions)
    expect(personnes).toHaveLength(1)
    // Garde-fou : nom_affichage = première forme brute rencontrée
    // (pas la version normalisée « sofia t. »)
    expect(personnes[0].nom_affichage).toBe('Sofia  T.')
    expect(personnes[0].instruments).toEqual(['basse', 'chant'])
    expect(personnes[0].nb_engagements).toBe(2)
  })

  it('« BRUNO V. » (majuscules + espace final) et « Bruno V. » rapprochées via normalisation', () => {
    // Cas Stéphane : deux formes du même stagiaire batterie
    const mentions = [
      m('BRUNO V. ', '', 'batterie', 'Comptine d\'Hiver'),
      m('Bruno V.', '', 'batterie', 'Autre morceau'),
    ]
    // 1 seule personne dans l'écran (normalisation regroupe), garde-fou :
    // nom_affichage = première forme brute rencontrée
    const personnes = personnesPourRelecture(mentions)
    expect(personnes).toHaveLength(1)
    expect(personnes[0].nom_affichage).toBe('BRUNO V. ')  // brut, pas normalisé
    expect(personnes[0].instruments).toEqual(['batterie'])
    expect(personnes[0].nb_engagements).toBe(2)
  })
})

describe('rapprochement_propose — cas C et accents', () => {
  it('cas C : « Pierre Lemoine » (Stagiaires) + « Pierre » (Liste) sur morceaux distincts → rapprochement proposé', () => {
    const mentions = [
      // Stagiaires : Pierre Lemoine (guitare, saisi seul dans Stagiaires — pas d'engagement direct dans un morceau)
      // Simulation : les stagiaires apparaissent aussi comme mentions
      // via leur pupitre principal (le wiring adapter fera ça)
      m('Pierre Lemoine', '', 'guitare', 'Vent Debout'),
      // Liste : Pierre seul sur d\'autres morceaux
      m('Pierre', '', 'batterie', 'Nuit d\'Octobre'),
      m('Pierre', '', 'guitare', 'Le Fil de Soie'),
    ]
    const alertes = detecterAlertesIdentite(mentions)
    const rapprochements = alertes.filter((a) => a.type === 'rapprochement_propose')
    expect(rapprochements).toHaveLength(1)
    if (rapprochements[0].type !== 'rapprochement_propose') throw new Error('type')
    expect(rapprochements[0].nom_court).toBe('Pierre')
    expect(rapprochements[0].nom_long).toBe('Pierre Lemoine')
    expect(rapprochements[0].groupe).toBeNull()
  })

  it('cas D : Pierre + Pierre Lemoine sur MÊME morceau → doublon, PAS rapprochement (signal plus fort)', () => {
    const mentions = [
      m('Pierre', '', 'batterie', 'Sables Mouvants'),
      m('Pierre Lemoine', '', 'guitare', 'Sables Mouvants'),
    ]
    const alertes = detecterAlertesIdentite(mentions)
    // Le rapprochement ne doit PAS remonter (le doublon est plus fort)
    const rapprochements = alertes.filter((a) => a.type === 'rapprochement_propose')
    expect(rapprochements).toEqual([])
  })

  it('rapprochement accents : « Solène » ↔ « Solene » → proposé', () => {
    const mentions = [
      m('Solène', '', 'piano', 'Morceau A'),
      m('Solene', '', 'chant', 'Morceau B'),
    ]
    const alertes = detecterAlertesIdentite(mentions)
    const rapprochements = alertes.filter((a) => a.type === 'rapprochement_propose')
    expect(rapprochements).toHaveLength(1)
    if (rapprochements[0].type !== 'rapprochement_propose') throw new Error('type')
    expect(
      [rapprochements[0].nom_court, rapprochements[0].nom_long].sort(),
    ).toEqual(['Solene', 'Solène'])
  })

  it('cas G — « Solène J. » (Stagiaires) ↔ « Solene J. » (Liste) → rapprochement', () => {
    // Cas G corrigé Stéphane 2026-09-01 : même initiale, seul l'accent
    // diffère → le rapprochement doit remonter.
    const mentions = [
      m('Solène J.', '', 'piano', 'Vent Debout'),           // Stagiaires
      m('Solene J.', '', 'piano', 'Sables Mouvants'),       // Liste
    ]
    const alertes = detecterAlertesIdentite(mentions)
    const rapprochements = alertes.filter((a) => a.type === 'rapprochement_propose')
    expect(rapprochements).toHaveLength(1)
    if (rapprochements[0].type !== 'rapprochement_propose') throw new Error('type')
    expect(
      [rapprochements[0].nom_court, rapprochements[0].nom_long].sort(),
    ).toEqual(['Solene J.', 'Solène J.'])
  })

  it('cas H — « Renée B. » ↔ « Renee C. » (initiales distinctes) → AUCUN rapprochement', () => {
    // Cas H corrigé Stéphane 2026-09-01 : personnes distinctes par
    // initiale, le rapprochement d'accents ne doit PAS fusionner à tort.
    // Vérifie aussi qu'il n'y a pas de propagation en chaîne — les paires
    // sont testées indépendamment.
    const mentions = [
      m('Renée B.', '', 'chant', 'Refrain de Novembre'),
      m('Renee C.', '', 'guitare', 'Refrain de Novembre'),
    ]
    const alertes = detecterAlertesIdentite(mentions)
    const rapprochements = alertes.filter((a) => a.type === 'rapprochement_propose')
    expect(rapprochements).toEqual([])
    // Vérif complémentaire : 2 personnes distinctes dans l'écran
    const personnes = personnesPourRelecture(mentions)
    expect(personnes).toHaveLength(2)
  })

  it('pas de propagation en chaîne : Renée B. / Renee B. / Renee C.', () => {
    // Si le rapprochement était transitif, on aurait : Renée B. ↔ Renee B.
    // (accent) puis Renee B. ↔ Renee C. (par transitivité fantaisiste),
    // fusionnant tout. La comparaison par nom COMPLET l'évite.
    const mentions = [
      m('Renée B.', '', 'chant', 'A'),
      m('Renee B.', '', 'chant', 'A'),   // doublon intra-groupe (même normalisation minus accent)
      m('Renee C.', '', 'guitare', 'B'),
    ]
    const alertes = detecterAlertesIdentite(mentions)
    const rapprochements = alertes.filter((a) => a.type === 'rapprochement_propose')
    // 1 seul rapprochement attendu : Renée B. ↔ Renee B. (même initiale)
    // Pas de rapprochement Renée B. ↔ Renee C. ni Renee B. ↔ Renee C.
    const nomsImpliques = rapprochements.map((r) =>
      r.type === 'rapprochement_propose' ? [r.nom_court, r.nom_long].sort().join(' / ') : '',
    )
    expect(nomsImpliques).toEqual(['Renee B. / Renée B.'])
  })

  it('pas de rapprochement en double (Pierre → Pierre Lemoine ET Pierre Ledoux, mais Pierre Lemoine ↔ Pierre Ledoux non-préfixe)', () => {
    const mentions = [
      m('Pierre', '', 'batterie', 'A'),
      m('Pierre Lemoine', '', 'guitare', 'B'),
      m('Pierre Ledoux', '', 'chant', 'C'),
    ]
    const alertes = detecterAlertesIdentite(mentions)
    const rapprochements = alertes.filter((a) => a.type === 'rapprochement_propose')
    // 2 rapprochements attendus : Pierre-Lemoine + Pierre-Ledoux. Pas de
    // rapprochement Lemoine-Ledoux (pas de préfixe entre eux).
    expect(rapprochements).toHaveLength(2)
  })
})

describe('personnesPourRelecture', () => {
  it('vue à plat avec nb_engagements et instruments dédupliqués', () => {
    const personnes = personnesPourRelecture([
      m('Pierre', '(L)', 'batterie', 'A'),
      m('Pierre', '(L)', 'batterie', 'B'),
      m('Pierre', '(L)', 'chant', 'C'),
      m('Emma', '', 'guitare', 'A'),
    ])
    expect(personnes).toHaveLength(2)
    // tri alpha
    expect(personnes[0].nom_affichage).toBe('Emma')
    expect(personnes[1].nom_affichage).toBe('Pierre (L)')
    expect(personnes[1].instruments).toEqual(['batterie', 'chant'])
    expect(personnes[1].nb_engagements).toBe(3)
  })

  it('discriminant vide → nom d\'affichage = nom seul', () => {
    const personnes = personnesPourRelecture([
      m('Solo', '', 'batterie', 'A'),
    ])
    expect(personnes[0].nom_affichage).toBe('Solo')
  })

  it('trois Pierre à la batterie sont bien listés séparément (repérage visuel humain)', () => {
    // Le cas typique évoqué par Stéphane : « trois Pierre à la batterie
    // en trois secondes, là où aucune heuristique ne trancherait jamais »
    // — l'écran de relecture les affiche distinctement.
    const personnes = personnesPourRelecture([
      m('Pierre', '(L)', 'batterie', 'A'),
      m('Pierre', '(S)', 'batterie', 'B'),
      m('Pierre', '(M)', 'batterie', 'C'),
    ])
    expect(personnes).toHaveLength(3)
    expect(personnes.map((p) => p.nom_affichage)).toEqual([
      'Pierre (L)', 'Pierre (M)', 'Pierre (S)',
    ])
    for (const p of personnes) {
      expect(p.instruments).toEqual(['batterie'])
      expect(p.nb_engagements).toBe(1)
    }
  })
})
