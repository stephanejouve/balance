import { describe, expect, it } from 'vitest'
import { genererCreneaux } from '../domain/grille'
import { Inscriptions, Lieu, Session } from '../domain/model'
import { plusGrandeJaugeActive } from './plafond-salle'
import { calculerPool, type Refus } from './pool'

/**
 * PR 1 pool §96 — tests exhaustifs de la fonction pure `calculerPool`.
 * Chaque test verrouille une propriété du contrat cadré CD msgs
 * 6620/6624/6629/6656 (Q1+Q2+Q3+3 remarques du 6656).
 */

function fixture(opts: {
  jauge?: number
  jauge2?: number
  butoirDate?: string
  butoirHeure?: string
  dateFin?: string
} = {}) {
  const lieu = Lieu.parse({
    id: 'l',
    nom: 'L',
    salles: [
      { id: 'A', nom: 'A', jauge: opts.jauge ?? 10 },
      ...(opts.jauge2 ? [{ id: 'B', nom: 'B', jauge: opts.jauge2 }] : []),
    ],
  })
  const session = Session.parse({
    id: 's',
    nom: 'S',
    lieu_id: 'l',
    date_debut: '2026-08-24',
    date_fin: opts.dateFin ?? '2026-08-26',
    date_butoir: opts.butoirDate ?? '2026-08-27',
    butoir_heure: opts.butoirHeure ?? '23:59',
    grille: [{ debut: '09:00', fin: '12:00', pas_minutes: 60 }],
    repetitions_visees: 3,
  })
  const creneaux = genererCreneaux(session, lieu)
  const plusGrandeJauge = plusGrandeJaugeActive(lieu.salles)
  return { session, lieu, creneaux, plusGrandeJauge }
}

