import type { Creneau } from '../domain/grille'
import type { Inscriptions, Lieu, Session } from '../domain/model'
import { libellePersonne } from '../domain/model'
import type { Assignation } from '../engine/types'

/**
 * Exports CSV — deux états V1 (brief §0/§5) :
 *  - `balance_par_groupe.csv`  : feuille de route par groupe
 *  - `balance_par_salle.csv`   : occupation chronologique salle par salle
 *
 * Convention Excel-friendly : séparateur `;`, BOM UTF-8, guillemets
 * doubles pour l'échappement.
 */

const BOM = '\ufeff'
const SEP = ';'

function csvCell(v: unknown): string {
  const s = v == null ? '' : String(v)
  if (s.includes('"') || s.includes(SEP) || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function csvRows(rows: unknown[][]): string {
  return BOM + rows.map((r) => r.map(csvCell).join(SEP)).join('\r\n') + '\r\n'
}

/* -------------------------------------------- Feuille de route / groupe ---*/

export function tableauParGroupe(
  session: Session,
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  assignations: Assignation[],
): unknown[][] {
  const cible = session.repetitions_visees
  const creneauxParId = new Map(creneaux.map((c) => [c.id, c]))
  const sallesParId = new Map(lieu.salles.map((s) => [s.id, s]))
  const parGroupe = new Map<string, Assignation[]>()
  for (const a of assignations) {
    if (!parGroupe.has(a.groupe_id)) parGroupe.set(a.groupe_id, [])
    parGroupe.get(a.groupe_id)!.push(a)
  }

  const enTete: string[] = ['N°', 'Groupe', 'Responsable', 'Style', 'Tonalité', 'Effectif']
  for (let i = 1; i <= cible; i++) {
    enTete.push(`Jour ${i}`, `Horaire ${i}`, `Salle ${i}`)
  }
  enTete.push('Nb répétitions')

  const rows: unknown[][] = [enTete]
  inscriptions.groupes.forEach((g, idx) => {
    const list = (parGroupe.get(g.id) ?? [])
      .map((a) => ({ a, c: creneauxParId.get(a.creneau_id)! }))
      .filter((x) => x.c != null)
      .sort((x, y) => `${x.c.date}T${x.c.debut}`.localeCompare(`${y.c.date}T${y.c.debut}`))
    const effectif = new Set(g.membres.map((m) => m.personne_id)).size
    const row: unknown[] = [
      idx + 1,
      g.titre,
      g.responsable_id,
      g.style,
      g.tonalite,
      effectif,
    ]
    for (let i = 0; i < cible; i++) {
      const item = list[i]
      if (item) {
        row.push(item.c.date, `${item.c.debut}-${item.c.fin}`, sallesParId.get(item.a.salle_id)?.nom ?? item.a.salle_id)
      } else {
        row.push('', '', '')
      }
    }
    row.push(list.length)
    rows.push(row)
  })

  return rows
}

export function csvParGroupe(
  session: Session,
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  assignations: Assignation[],
): string {
  return csvRows(tableauParGroupe(session, lieu, inscriptions, creneaux, assignations))
}

/* --------------------------------------------- Occupation par salle -----*/

export function tableauParSalle(
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  assignations: Assignation[],
): unknown[][] {
  const groupesParId = new Map(inscriptions.groupes.map((g) => [g.id, g]))
  const personnesParId = new Map(inscriptions.personnes.map((p) => [p.id, p]))
  const parCreneauSalle = new Map<string, Assignation>()
  for (const a of assignations) parCreneauSalle.set(`${a.creneau_id}|${a.salle_id}`, a)

  const rows: unknown[][] = [['Salle', 'Jour', 'Horaire', 'Groupe', 'Responsable', 'État']]
  const creneauxTries = [...creneaux].sort((a, b) =>
    `${a.date}T${a.debut}`.localeCompare(`${b.date}T${b.debut}`),
  )

  for (const salle of lieu.salles.filter((s) => s.actif)) {
    for (const c of creneauxTries) {
      if (!c.salles.includes(salle.id)) continue
      const a = parCreneauSalle.get(`${c.id}|${salle.id}`)
      if (a) {
        const g = groupesParId.get(a.groupe_id)
        const respPersonne = g ? personnesParId.get(g.responsable_id) : undefined
        const respLibelle = respPersonne ? libellePersonne(respPersonne) : g?.responsable_id ?? ''
        rows.push([salle.nom, c.date, `${c.debut}-${c.fin}`, g?.titre ?? a.groupe_id, respLibelle, 'occupée'])
      } else {
        rows.push([salle.nom, c.date, `${c.debut}-${c.fin}`, '', '', 'libre'])
      }
    }
  }

  return rows
}

export function csvParSalle(
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  assignations: Assignation[],
): string {
  return csvRows(tableauParSalle(lieu, inscriptions, creneaux, assignations))
}

/* --------------------------------------------- Planning par musicien ---*/

export function tableauParMusicien(
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  assignations: Assignation[],
): unknown[][] {
  const creneauxParId = new Map(creneaux.map((c) => [c.id, c]))
  const sallesParId = new Map(lieu.salles.map((s) => [s.id, s]))
  const groupesParId = new Map(inscriptions.groupes.map((g) => [g.id, g]))

  // Pour chaque personne, la liste triée de ses engagements
  const parPersonne = new Map<string, Array<{ a: Assignation; c: Creneau }>>()
  for (const a of assignations) {
    const c = creneauxParId.get(a.creneau_id)
    const g = groupesParId.get(a.groupe_id)
    if (!c || !g) continue
    const membres = new Set(g.membres.map((m) => m.personne_id))
    for (const pid of membres) {
      if (!parPersonne.has(pid)) parPersonne.set(pid, [])
      parPersonne.get(pid)!.push({ a, c })
    }
  }

  const rows: unknown[][] = [['Musicien', 'Jour', 'Horaire', 'Groupe', 'Salle']]
  const personnesTriees = [...inscriptions.personnes].sort((a, b) =>
    libellePersonne(a).localeCompare(libellePersonne(b), 'fr'),
  )
  for (const p of personnesTriees) {
    const items = (parPersonne.get(p.id) ?? []).sort((x, y) =>
      `${x.c.date}T${x.c.debut}`.localeCompare(`${y.c.date}T${y.c.debut}`),
    )
    if (items.length === 0) continue
    for (const { a, c } of items) {
      const g = groupesParId.get(a.groupe_id)
      rows.push([
        libellePersonne(p),
        c.date,
        `${c.debut}-${c.fin}`,
        g?.titre ?? a.groupe_id,
        sallesParId.get(a.salle_id)?.nom ?? a.salle_id,
      ])
    }
  }

  return rows
}

export function csvParMusicien(
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  assignations: Assignation[],
): string {
  return csvRows(tableauParMusicien(lieu, inscriptions, creneaux, assignations))
}

/* ------------------------------------------------ Téléchargement navigateur */

/** Déclenche le téléchargement d'une chaîne CSV via un `<a href="blob:…">`. */
export function telechargerCsv(nom: string, contenu: string): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([contenu], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nom
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
