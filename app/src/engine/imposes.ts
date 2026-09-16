import type { Creneau } from '../domain/grille'
import { finMinutesDe } from '../domain/grille'
import type { HhMm, Indispo, Inscriptions, Personne, Salle } from '../domain/model'

/** `HH:MM` → total de minutes depuis minuit. */
function toMinutes(t: HhMm): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

/** Normalisation pour matching de salle : lowercase + strip accents + trim. */
function normaliserNomSalle(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/**
 * Résout la `salle_id` texte libre d'une séance imposée vers l'id
 * canonique d'une salle du lieu. Match par id exact OU par nom (case
 * + accents insensible). Retourne `null` si aucune salle du lieu ne
 * correspond — cas typique d'un import où le classeur porte un nom de
 * salle qui n'a pas de contrepartie côté configuration.
 *
 * Contrat : le texte libre `Seance.salle_id` reste stocké tel qu'il a
 * été saisi (rétro-compat modèle post CD 7016 (A) — voir ticket (B)
 * pour la migration texte → référence). La résolution vit au niveau
 * PRÉSENTATION (Carte, Par salle) et au niveau ALERTE (import).
 */
export function resoudreSalleImposeeVersLieu(
  salleSaisie: string | undefined,
  salles: readonly Salle[],
): string | null {
  if (!salleSaisie) return null
  const norm = normaliserNomSalle(salleSaisie)
  if (!norm) return null
  for (const s of salles) {
    if (normaliserNomSalle(s.id) === norm || normaliserNomSalle(s.nom) === norm) {
      return s.id
    }
  }
  return null
}

/**
 * Pour un créneau donné, renvoie la Map `<salle_id, { impose_id,
 * morceau }>` des séances imposées qui occupent une salle du lieu à
 * cet horaire. Utilisé par Carte et Par salle pour marquer les cases
 * occupées (CD 7016 (A) : « l'affichage cesse de mentir »).
 *
 * Matching :
 *  - Même jour : `seance.date === creneau.date`.
 *  - Chevauchement horaire : convention EXCLUSIVE des 2 côtés. Un
 *    créneau `[c.debut, c.fin[` et une séance `[s.debut, s.finExc[`
 *    se chevauchent SSI `s.debut < c.fin && s.finExc > c.debut`.
 *    `s.finExc` = `finMinutesDe(s) + 1` (dernière minute occupée + 1).
 *  - Salle : `Seance.salle_id` (texte libre) résolu par
 *    `resoudreSalleImposeeVersLieu`. Si non résolu (salle inconnue),
 *    la séance ne contribue pas à cette Map — l'alerte à l'import
 *    couvre ce cas de son côté.
 *
 * Fonction pure. `verifier` et le solveur ne l'utilisent PAS
 * aujourd'hui (voir ticket B — contrainte salle réelle). C'est
 * strictement un helper d'affichage.
 */
export function imposesOccupantCreneau(
  inscriptions: Inscriptions,
  creneau: Creneau,
  salles: readonly Salle[],
): Map<string, { impose_id: string; morceau: string }> {
  const out = new Map<string, { impose_id: string; morceau: string }>()
  const cDebutMin = toMinutes(creneau.debut)
  const cFinExcMin = toMinutes(creneau.fin)
  for (const imp of inscriptions.imposes) {
    for (const seance of imp.seances) {
      if (seance.date !== creneau.date) continue
      const salleId = resoudreSalleImposeeVersLieu(seance.salle_id, salles)
      if (!salleId) continue
      const sDebutMin = toMinutes(seance.debut)
      const sFinIncMin = finMinutesDe(seance)
      if (sFinIncMin === null) continue
      const sFinExcMin = sFinIncMin + 1
      if (sDebutMin < cFinExcMin && sFinExcMin > cDebutMin) {
        out.set(salleId, { impose_id: imp.id, morceau: imp.morceau })
      }
    }
  }
  return out
}

/**
 * Recense les séances imposées dont la `salle_id` texte libre ne
 * correspond à aucune salle du `lieu`. Utilisé à l'import (CD 7016)
 * pour avertir l'organisateur — sans ça, le case Carte/Par salle
 * reste libre en apparence alors que le classeur portait une salle
 * réelle mal orthographiée.
 *
 * Les séances SANS `salle_id` (champ vide) sont ignorées — c'est le
 * choix produit d'origine, un imposé peut ne pas déclarer sa salle.
 */
export function warningsSalleImposeeInconnue(
  inscriptions: Inscriptions,
  salles: readonly Salle[],
): string[] {
  const out: string[] = []
  for (const imp of inscriptions.imposes) {
    for (const seance of imp.seances) {
      if (!seance.salle_id) continue
      if (resoudreSalleImposeeVersLieu(seance.salle_id, salles) !== null) continue
      out.push(
        `« ${imp.morceau} » le ${seance.date} à ${seance.debut} : salle « ${seance.salle_id} » ne correspond à aucune salle du lieu — la séance n'apparaîtra pas dans l'affichage`,
      )
    }
  }
  return out
}


/**
 * Enrichit les `Personne` des inscriptions avec des `Indispo` dérivées
 * des `imposes` : pour chaque séance de morceau imposé, les membres du
 * morceau sont marqués indisponibles sur la plage horaire.
 *
 * Retourne une copie — `inscriptions` d'origine n'est pas mutée. Utilisé
 * juste avant le solve et la vérification, pour que le placement des
 * groupes volontaires évite ces créneaux automatiquement.
 */
export function enrichirIndispos(inscriptions: Inscriptions): Inscriptions {
  if (inscriptions.imposes.length === 0) return inscriptions

  const parId = new Map<string, Personne>(
    inscriptions.personnes.map((p) => [p.id, { ...p, indispos: [...p.indispos] }]),
  )

  for (const im of inscriptions.imposes) {
    for (const pid of im.membres) {
      const p = parId.get(pid)
      if (!p) continue
      for (const s of im.seances) {
        // Cap durée (CD 6876+6885) : recopie fin ET duree_minutes.
        // Le preprocess Zod garantit qu'après parse, si `fin` était
        // présent, `duree_minutes` l'est aussi. `Indispo` en dérivée
        // porte les deux — les consommateurs consultent l'un ou l'autre
        // via `finMinutesDe`.
        const ind: Indispo = {
          jours: [s.date],
          debut: s.debut,
          fin: s.fin,
          duree_minutes: s.duree_minutes,
          roles: [],
          motif: `Imposé : ${im.morceau}`,
        }
        p.indispos.push(ind)
      }
    }
  }

  return {
    ...inscriptions,
    personnes: [...parId.values()],
  }
}
