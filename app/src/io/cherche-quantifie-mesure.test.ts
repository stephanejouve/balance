/**
 * Mesure de non-régression CHERCHE quantifié — verrouille l'écart 8 → 13
 * sur la fixture `stress-cherche-roles_20260902_113427.xlsx` (SHA256
 * 2d4e63d40791876ad9e30be25268277607f66c3fe1dd796e5bcdccd07b849fb7).
 *
 * ⚠️ Ce test a servi à MESURER l'écart AVANT le fix (« 8 mesuré alors
 * qu'on attendait 13 »). Le laisser en place APRÈS le fix garantit que
 * ce qu'on a acquis ne reviendra pas — voir feedback Stéphane
 * 2026-09-04 : « un test qui a servi à mesurer un écart est le meilleur
 * candidat pour empêcher qu'il revienne. »
 *
 * Sans ce test : un contributeur pourrait plus tard « simplifier »
 * `PosteCherche.nb` en le retirant du type, ou refactoriser le parseur
 * en oubliant les patterns `CHERCHE N` / `CHERCHE N chœurs`. Le
 * compteur retomberait à 8 sans que rien ne bloque le merge — c'est
 * exactement la classe de défaut qu'on traque depuis 3 jours (info
 * silencieusement perdue).
 *
 * Attendu (corrigé Stéphane 20260904_081300, SHA256
 * dc1f4fa4b3d852712e6cbe500eed68c94f36f701048993ff66d425f520a0d4ca) :
 * 8 cases CHERCHE, 13 postes réels, décomposés en :
 * - Caravan : 3 vents
 * - Sunny : 2 vents
 * - Superstition : 2 guitares
 * - Get Lucky : 1 lead chant
 * - Lady Marmalade : 2 chœurs chant
 * - Manhã de Carnaval : 1 chant (rôle indéterminé)
 * - Hotel California : 1 vents
 * - Zombie : 1 basse
 *
 * Skip conditionnel si la fixture n'est pas au chemin partagé (pattern
 * `import-detection.integration.test.ts`).
 */
import { existsSync, readFileSync } from 'node:fs'
import readXlsxFile from 'read-excel-file/node'
import { describe, expect, it } from 'vitest'
import { migrerInscriptions } from '../domain/migrate'
import { extraireListe, MAPPING_LISTE_DEFAUT } from './liste-adapter'

const FIXTURE_PATH = '/Users/Shared/balance-transit/stress-cherche-roles_20260902_113427.xlsx'
const skipIfMissing = existsSync(FIXTURE_PATH) ? it : it.skip

