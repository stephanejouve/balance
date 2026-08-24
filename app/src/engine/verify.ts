import type { Creneau } from '../domain/grille'
import type { Groupe, Inscriptions, Lieu, Personne, Pupitre, Salle, Session } from '../domain/model'
import { libellePersonne } from '../domain/model'
import type { RegistreContraintes } from './contraintes'
import { actif } from './contraintes'
import type { Assignation, Probleme, Solution } from './types'

/**
 * Vérification indépendante de la solution (brief §4 "à conserver
 * absolument"). Ne partage aucune structure de données avec le solveur —
 * seulement les entrées et la solution finale. C'est ce qui a permis au
 * prototype d'attraper plusieurs bugs de placement.
 */

interface Contexte {
  session: Session
  lieu: Lieu
  inscriptions: Inscriptions
  creneaux: Creneau[]
  personnesParId: Map<string, Personne>
  creneauxParId: Map<string, Creneau>
  groupesParId: Map<string, Groupe>
  sallesParId: Map<string, Salle>
}

function bâtirContexte(
  session: Session,
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
): Contexte {
  return {
    session,
    lieu,
    inscriptions,
    creneaux,
    personnesParId: new Map(inscriptions.personnes.map((p) => [p.id, p])),
    creneauxParId: new Map(creneaux.map((c) => [c.id, c])),
    groupesParId: new Map(inscriptions.groupes.map((g) => [g.id, g])),
    sallesParId: new Map(lieu.salles.map((s) => [s.id, s])),
  }
}

function personnesDe(groupe: Groupe): string[] {
  return [...new Set(groupe.membres.map((m) => m.personne_id))]
}

function pupitresDe(personne_id: string, groupe: Groupe): Pupitre[] {
  return groupe.membres.filter((m) => m.personne_id === personne_id).map((m) => m.pupitre)
}

function dureeCreneauMin(c: Creneau): number {
  const [dh, dm] = c.debut.split(':').map(Number)
  const [fh, fm] = c.fin.split(':').map(Number)
  return fh * 60 + fm - (dh * 60 + dm)
}

/**
 * Renvoie le type de restriction bloquante pour ce couple (salle, créneau),
 * ou `null` si la salle est utilisable sans réserve.
 *
 * - `interdit` bloque toujours.
 * - `pas_reduit` bloque si la durée du créneau dépasse `pas_max_minutes`.
 * - `acoustique_seulement` n'est pas bloquant à V1 mais renvoyé comme
 *   information (le solveur / verify le traite comme warning).
 *
 * `r.jours` restreint la restriction à des dates ISO précises (vide = tous
 * les jours).
 */
export function salleRestreinte(
  salle: Salle,
  creneau: Creneau,
): 'interdit' | 'acoustique_seulement' | 'pas_reduit' | null {
  for (const r of salle.restrictions) {
    if (r.jours.length > 0 && !r.jours.includes(creneau.date)) continue
    if (creneau.debut < r.debut || creneau.debut >= r.fin) continue
    if (r.contrainte === 'interdit') return 'interdit'
    if (r.contrainte === 'pas_reduit') {
      const max = r.pas_max_minutes ?? Infinity
      if (dureeCreneauMin(creneau) > max) return 'pas_reduit'
    }
    if (r.contrainte === 'acoustique_seulement') return 'acoustique_seulement'
  }
  return null
}

function indispoBloque(personne: Personne, creneau: Creneau, pupitres: Pupitre[]): boolean {
  return personne.indispos.some((ind) => {
    if (ind.jours.length > 0 && !ind.jours.includes(creneau.date)) return false
    if (ind.roles.length > 0 && !pupitres.some((p) => ind.roles.includes(p))) return false
    // Cf. commentaire sémantique dans solver.ts::indispoBloque
    if (!ind.debut && !ind.fin) return true
    if (ind.debut && !ind.fin) return creneau.debut === ind.debut
    if (ind.debut && creneau.debut < ind.debut) return false
    if (ind.fin && creneau.debut >= ind.fin) return false
    return true
  })
}