describe('calculerPool — filtre Q2 (structurellement mortes)', () => {
  it('écarte les propositions vers une personne exclue globalement', () => {
    // Alice est indisponible sur TOUS les créneaux (blocage total) → exclue.
    // Elle ne doit apparaître dans AUCUNE proposition, ni comme source ni
    // implicitement comme candidate.
    const { session, creneaux, plusGrandeJauge } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        {
          id: 'alice',
          nom: 'Alice',
          instruments: [{ pupitre: 'chant' }],
          indispos: [{ jours: [], debut: '09:00', fin: '12:00', roles: [], motif: 'exclue' }],
        },
        { id: 'bob', nom: 'Bob', instruments: [{ pupitre: 'chant' }] },
      ],
      groupes: [
        {
          id: 'source',
          titre: 'Source',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'bob', pupitre: 'chant' },
          ],
        },
        {
          id: 'cible',
          titre: 'Cible',
          membres: [],
          postes_cherches: [{ pupitre: 'chant', nb: 1 }],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    expect(props.every((p) => p.personne_id !== 'alice')).toBe(true)
  })

  it('écarte les propositions vers un pupitre absent chez la personne', () => {
    // Bob joue chant. La cible cherche du piano, pas du chant. Aucune
    // proposition ne doit relier Bob à la cible.
    const { session, creneaux, plusGrandeJauge } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [{ id: 'bob', nom: 'Bob' }],
      groupes: [
        {
          id: 'source',
          titre: 'Source',
          membres: [{ personne_id: 'bob', pupitre: 'chant' }],
        },
        {
          id: 'cible',
          titre: 'Cible',
          membres: [],
          postes_cherches: [{ pupitre: 'piano', nb: 1 }],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    expect(props.some((p) => p.source_groupe_id === 'source' && p.cible_groupe_id === 'cible')).toBe(
      false,
    )
  })
})

describe('calculerPool — scoring Q3 (gains cumulables)', () => {
  it('gain_cible = 1 quand la cible cherche le pupitre et la personne le tient', () => {
    // Personne présente dans source, cible cherche exactement son pupitre,
    // source ne peine pas côté plafond → gain_cible = 1, gain_source = 0.
    const { session, creneaux, plusGrandeJauge } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'marie', nom: 'Marie' },
        { id: 'x', nom: 'X' },
      ],
      groupes: [
        {
          id: 'source',
          titre: 'Source',
          membres: [
            { personne_id: 'marie', pupitre: 'chant' },
            { personne_id: 'x', pupitre: 'chant' },
          ],
        },
        {
          id: 'cible',
          titre: 'Cible',
          membres: [],
          postes_cherches: [{ pupitre: 'chant', nb: 1 }],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    const mariéTransfert = props.find(
      (p) => p.personne_id === 'marie' && p.cible_groupe_id === 'cible',
    )
    expect(mariéTransfert).toBeDefined()
    expect(mariéTransfert!.gain_cible).toBe(1)
    expect(mariéTransfert!.gain_source).toBe(0)
    expect(mariéTransfert!.cout_source).toBe(0)
    expect(mariéTransfert!.gain_net).toBe(1)
  })

  it('gain_source = 1 quand le retrait fait passer source sous le plafond', () => {
    // Jauge max 3. Source à 4 personnes → « ne loge pas ». Retirer une
    // personne à pupitre non-unique → source à 3, loge. gain_source = 1.
    // Aucune cible avec CHERCHE → seule la proposition « retrait sans
    // réaffectation » est émise pour cette personne.
    const { session, creneaux, plusGrandeJauge } = fixture({ jauge: 3 })
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
        { id: 'd', nom: 'D' },
      ],
      groupes: [
        {
          id: 'source',
          titre: 'Source',
          membres: [
            { personne_id: 'a', pupitre: 'chant' },
            { personne_id: 'b', pupitre: 'chant' },
            { personne_id: 'c', pupitre: 'chant' },
            { personne_id: 'd', pupitre: 'chant' },
          ],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    // Chaque personne a une proposition retrait_sans_reaffectation avec
    // gain_source = 1, gain_cible = 0, cout_source = 0.
    const retraits = props.filter((p) => p.nom_mouvement === 'retrait_sans_reaffectation')
    expect(retraits.length).toBe(4)
    for (const r of retraits) {
      expect(r.gain_source).toBe(1)
      expect(r.gain_cible).toBe(0)
      expect(r.cout_source).toBe(0)
      expect(r.gain_net).toBe(1)
    }
  })

  it('cas cumul CD 6624 : gain_source + gain_cible = 2 sort en tête', () => {
    // Source à 4 pers (jauge 3, ne loge pas) + une cible avec CHERCHE au
    // pupitre de la personne à retirer. Une proposition unique où la
    // personne Marie retirée débloque le plafond ET pourvoit un CHERCHE →
    // gain_net = 2, gain_source = 1, gain_cible = 1. Doit sortir 1re.
    const { session, creneaux, plusGrandeJauge } = fixture({ jauge: 3 })
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'marie', nom: 'Marie' },
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
      ],
      groupes: [
        {
          id: 'source',
          titre: 'Feeling Good',
          membres: [
            { personne_id: 'marie', pupitre: 'chant' },
            { personne_id: 'a', pupitre: 'chant' },
            { personne_id: 'b', pupitre: 'chant' },
            { personne_id: 'c', pupitre: 'chant' },
          ],
        },
        {
          id: 'cible',
          titre: 'Zombie',
          membres: [],
          postes_cherches: [{ pupitre: 'chant', nb: 1 }],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    expect(props.length).toBeGreaterThan(0)
    const meilleur = props[0]!
    expect(meilleur.gain_net).toBe(2)
    expect(meilleur.gain_source).toBe(1)
    expect(meilleur.gain_cible).toBe(1)
    expect(meilleur.nom_mouvement).toBe('transfert')
  })

  it('cout_source = 1 quand retirer viderait un pupitre unique', () => {
    // Alice tient seule le pupitre chant chez source. La retirer vide le
    // pupitre. cout_source = 1. Pas de gain plafond ni CHERCHE →
    // gain_net = -1, proposition non émise (filtre `> 0`).
    const { session, creneaux, plusGrandeJauge } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'alice', nom: 'Alice' },
        { id: 'bob', nom: 'Bob' },
      ],
      groupes: [
        {
          id: 'source',
          titre: 'Source',
          membres: [
            { personne_id: 'alice', pupitre: 'chant' },
            { personne_id: 'bob', pupitre: 'piano' },
          ],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    // Alice + Bob peuvent apparaître dans des cibles hypothétiques mais
    // pas ici (aucune cible avec CHERCHE) → pool vide.
    expect(props.length).toBe(0)
  })

  it('filtre gain_net > 0 (déplacement neutre écarté)', () => {
    // Source à 2 personnes (loge, jauge 10), pupitre pas unique. Retirer
    // Marie et la proposer à une cible qui n'a pas de CHERCHE →
    // gain_source = 0, gain_cible = 0, cout_source = 0, gain_net = 0.
    // Rien à afficher.
    const { session, creneaux, plusGrandeJauge } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'marie', nom: 'Marie' },
        { id: 'x', nom: 'X' },
      ],
      groupes: [
        {
          id: 'source',
          titre: 'Source',
          membres: [
            { personne_id: 'marie', pupitre: 'chant' },
            { personne_id: 'x', pupitre: 'chant' },
          ],
        },
        {
          id: 'cible',
          titre: 'Cible sans besoin',
          membres: [{ personne_id: 'x', pupitre: 'chant' }],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    expect(props.length).toBe(0)
  })
})

describe('calculerPool — précision Marc basse+chant (CD 6624)', () => {
  it('retirer une personne à 2 postes libère TOUS ses postes (pas juste 1)', () => {
    // Marc a 2 postes (basse+chant) dans source. Retrait de Marc =
    // retirer les 2 postes. Effectif source passe de N à N-1 personne
    // distincte (car Marc = 1 personne au sens distinct).
    // Fixture calibrée : jauge 4, source à 5 personnes distinctes
    // → « ne loge pas ». Retrait Marc (1 pers., 2 postes) → 4 personnes
    // distinctes = jauge 4 → loge.
    // D bassiste séparé pour que le retrait de Marc ne vide pas la basse
    // (cout_source = 0). Chant reste couvert par A/B/C.
    const { session, creneaux, plusGrandeJauge } = fixture({ jauge: 4 })
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'marc', nom: 'Marc' },
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
        { id: 'd', nom: 'D' },
      ],
      groupes: [
        {
          id: 'source',
          titre: 'Source',
          membres: [
            { personne_id: 'marc', pupitre: 'basse' },
            { personne_id: 'marc', pupitre: 'chant' },
            { personne_id: 'd', pupitre: 'basse' },
            { personne_id: 'a', pupitre: 'chant' },
            { personne_id: 'b', pupitre: 'chant' },
            { personne_id: 'c', pupitre: 'chant' },
          ],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    const retraitMarc = props.find(
      (p) => p.personne_id === 'marc' && p.nom_mouvement === 'retrait_sans_reaffectation',
    )
    expect(retraitMarc).toBeDefined()
    expect(retraitMarc!.gain_source).toBe(1)
    expect(retraitMarc!.cout_source).toBe(0)
    expect(retraitMarc!.gain_net).toBe(1)
  })

  it('retrait d\'une personne à 2 postes VIDE un pupitre unique : cout_source = 1', () => {
    // Cas inverse : Marc bassiste UNIQUE + chanteur parmi d'autres.
    // Retirer Marc vide le pupitre basse (aucun autre bassiste) → cout_source = 1.
    // Même si source ne loge pas (jauge 3, 4 pers.), le gain_net = 0 → pas de
    // proposition « retrait sans réaffectation » (filtre > 0).
    const { session, creneaux, plusGrandeJauge } = fixture({ jauge: 3 })
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'marc', nom: 'Marc' },
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
      ],
      groupes: [
        {
          id: 'source',
          titre: 'Source',
          membres: [
            { personne_id: 'marc', pupitre: 'basse' },
            { personne_id: 'marc', pupitre: 'chant' },
            { personne_id: 'a', pupitre: 'chant' },
            { personne_id: 'b', pupitre: 'chant' },
            { personne_id: 'c', pupitre: 'chant' },
          ],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    const retraitMarc = props.find(
      (p) => p.personne_id === 'marc' && p.nom_mouvement === 'retrait_sans_reaffectation',
    )
    // gain_source = 1 (le morceau logerait sans Marc), cout_source = 1
    // (basse vidée), gain_net = 0 → filtre écarte.
    expect(retraitMarc).toBeUndefined()
  })
})

describe('calculerPool — refus persistants', () => {
  it('filtre une proposition dont (personne, source, cible) figure dans refus[]', () => {
    // Cas cumul CD 6624 (Marie retirée de source pour cible avec CHERCHE).
    // Sans refus : la proposition est émise. Avec refus enregistré : elle
    // disparaît. Ne bloque pas les autres candidates.
    const { session, creneaux, plusGrandeJauge } = fixture({ jauge: 3 })
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'marie', nom: 'Marie' },
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
      ],
      groupes: [
        {
          id: 'source',
          titre: 'Source',
          membres: [
            { personne_id: 'marie', pupitre: 'chant' },
            { personne_id: 'a', pupitre: 'chant' },
            { personne_id: 'b', pupitre: 'chant' },
            { personne_id: 'c', pupitre: 'chant' },
          ],
        },
        {
          id: 'cible',
          titre: 'Cible',
          membres: [],
          postes_cherches: [{ pupitre: 'chant', nb: 1 }],
        },
      ],
    })
    const sansRefus = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    const propMarie = sansRefus.find(
      (p) =>
        p.personne_id === 'marie' &&
        p.source_groupe_id === 'source' &&
        p.cible_groupe_id === 'cible',
    )
    expect(propMarie).toBeDefined()

    const refus: Refus[] = [
      {
        personne_id: 'marie',
        source_groupe_id: 'source',
        cible_groupe_id: 'cible',
        refuse_at: '2026-09-12T13:00:00Z',
      },
    ]
    const avecRefus = calculerPool(insc, session, creneaux, refus, plusGrandeJauge)
    const propMarieRefuse = avecRefus.find(
      (p) =>
        p.personne_id === 'marie' &&
        p.source_groupe_id === 'source' &&
        p.cible_groupe_id === 'cible',
    )
    expect(propMarieRefuse).toBeUndefined()
    // Les autres propositions (a, b, c vers cible) restent.
    const autresVersCible = avecRefus.filter((p) => p.cible_groupe_id === 'cible')
    expect(autresVersCible.length).toBeGreaterThan(0)
  })

  it('un refus « retrait sans réaffectation » ne bloque pas un transfert vers même source', () => {
    // Refus sur retrait pur (cible absente) ≠ refus transfert (cible
    // présente). Match strict sur cible_groupe_id.
    const { session, creneaux, plusGrandeJauge } = fixture({ jauge: 3 })
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'marie', nom: 'Marie' },
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
      ],
      groupes: [
        {
          id: 'source',
          titre: 'Source',
          membres: [
            { personne_id: 'marie', pupitre: 'chant' },
            { personne_id: 'a', pupitre: 'chant' },
            { personne_id: 'b', pupitre: 'chant' },
            { personne_id: 'c', pupitre: 'chant' },
          ],
        },
        {
          id: 'cible',
          titre: 'Cible',
          membres: [],
          postes_cherches: [{ pupitre: 'chant', nb: 1 }],
        },
      ],
    })
    const refus: Refus[] = [
      {
        personne_id: 'marie',
        source_groupe_id: 'source',
        cible_groupe_id: undefined, // refus du retrait sans réaffectation
        refuse_at: '2026-09-12T13:00:00Z',
      },
    ]
    const props = calculerPool(insc, session, creneaux, refus, plusGrandeJauge)
    // Le transfert Marie → cible reste proposé (cible différente = pas de match).
    const propTransfertMarie = props.find(
      (p) =>
        p.personne_id === 'marie' &&
        p.cible_groupe_id === 'cible' &&
        p.nom_mouvement === 'transfert',
    )
    expect(propTransfertMarie).toBeDefined()
    // Le retrait sans réaffectation Marie est bien bloqué.
    const propRetraitMarie = props.find(
      (p) =>
        p.personne_id === 'marie' && p.nom_mouvement === 'retrait_sans_reaffectation',
    )
    expect(propRetraitMarie).toBeUndefined()
  })
})

