/**
 * Wiring Sujet C — orchestre la détection d'alertes d'identité à partir
 * des extractions xlsx (`ExtractionListe` + `ExtractionStagiaires`).
 *
 * Séparation de responsabilité :
 * - `domain/identites.ts` : logique pure (types, détection, normalisation).
 * - `io/alertes-import.ts` : convertit les données brutes issues des
 *   adapters xlsx en `MembreMention[]` puis appelle le domain.
 *
 * Ordre d'appel (côté flow d'import) :
 *
 *   const stagiaires = await importerStagiairesExcel(file, onglet, mapping)
 *   const liste      = await importerListeExcel(file, onglet, mapping)
 *   const analyse    = analyserIdentitesImport({
 *                        groupes: liste.groupes,
 *                        stagiaires: stagiaires.personnes,
 *                      })
 *   // analyse.alertes_identite  → afficher dans l'écran de relecture (PR3)
 *   // analyse.personnes_relecture → liste principale de l'écran
 *
 * Le champ `alertes_identite` est **séparé** des `warnings` généraux
 * (feedback Q1 Stéphane 2026-09-01) : *« elles appellent une décision
 * humaine avant de figer les UUID, là où un avertissement se lit et se
 * classe. Les fondre dans warnings avec un type discriminé fonctionnerait
 * techniquement, mais elles se noieraient parmi les divergences de date
 * et les cellules non classées. »*
 */

import { detacherNomInstrument } from '../domain/legacy'
import type { LegacyGroupe } from '../domain/legacy'
import {
  detecterAlertesIdentite,
  personnesPourRelecture,
  type AlerteIdentite,
  type MembreMention,
  type PersonneRelecture,
} from '../domain/identites'
import type { Personne } from '../domain/model'
import { extraireDiscriminant } from './stagiaires-adapter'

/**
 * Convertit les groupes (morceaux avec membres) en mentions plates.
 *
 * Chaque membre string de `LegacyGroupe.membres` est parsé en deux
 * temps :
 * 1. `detacherNomInstrument` — sépare le pupitre (dernière paire de
 *    parenthèses qui matche un instrument reconnu).
 * 2. `extraireDiscriminant` — sépare le discriminant (paire de
 *    parenthèses restante, ex. `(L)`, `(SIG)`).
 *
 * Exemple : `"Pierre (L) (batterie)"` →
 *   { nom: 'Pierre', discriminant: '(L)', pupitre: 'batterie',
 *     groupe_titre: 'Sables Mouvants' }
 */
export function mentionsDepuisGroupes(
  groupes: readonly LegacyGroupe[],
): MembreMention[] {
  const out: MembreMention[] = []
  for (const g of groupes) {
    for (const membreStr of g.membres) {
      const { nom: nomBrut, instrument } = detacherNomInstrument(membreStr)
      const { nom, discriminant } = extraireDiscriminant(nomBrut)
      out.push({
        nom,
        discriminant,
        pupitre: instrument,
        groupe_titre: g.nom,
      })
    }
  }
  return out
}

/**
 * Convertit les stagiaires (Personne[]) en mentions plates — une par
 * instrument déclaré. Le champ `groupe_titre` est vide (`''`) pour
 * marquer une mention issue de la déclaration Stagiaires, PAS d'un
 * engagement dans un morceau.
 *
 * Les stagiaires participent aux alertes de rapprochement (cas C :
 * « Pierre Lemoine » déclaré vs « Pierre » cité seul dans un morceau)
 * mais leurs mentions vides `''` ne matchent aucun titre de morceau
 * réel — la détection doublon intra-groupe n'est donc jamais faussée.
 */
export function mentionsDepuisStagiaires(
  personnes: readonly Personne[],
): MembreMention[] {
  const out: MembreMention[] = []
  for (const p of personnes) {
    if (p.instruments.length === 0) {
      // Stagiaire sans instrument déclaré — inclus dans la relecture
      // avec pupitre vide (comptage nb_engagements possible)
      out.push({
        nom: p.nom,
        discriminant: p.discriminant,
        pupitre: '',
        groupe_titre: '',
      })
      continue
    }
    for (const ins of p.instruments) {
      out.push({
        nom: p.nom,
        discriminant: p.discriminant,
        pupitre: ins.pupitre,
        groupe_titre: '',
      })
    }
  }
  return out
}