export function verifier(
  session: Session,
  lieu: Lieu,
  inscriptions: Inscriptions,
  creneaux: Creneau[],
  assignations: Assignation[],
  registre?: RegistreContraintes,
): Probleme[] {
  const ctx = bâtirContexte(session, lieu, inscriptions, creneaux)
  const problemes: Probleme[] = []

  // Butoir : le créneau doit exister ET tomber avant butoir (le générateur le
  // garantit déjà — on vérifie que l'assignation ne pointe pas hors grille).
  const butoirKey = `${session.date_butoir}T${session.butoir_heure.replace(':', '')}`

  // Index par créneau : liste des assignations
  const parCreneau = new Map<string, Assignation[]>()
  for (const a of assignations) {
    if (!parCreneau.has(a.creneau_id)) parCreneau.set(a.creneau_id, [])
    parCreneau.get(a.creneau_id)!.push(a)
  }

  for (const [creneau_id, ass] of parCreneau) {
    const creneau = ctx.creneauxParId.get(creneau_id)
    if (!creneau) {
      ass.forEach((a) =>
        problemes.push({
          type: 'apres-butoir',
          message: `créneau ${creneau_id} inconnu de la grille`,
          creneau_id,
          groupe_id: a.groupe_id,
        }),
      )
      continue
    }

    const creneauKey = `${creneau.date}T${creneau.debut.replace(':', '')}`
    if (actif(registre, 'avant-butoir') && creneauKey >= butoirKey) {
      ass.forEach((a) =>
        problemes.push({
          type: 'apres-butoir',
          message: `${creneau.date} ${creneau.debut} tombe au-delà du butoir ${session.date_butoir} ${session.butoir_heure}`,
          creneau_id,
          groupe_id: a.groupe_id,
        }),
      )
    }

    // Salles disponibles sur ce créneau
    const sallesDispo = new Set(creneau.salles)
    const sallesPrises = new Set<string>()
    for (const a of ass) {
      if (actif(registre, 'salle-hors-creneau') && !sallesDispo.has(a.salle_id)) {
        problemes.push({
          type: 'salle-hors-creneau',
          message: `salle ${a.salle_id} non ouverte au créneau ${creneau.date} ${creneau.debut}`,
          creneau_id,
          groupe_id: a.groupe_id,
          salle_id: a.salle_id,
        })
      }
      if (actif(registre, 'salle-unique-groupe') && sallesPrises.has(a.salle_id)) {
        problemes.push({
          type: 'salle-double-bookee',
          message: `salle ${a.salle_id} prise deux fois au créneau ${creneau.date} ${creneau.debut}`,
          creneau_id,
          salle_id: a.salle_id,
        })
      }
      sallesPrises.add(a.salle_id)
    }

    // Vérifier restrictions horaires par salle
    if (actif(registre, 'restriction-horaire-salle')) {
      for (const a of ass) {
        const s = ctx.sallesParId.get(a.salle_id)
        if (!s) continue
        const restr = salleRestreinte(s, creneau)
        if (restr === 'interdit') {
          problemes.push({
            type: 'salle-hors-creneau',
            message: `${s.nom} est fermée au créneau ${creneau.date} ${creneau.debut} (restriction horaire)`,
            creneau_id,
            salle_id: a.salle_id,
            groupe_id: a.groupe_id,
          })
        } else if (restr === 'pas_reduit') {
          problemes.push({
            type: 'salle-hors-creneau',
            message: `${s.nom} : le créneau ${creneau.date} ${creneau.debut} (${dureeCreneauMin(creneau)} min) dépasse la durée maximale autorisée`,
            creneau_id,
            salle_id: a.salle_id,
            groupe_id: a.groupe_id,
          })
        }
      }
    }

    // Vérifier jauge par groupe
    if (actif(registre, 'jauge-salle')) {
      for (const a of ass) {
        const g = ctx.groupesParId.get(a.groupe_id)
        const s = ctx.sallesParId.get(a.salle_id)
        if (!g || !s) continue
        const effectif = personnesDe(g).length
        if (effectif > s.jauge) {
          problemes.push({
            type: 'jauge-depassee',
            message: `${g.titre} (${effectif} musiciens) dépasse la jauge de ${s.nom} (${s.jauge})`,
            creneau_id,
            groupe_id: a.groupe_id,
            salle_id: a.salle_id,
          })
        }
      }
    }

    // Vérifier collisions de personnes entre groupes sur ce créneau
    if (actif(registre, 'personne-unique-moment')) {
      const vus = new Map<string, string>() // personne_id -> groupe_id
      for (const a of ass) {
        const g = ctx.groupesParId.get(a.groupe_id)
        if (!g) continue
        for (const pid of personnesDe(g)) {
          if (vus.has(pid) && vus.get(pid) !== a.groupe_id) {
            const p = ctx.personnesParId.get(pid)
            problemes.push({
              type: 'personne-double-bookee',
              message: `${p ? libellePersonne(p) : pid} joue dans deux groupes au créneau ${creneau.date} ${creneau.debut}`,
              creneau_id,
              personne_id: pid,
            })
          }
          vus.set(pid, a.groupe_id)
        }
      }
    }

    // Vérifier indispos
    if (actif(registre, 'personne-indispo')) {
      for (const a of ass) {
        const g = ctx.groupesParId.get(a.groupe_id)
        if (!g) continue
        for (const pid of personnesDe(g)) {
          const p = ctx.personnesParId.get(pid)
          if (!p) continue
          const pupitres = pupitresDe(pid, g)
          if (indispoBloque(p, creneau, pupitres)) {
            problemes.push({
              type: 'personne-indispo',
              message: `${libellePersonne(p)} est indisponible au créneau ${creneau.date} ${creneau.debut}`,
              creneau_id,
              personne_id: pid,
              groupe_id: a.groupe_id,
            })
          }
        }
      }
    }
  }

  // Vérifier créneaux consécutifs pour un même groupe
  if (actif(registre, 'creneaux-consecutifs')) {
    const parGroupe = new Map<string, Creneau[]>()
    for (const a of assignations) {
      const c = ctx.creneauxParId.get(a.creneau_id)
      if (!c) continue
      if (!parGroupe.has(a.groupe_id)) parGroupe.set(a.groupe_id, [])
      parGroupe.get(a.groupe_id)!.push(c)
    }
    for (const [groupe_id, cs] of parGroupe) {
      const tries = [...cs].sort((a, b) => a.id.localeCompare(b.id))
      for (let i = 1; i < tries.length; i++) {
        const prev = tries[i - 1]
        const curr = tries[i]
        if (prev.date === curr.date && prev.fin === curr.debut) {
          problemes.push({
            type: 'creneaux-consecutifs',
            message: `${groupe_id} : deux créneaux consécutifs le ${curr.date} (${prev.debut}-${prev.fin} puis ${curr.debut}-${curr.fin})`,
            groupe_id,
          })
        }
      }
    }
  }

  return problemes
}

export function couverture(
  session: Session,
  inscriptions: Inscriptions,
  assignations: Assignation[],
): Solution['couverture'] {
  const compte = new Map<string, number>()
  for (const a of assignations) compte.set(a.groupe_id, (compte.get(a.groupe_id) ?? 0) + 1)
  return inscriptions.groupes.map((g) => ({
    groupe_id: g.id,
    obtenu: compte.get(g.id) ?? 0,
    cible: session.repetitions_visees,
    min: session.repetitions_min,
  }))
}