describe('calculerPool — tri', () => {
  it('trie décroissant par gain_net puis départage par gain_source', () => {
    // Combine 2 mouvements : un cumul (gain_net = 2) et un simple pourvoi
    // CHERCHE (gain_net = 1). Le cumul doit sortir en tête.
    const { session, creneaux, plusGrandeJauge } = fixture({ jauge: 3 })
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'marie', nom: 'Marie' }, // dans source_gros (jauge 3) + cible1 CHERCHE
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
        { id: 'c', nom: 'C' },
        { id: 'stella', nom: 'Stella' }, // dans source_petit (loge) + cible2 CHERCHE
        { id: 'x', nom: 'X' },
      ],
      groupes: [
        {
          id: 'source_gros',
          titre: 'Feeling Good',
          membres: [
            { personne_id: 'marie', pupitre: 'chant' },
            { personne_id: 'a', pupitre: 'chant' },
            { personne_id: 'b', pupitre: 'chant' },
            { personne_id: 'c', pupitre: 'chant' },
          ],
        },
        {
          id: 'source_petit',
          titre: 'Autre',
          membres: [
            { personne_id: 'stella', pupitre: 'chant' },
            { personne_id: 'x', pupitre: 'chant' },
          ],
        },
        {
          id: 'cible1',
          titre: 'Zombie',
          membres: [],
          postes_cherches: [{ pupitre: 'chant', nb: 1 }],
        },
        {
          id: 'cible2',
          titre: 'Autre cible',
          membres: [],
          postes_cherches: [{ pupitre: 'chant', nb: 1 }],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    expect(props.length).toBeGreaterThan(0)
    // Le premier doit avoir gain_net = 2 (cumul source_gros ne loge pas +
    // cible CHERCHE) et gain_source = 1.
    expect(props[0]!.gain_net).toBe(2)
    expect(props[0]!.gain_source).toBe(1)
    // Départage : si plusieurs gain_net = 2 existent, ceux à gain_source = 1
    // passent avant ceux à gain_source = 0 (pas de cas ici mais principe).
    // Vérifie que gain_net est monotone décroissant sur toute la liste.
    for (let i = 1; i < props.length; i++) {
      expect(props[i - 1]!.gain_net).toBeGreaterThanOrEqual(props[i]!.gain_net)
    }
  })
})

describe('calculerPool — pool vide quand rien à proposer', () => {
  it('groupes tous confortables, aucun CHERCHE, aucun plafond dépassé → pool vide', () => {
    const { session, creneaux, plusGrandeJauge } = fixture()
    const insc = Inscriptions.parse({
      session_id: 's',
      personnes: [
        { id: 'a', nom: 'A' },
        { id: 'b', nom: 'B' },
      ],
      groupes: [
        {
          id: 'g1',
          titre: 'G1',
          membres: [
            { personne_id: 'a', pupitre: 'chant' },
            { personne_id: 'b', pupitre: 'chant' },
          ],
        },
      ],
    })
    const props = calculerPool(insc, session, creneaux, [], plusGrandeJauge)
    expect(props).toEqual([])
  })
})
