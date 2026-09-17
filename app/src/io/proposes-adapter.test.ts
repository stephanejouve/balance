import { describe, expect, it } from 'vitest'
import type { Personne } from '../domain/model'
import {
  MAPPING_PROPOSES_DEFAUT,
  extraireProposes,
  normaliserDate,
  normaliserHeure,
} from './proposes-adapter'

const personnes = (ids: string[]): Personne[] =>
  ids.map((id) => ({
    id,
    nom: id,
    discriminant: '',
    instruments: [],
    role: 'musicien' as const,
    indispos: [],
  }))

describe('normaliserDate', () => {
  it('accepte ISO tel quel', () => {
    expect(normaliserDate('2026-08-28')).toBe('2026-08-28')
  })
  it('convertit JJ/MM/AAAA', () => {
    expect(normaliserDate('28/08/2026')).toBe('2026-08-28')
  })
  it('convertit JJ-MM-AAAA', () => {
    expect(normaliserDate('28-08-2026')).toBe('2026-08-28')
  })
})

describe('normaliserHeure', () => {
  it('accepte HH:MM tel quel', () => {
    expect(normaliserHeure('09:30')).toBe('09:30')
  })
  it('convertit 9h30', () => {
    expect(normaliserHeure('9h30')).toBe('09:30')
  })
  it('convertit 9h → 09:00', () => {
    expect(normaliserHeure('9h')).toBe('09:00')
  })
})

