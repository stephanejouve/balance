import type { Indispo, Inscriptions, Personne } from '../domain/model'

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
        const ind: Indispo = {
          jours: [s.date],
          debut: s.debut,
          fin: s.fin,
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
