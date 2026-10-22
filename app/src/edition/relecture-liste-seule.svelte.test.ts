/**
 * #164 : sans onglet Stagiaires, l'écran de relecture ne propose plus les
 * trois causes « faute de frappe, oubli, variante » — toutes fausses —
 * mais dit que les noms cités ne sont pas créés et comment les créer.
 */
import { flushSync, mount, unmount } from 'svelte'
import { expect, it } from 'vitest'
import type { AnalyseIdentitesImport } from '../io/alertes-import'
import EcranRelectureIdentites from './EcranRelectureIdentites.svelte'

function rendre(aucun: boolean) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const analyse: AnalyseIdentitesImport = {
    alertes_identite: [],
    alertes_coherence: [
      { type: 'nom_cite_absent_stagiaires', personne: 'yann-le-goff', morceau: 'Blue Bossa', pupitre: 'basse', ...(aucun ? { aucun_stagiaire_declare: true as const } : {}) },
    ],
    personnes_relecture: [],
  }
  const c = mount(EcranRelectureIdentites, { target: container, props: { analyse, onValider: () => {}, onAnnuler: () => {} } })
  flushSync()
  for (const b of container.querySelectorAll('button[aria-expanded="false"]')) (b as HTMLElement).click()
  flushSync()
  const texte = container.textContent ?? ''
  unmount(c)
  container.remove()
  return texte
}

it('sans onglet Stagiaires : libellé dédié, pas les trois causes générales', () => {
  const t = rendre(true)
  expect(t).toContain("Le fichier n'a pas d'onglet Stagiaires")
  expect(t).not.toContain('Faute de frappe')
})

it('avec des stagiaires déclarés : libellé général inchangé', () => {
  const t = rendre(false)
  expect(t).toContain('Faute de frappe')
  expect(t).not.toContain("pas d'onglet Stagiaires")
})