describe('extraireProposes', () => {
  it('fusionne les lignes de même titre en 1 Impose avec N séances', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin', 'Salle'],
      ['Blowin', 'karl, emma', '2026-08-28', '09:00', '10:00', 'XV'],
      ['Blowin', 'karl, emma', '2026-08-29', '14:00', '15:00', ''],
      ['Autumn', 'karl', '2026-08-28', '10:00', '11:00', ''],
    ]
    const { imposes, warnings } = extraireProposes(
      rows,
      MAPPING_PROPOSES_DEFAUT,
      personnes(['karl', 'emma']),
    )
    expect(warnings).toEqual([])
    expect(imposes).toHaveLength(2)
    expect(imposes[0].morceau).toBe('Blowin')
    expect(imposes[0].membres).toEqual(['karl', 'emma'])
    expect(imposes[0].seances).toHaveLength(2)
    expect(imposes[0].seances[0]).toEqual({
      date: '2026-08-28',
      debut: '09:00',
      fin: '10:00',
      duree_minutes: 60,
      salle_id: 'XV',
    })
    expect(imposes[1].morceau).toBe('Autumn')
    expect(imposes[1].seances).toHaveLength(1)
  })

  it('warn membre inconnu et l\'ignore (référentiel non vide → orphan probable)', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
      ['Blowin', 'karl, inconnu', '2026-08-28', '09:00', '10:00'],
    ]
    const { imposes, warnings } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    expect(imposes[0].membres).toEqual(['karl'])
    // Nouveau message : quand un référentiel est fourni, l'absence signale
    // une erreur d'orthographe côté saisie (pas une carence d'import).
    expect(warnings.some((w) => w.includes('non trouvé dans le référentiel'))).toBe(true)
    // Anti-régression audit Stéphane 2026-09-03 : plus jamais le guidage
    // trompeur « importe d'abord l'onglet Liste ou Stagiaires ».
    expect(warnings.some((w) => w.includes("importe d'abord"))).toBe(false)
  })

  it('warn différencié quand aucun référentiel (classeur Proposés seul)', () => {
    // Cas produit par l'import PDF de Leader : Stagiaires/Liste vides, seul
    // Proposés est peuplé. Les membres du PDF sont réellement à créer côté
    // Stagiaires — le warning doit le dire, pas suggérer une erreur de manip.
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
      ['Autumn Leaves', 'Denis (A)', '2026-08-28', '09:00', '10:00'],
    ]
    const { imposes, warnings } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, [])
    expect(imposes[0].membres).toEqual([]) // le membre est skip
    expect(warnings.some((w) => w.includes('à créer ou à compléter côté Stagiaires'))).toBe(true)
    expect(warnings.some((w) => w.includes("importe d'abord"))).toBe(false)
  })

  it('renvoie warning si colonne obligatoire manquante', () => {
    const rows = [
      ['Morceau', 'Date', 'Début', 'Fin'], // pas de « Membres »
      ['Blowin', '2026-08-28', '09:00', '10:00'],
    ]
    const { imposes, warnings } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, [])
    expect(imposes).toEqual([])
    expect(warnings[0]).toContain('Membres')
  })

  it('ignore les lignes avec date/heure incomplète', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
      ['Blowin', 'karl', '', '09:00', '10:00'],
    ]
    const { imposes, warnings } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    expect(imposes).toEqual([])
    expect(warnings.some((w) => w.includes('incomplet'))).toBe(true)
  })

  it('gère le format horaire « 9h » et date FR « 28/08/2026 »', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
      ['Blowin', 'karl', '28/08/2026', '9h', '10h30'],
    ]
    const { imposes } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    expect(imposes[0].seances[0]).toEqual({
      date: '2026-08-28',
      debut: '09:00',
      fin: '10:30',
      duree_minutes: 90,
    })
  })

  // ─── Colonne Durée (cap durée CD 6902+6904) ───────────────────────────
  it('accepte la colonne « Durée (min) » et la stocke dans duree_minutes', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin', 'Durée (min)'],
      ['Blowin', 'karl', '2026-08-28', '09:00', '10:00', '60'],
    ]
    const { imposes } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    expect(imposes[0].seances[0]).toEqual({
      date: '2026-08-28',
      debut: '09:00',
      fin: '10:00',
      duree_minutes: 60,
    })
  })

  it('dérive fin depuis durée quand Fin est vide (seule Durée renseignée)', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin', 'Durée (min)'],
      ['Blowin', 'karl', '2026-08-28', '09:00', '', '60'],
    ]
    const { imposes } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    expect(imposes[0].seances[0].fin).toBe('10:00')
    expect(imposes[0].seances[0].duree_minutes).toBe(60)
  })

  it('divergence fin/durée : durée l’emporte, fin recalculée silencieusement (CD 6885)', () => {
    // `18:00 → 19:00 + 90` : la fin donnée (60 min) diverge de la durée
    // (90). Canonique post-cap = durée. Fin réécrite en 19:30. Pas
    // d'alarme sur divergence (CD 6885 : ne pas sonner sur chaque ligne).
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin', 'Durée (min)'],
      ['Blowin', 'karl', '2026-08-28', '18:00', '19:00', '90'],
    ]
    const { imposes, warnings } = extraireProposes(
      rows,
      MAPPING_PROPOSES_DEFAUT,
      personnes(['karl']),
    )
    expect(imposes[0].seances[0].fin).toBe('19:30')
    expect(imposes[0].seances[0].duree_minutes).toBe(90)
    expect(warnings.filter((w) => w.includes('divergen'))).toEqual([])
  })

  it('cohérence fin/durée : les deux préservés tels quels', () => {
    // Cas fréquent CD 6891 : `18:00 → 19:00 + 60` cohérent naturellement
    // avec la formule exclusive `fin − debut = duree`, aucune canonisation.
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin', 'Durée (min)'],
      ['Blowin', 'karl', '2026-08-28', '18:00', '19:00', '60'],
    ]
    const { imposes } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    expect(imposes[0].seances[0].fin).toBe('19:00')
    expect(imposes[0].seances[0].duree_minutes).toBe(60)
  })

  it('warning si ni Fin ni Durée renseignée pour une séance', () => {
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin', 'Durée (min)'],
      ['Blowin', 'karl', '2026-08-28', '09:00', '', ''],
    ]
    const { imposes, warnings } = extraireProposes(
      rows,
      MAPPING_PROPOSES_DEFAUT,
      personnes(['karl']),
    )
    expect(imposes).toEqual([])
    expect(warnings.some((w) => w.includes('ni Fin ni Durée'))).toBe(true)
  })

  it('rétro-compat : template sans colonne Durée dérive duree_minutes depuis Fin (symétrie CD 7057)', () => {
    // Post-fix symétrie : `seance.duree_minutes` est TOUJOURS renseigné,
    // même quand la colonne Durée est absente (dérivé fin−debut selon
    // convention exclusive CD 6891). Avant, l'UI Imposes affichait un
    // champ durée VIDE pour les 36 séances du fichier stress-test.
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin'],
      ['Blowin', 'karl', '2026-08-28', '09:00', '10:00'],
    ]
    const { imposes } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    expect(imposes[0].seances[0]).toEqual({
      date: '2026-08-28',
      debut: '09:00',
      fin: '10:00',
      duree_minutes: 60,
    })
  })

  // ─── Invariant symétrie (CD 6990 anomalie 1, feu vert CD 7007) ────────────
  it('invariant : toute Seance sortie de extraireProposes a fin ET duree_minutes cohérents', () => {
    // Garde-fou négatif (feedback CD 6701) : verrouille l'invariant post-fix.
    // 3 chemins (fin+duree, fin only, duree only) → tous produisent les 2 champs.
    const rows = [
      ['Morceau', 'Membres', 'Date', 'Début', 'Fin', 'Durée (min)'],
      ['A', 'karl', '2026-08-28', '09:00', '10:00', '60'], // les deux
      ['B', 'karl', '2026-08-28', '09:00', '10:30', ''], // fin only
      ['C', 'karl', '2026-08-28', '09:00', '', '90'], // durée only
    ]
    const { imposes } = extraireProposes(rows, MAPPING_PROPOSES_DEFAUT, personnes(['karl']))
    const seances = imposes.flatMap((i) => i.seances)
    expect(seances).toHaveLength(3)
    for (const s of seances) {
      expect(s.fin, `seance ${s.date} sans fin`).toBeDefined()
      expect(s.duree_minutes, `seance ${s.date} sans duree`).toBeDefined()
      // Cohérence exclusive CD 6891.
      const [dh, dm] = s.debut.split(':').map(Number)
      const [fh, fm] = s.fin.split(':').map(Number)
      const debutMin = dh * 60 + dm
      const finMin = fh === 0 && fm === 0 ? 1439 : fh * 60 + fm
      expect(finMin - debutMin).toBe(s.duree_minutes)
    }
  })
})