describe('CHERCHE quantifié — non-régression 8 cases / 13 postes réels', () => {
  skipIfMissing('compte 13 postes sur 8 cases avec quantification et rôle', async () => {
    const buffer = readFileSync(FIXTURE_PATH)
    const allSheets = (await readXlsxFile(buffer, { getSheets: false } as never)) as unknown as Array<{ sheet: string; data: unknown[][] }>
    const listeSheet = allSheets.find((s) => s.sheet === 'Liste')
    expect(listeSheet).toBeDefined()

    const legacy = extraireListe(listeSheet!.data as never, MAPPING_LISTE_DEFAUT)
    const inscMigre = migrerInscriptions(
      { groupes: legacy.groupes, membresImposes: {}, indispos: [], identitesConnues: [] },
      's',
    )

    // Somme des nb sur tous les groupes = 13 postes réels
    const sommePostes = inscMigre.groupes.reduce(
      (acc, g) => acc + g.postes_cherches.reduce((s, pc) => s + pc.nb, 0),
      0,
    )
    expect(sommePostes).toBe(13)

    // 8 groupes ont au moins un poste cherché (nb de cases CHERCHE)
    const nbGroupesAvecCherche = inscMigre.groupes.filter((g) => g.postes_cherches.length > 0).length
    expect(nbGroupesAvecCherche).toBe(8)

    // Vérification poste par poste (attendus verbatim du corrigé)
    const parTitre = new Map(inscMigre.groupes.map((g) => [g.titre.split(' /')[0], g.postes_cherches]))

    expect(parTitre.get('Caravan')).toEqual([{ pupitre: 'vents', nb: 3 }])
    expect(parTitre.get('Sunny')).toEqual([{ pupitre: 'vents', nb: 2 }])
    expect(parTitre.get('Superstition')).toEqual([{ pupitre: 'guitare', nb: 2 }])
    expect(parTitre.get('Get Lucky')).toEqual([{ pupitre: 'chant', nb: 1, role: 'lead' }])
    expect(parTitre.get('Lady Marmalade')).toEqual([{ pupitre: 'chant', nb: 2, role: 'choeurs' }])
    expect(parTitre.get('Manhã de Carnaval')).toEqual([{ pupitre: 'chant', nb: 1 }])
    expect(parTitre.get('Hotel California')).toEqual([{ pupitre: 'vents', nb: 1 }])
    expect(parTitre.get('Zombie')).toEqual([{ pupitre: 'basse', nb: 1 }])
  })

  skipIfMissing('extrait le rôle vocal depuis la double parenthèse des membres', async () => {
    const buffer = readFileSync(FIXTURE_PATH)
    const allSheets = (await readXlsxFile(buffer, { getSheets: false } as never)) as unknown as Array<{ sheet: string; data: unknown[][] }>
    const listeSheet = allSheets.find((s) => s.sheet === 'Liste')!
    const legacy = extraireListe(listeSheet.data as never, MAPPING_LISTE_DEFAUT)
    const inscMigre = migrerInscriptions(
      { groupes: legacy.groupes, membresImposes: {}, indispos: [], identitesConnues: [] },
      's',
    )

    // Caravan : Brigitte (A) (lead), Vincent (A) (chœurs), Damien (A) (chœurs) sur chant
    const caravan = inscMigre.groupes.find((g) => g.titre.startsWith('Caravan'))!
    const membresChant = caravan.membres.filter((m) => m.pupitre === 'chant')
    const brigitte = membresChant.find((m) => m.personne_id === 'brigitte-a')
    const vincent = membresChant.find((m) => m.personne_id === 'vincent-a')
    const damien = membresChant.find((m) => m.personne_id === 'damien-a')
    expect(brigitte?.role).toBe('lead')
    expect(vincent?.role).toBe('choeurs')
    expect(damien?.role).toBe('choeurs')
  })

  skipIfMissing('membre sans double parenthèse rôle → role absent (fausse précision évitée)', async () => {
    // La fixture n'a aucun chanteur sans rôle explicite (tous les
    // chanteurs identifiés ont soit `(lead)`, soit `(chœurs)`). On vérifie
    // à la place que les membres NON-chant (piano, guitare, etc.) n'ont
    // JAMAIS de role, quel que soit le pupitre. Feedback Stéphane :
    // « rendre la précision obligatoire produirait une fausse précision ».
    const buffer = readFileSync(FIXTURE_PATH)
    const allSheets = (await readXlsxFile(buffer, { getSheets: false } as never)) as unknown as Array<{ sheet: string; data: unknown[][] }>
    const listeSheet = allSheets.find((s) => s.sheet === 'Liste')!
    const legacy = extraireListe(listeSheet.data as never, MAPPING_LISTE_DEFAUT)
    const inscMigre = migrerInscriptions(
      { groupes: legacy.groupes, membresImposes: {}, indispos: [], identitesConnues: [] },
      's',
    )

    for (const g of inscMigre.groupes) {
      for (const m of g.membres) {
        if (m.pupitre !== 'chant') {
          expect(m.role, `Membre ${m.personne_id} en ${m.pupitre} ne devrait pas avoir de role vocal`).toBeUndefined()
        }
      }
    }
  })
})