/**
 * Résultat de l'analyse d'identité à l'import. Champ dédié `alertes_identite`
 * séparé de warnings généraux (feedback Q1 Stéphane).
 */
export interface AnalyseIdentitesImport {
  alertes_identite: AlerteIdentite[]
  personnes_relecture: PersonneRelecture[]
}

/**
 * Construit les mentions depuis un `Inscriptions` déjà bâti par
 * `construireCandidatExcel` (personne_id résolus, `Groupe.membres` avec
 * `MembreGroupe` typés). Utile pour analyser un CANDIDAT AVANT commit —
 * l'étape intermédiaire du flow d'import (PR3/PR4 Sujet C).
 *
 * Chaque personne stagiaire donne 1 mention par instrument déclaré (ou
 * 1 mention avec pupitre vide si aucun instrument) avec
 * `groupe_titre = ''`. Chaque `MembreGroupe` donne 1 mention avec
 * `groupe_titre = titre du morceau`. Le `personne_id` est résolu vers
 * la personne pour récupérer nom + discriminant.
 */
export function mentionsDepuisCandidat(inscriptions: {
  readonly personnes: readonly Personne[]
  readonly groupes: readonly { titre: string; membres: readonly { personne_id: string; pupitre: string }[] }[]
}): MembreMention[] {
  const personneParId = new Map(inscriptions.personnes.map((p) => [p.id, p]))
  const mentions: MembreMention[] = []
  // 1. Stagiaires — 1 mention par instrument déclaré (ou 1 mention
  //    pupitre='' si aucun instrument, pour couvrir le stagiaire orphelin
  //    dans la relecture)
  for (const p of inscriptions.personnes) {
    if (p.instruments.length === 0) {
      mentions.push({ nom: p.nom, discriminant: p.discriminant, pupitre: '', groupe_titre: '' })
    } else {
      for (const ins of p.instruments) {
        mentions.push({ nom: p.nom, discriminant: p.discriminant, pupitre: ins.pupitre, groupe_titre: '' })
      }
    }
  }
  // 2. Engagements dans les morceaux
  for (const g of inscriptions.groupes) {
    for (const mg of g.membres) {
      const p = personneParId.get(mg.personne_id)
      if (!p) continue
      mentions.push({
        nom: p.nom,
        discriminant: p.discriminant,
        pupitre: mg.pupitre,
        groupe_titre: g.titre,
      })
    }
  }
  return mentions
}

/**
 * Variante de `analyserIdentitesImport` qui opère sur un `Inscriptions`
 * candidat (post `construireCandidatExcel`). Utilisée par l'écran de
 * relecture wire dans le flow d'import (App.svelte).
 */
export function analyserIdentitesCandidat(inscriptions: {
  readonly personnes: readonly Personne[]
  readonly groupes: readonly { titre: string; membres: readonly { personne_id: string; pupitre: string }[] }[]
}): AnalyseIdentitesImport {
  const mentions = mentionsDepuisCandidat(inscriptions)
  return {
    alertes_identite: detecterAlertesIdentite(mentions),
    personnes_relecture: personnesPourRelecture(mentions),
  }
}

/**
 * Orchestre la détection : construit les mentions cumulées
 * (stagiaires + engagements dans les morceaux), appelle la logique
 * domain, retourne les alertes structurées et la liste pour relecture.
 */
export function analyserIdentitesImport(input: {
  groupes: readonly LegacyGroupe[]
  stagiaires: readonly Personne[]
}): AnalyseIdentitesImport {
  const mentions = [
    ...mentionsDepuisStagiaires(input.stagiaires),
    ...mentionsDepuisGroupes(input.groupes),
  ]
  return {
    alertes_identite: detecterAlertesIdentite(mentions),
    personnes_relecture: personnesPourRelecture(mentions),
  }
}
