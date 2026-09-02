import type { LegacyInscriptions } from './legacy'
import { detacherNomInstrument } from './legacy'
import type { Groupe, Impose, Indispo, Inscriptions, MembreGroupe, Personne, Pupitre } from './model'
import { PUPITRES_DEFAULTS, slug } from './model'

/**
 * Conversion `LegacyInscriptions` (format prototype `apero_mercredi.json`) →
 * modèle canonique `Inscriptions`.
 *
 * Choix :
 *  - Une personne unique par couple `(nom, discriminant)`. Le discriminant
 *    est extrait du texte entre parenthèses non-instrumental (`Pierre (SIG)`,
 *    `Emmanuelle (B)` → discriminant `(SIG)` / `(B)`).
 *  - Les instruments sont agrégés depuis toutes les mentions de la personne
 *    (groupes + morceaux imposés). Pas de dédoublonnage détaillé — un même
 *    pupitre écrase les précisions.
 *  - Les `indispos` legacy (heure de début seule) deviennent des `Indispo`
 *    canoniques avec `debut` renseigné et `roles` propagés.
 *  - `responsable_id` = `slug(resp)` sans matching strict avec les personnes
 *    (résolution reportée à l'UI).
 *  - `identitesConnues` est ignoré : la refonte impose la désambiguation à
 *    la saisie (cf. `docs/regles-saisie.md`).
 */

/** Décomposition du texte membre legacy en composants normalisés. */
interface Decomposition {
  nom: string
  discriminant: string
  instrument: string
}

function decomposer(entree: string): Decomposition {
  const { nom, instrument } = detacherNomInstrument(entree)
  const m = nom.match(/^(.*?)\s*\(([^)]+)\)\s*$/)
  if (m) return { nom: m[1].trim(), discriminant: `(${m[2].trim()})`, instrument }
  return { nom, discriminant: '', instrument }
}

function cleId(nom: string, discriminant: string): string {
  return discriminant ? slug(`${nom} ${discriminant}`) : slug(nom)
}

/**
 * Mappe un instrument libre (ex: `contrebasse`, `clarinette basse`, `sax sop`)
 * vers un pupitre canonique + une précision optionnelle.
 */
export function pupitreDe(instrument: string): { pupitre: Pupitre; precision?: string } {
  const s = instrument.trim().toLowerCase()
  if (!s) return { pupitre: 'chant' }
  const table: Array<[RegExp, Pupitre]> = [
    [/^(chant|voix|choeur|ch(oe|œ)ur)/, 'chant'],
    [/^(piano|clavier|orgue)/, 'piano'],
    [/^(basse|contrebasse)/, 'basse'],
    [/^(batterie|percussion|cajon)/, 'batterie'],
    [/^(guitare|banjo|ukul|mandoline)/, 'guitare'],
    [
      /^(vents?|sax|saxo|clarinette|fl(û|u)te|trompette|trombone|bugle|cor|tuba|harmonica|accord(é|e)on|violon|violoncelle|alto|harpe)/,
      'vents',
    ],
  ]
  for (const [re, pup] of table) {
    if (re.test(s)) return { pupitre: pup, precision: s === pup ? undefined : instrument.trim() }
  }
  return { pupitre: 'vents', precision: instrument.trim() }
}

function extrairePupitresCherches(cherche: string): Pupitre[] {
  const connus = new Set<Pupitre>(PUPITRES_DEFAULTS)
  const out = new Set<Pupitre>()
  cherche
    .split(',')
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean)
    .forEach((item) => {
      const m = item.match(/^([a-zà-öø-ÿ]+)/i)
      const head = m ? m[1] : item
      if (connus.has(head)) out.add(head)
    })
  return [...out]
}

export function migrerInscriptions(legacy: LegacyInscriptions, session_id: string): Inscriptions {
  interface Aggreg {
    nom: string
    discriminant: string
    instruments: Map<Pupitre, string | undefined>
  }
  const agreg = new Map<string, Aggreg>()

  const ingerer = (entree: string) => {
    const d = decomposer(entree)
    const id = cleId(d.nom, d.discriminant)
    if (!agreg.has(id)) {
      agreg.set(id, { nom: d.nom, discriminant: d.discriminant, instruments: new Map() })
    }
    if (d.instrument) {
      const { pupitre, precision } = pupitreDe(d.instrument)
      const a = agreg.get(id)!
      if (!a.instruments.has(pupitre)) a.instruments.set(pupitre, precision)
    }
  }

  legacy.groupes.forEach((g) => g.membres.forEach(ingerer))
  Object.values(legacy.membresImposes).forEach((liste) => liste.forEach(ingerer))
  legacy.indispos.forEach((r) => r.noms.forEach(ingerer))

  const personnes: Personne[] = [...agreg.entries()].map(([id, a]) => ({
    id,
    nom: a.nom,
    discriminant: a.discriminant,
    instruments: [...a.instruments.entries()].map(([pupitre, precision]) => ({
      pupitre,
      precision,
      lourd: false,
    })),
    role: 'musicien',
    indispos: [],
  }))

  const parId = new Map(personnes.map((p) => [p.id, p]))
  legacy.indispos.forEach((r) => {
    r.noms.forEach((n) => {
      const d = decomposer(n)
      const p = parId.get(cleId(d.nom, d.discriminant))
      if (!p) return
      r.heures.forEach((h) => {
        const ind: Indispo = {
          jours: [],
          debut: h,
          roles: r.roles ?? [],
          motif: r.motif,
        }
        p.indispos.push(ind)
      })
    })
  })

  const groupes: Groupe[] = legacy.groupes.map((g) => {
    const membres: MembreGroupe[] = g.membres.map((entree) => {
      const d = decomposer(entree)
      const personne_id = cleId(d.nom, d.discriminant)
      const { pupitre, precision } = d.instrument
        ? pupitreDe(d.instrument)
        : { pupitre: 'chant' as Pupitre, precision: undefined }
      return { personne_id, pupitre, precision }
    })
    return {
      id: slug(g.nom),
      titre: g.m1 || g.nom,
      auteur: '',
      style: g.style,
      tonalite: g.ton,
      responsable_id: g.resp ? slug(g.resp) : '',
      membres,
      postes_cherches: extrairePupitresCherches(g.cherche),
      repetitions_deja_faites: 0,
      echeance: 'apero_mercredi' as const,
    }
  })

  const imposes: Impose[] = Object.entries(legacy.membresImposes).map(([morceau, membresRaw]) => {
    const membres = (membresRaw ?? []).map((entree) => {
      const d = decomposer(entree)
      return cleId(d.nom, d.discriminant)
    })
    return {
      id: slug(morceau),
      morceau,
      membres: [...new Set(membres)],
      seances: [], // les horaires ne sont pas dans le JSON legacy — à saisir séparément
    }
  })

  return { session_id, personnes, groupes, imposes }
}
