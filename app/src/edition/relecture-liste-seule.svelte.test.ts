/**
 * #164 : sans onglet Stagiaires, l'écran de relecture ne propose plus les
 * trois causes « faute de frappe, oubli, variante » — toutes fausses —
 * mais dit que les noms cités ne sont pas créés et comment les créer.
 */
import { flushSync, mount, unmount } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Personne } from '../domain/model'
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
  // Review Leader #169 : la saisie en 1A ne rattache pas au nom cité.
  expect(t).not.toContain('1A')
  // #176 : le remède nomme le bouton qui permet de réimporter
  expect(t).toContain("onglet Stagiaires qui le déclare, puis « Importer un autre fichier » à l'étape 1 pour le réimporter")
  // #193 : le signalement porte sur un nom, il en parle au singulier
  expect(t).toContain("ce nom cité dans la Liste n'est pas créé comme personne. Il restera un simple nom")
  expect(t).not.toContain('Ils resteront')
  // Lot 2b : le geste de création est nommé dans le remède
  expect(t).toContain('Personnes citées sans déclaration')
})

it('avec des stagiaires déclarés : libellé général inchangé', () => {
  const t = rendre(false)
  expect(t).toContain('Faute de frappe')
  expect(t).not.toContain("pas d'onglet Stagiaires")
})

describe('#186 point 3 : valider sans avoir créé se confirme', () => {
  const analyse: AnalyseIdentitesImport = { alertes_identite: [], alertes_coherence: [], personnes_relecture: [] }
  const creation = { a_creer: [Personne.parse({ id: 'yann', nom: 'Yann Le Goff', instruments: [{ pupitre: 'basse' }] })], rapprochements: [] }
  function monter(props: Record<string, unknown>) {
    const container = document.createElement('div')
    document.body.appendChild(container)
    let valide = 0
    const c = mount(EcranRelectureIdentites, { target: container, props: { analyse, onValider: () => valide++, onAnnuler: () => {}, ...props } })
    flushSync()
    container.querySelector<HTMLButtonElement>('.bouton-valider')!.click()
    unmount(c)
    container.remove()
    return valide
  }
  afterEach(() => vi.restoreAllMocks())

  it('des noms restent à créer : confirmation qui nomme la conséquence ; refus = on reste', () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    expect(monter({ creation, onCreerPersonnes: () => {} })).toBe(0)
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toContain('Vous n\'avez rien créé : le nom cité restera un simple nom, sans instruments')
    expect(spy.mock.calls[0][0]).toContain('Valider sans le créer ?')
  })

  it('plusieurs noms : le compte est celui des noms cités, annoncé comme tel', () => {
    const spy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const deux = { ...creation, a_creer: [...creation.a_creer, Personne.parse({ id: 'rose', nom: 'Rose', instruments: [{ pupitre: 'chant' }] })] }
    monter({ creation: deux, onCreerPersonnes: () => {} })
    expect(spy.mock.calls[0][0]).toContain('Vous n\'avez rien créé : les 2 noms cités resteront de simples noms')
    expect(spy.mock.calls[0][0]).toContain('Valider sans les créer ?')
  })

  it('accepter la confirmation valide', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    expect(monter({ creation, onCreerPersonnes: () => {} })).toBe(1)
  })

  it('rien à créer (ou déjà créé) : pas de confirmation', () => {
    const spy = vi.spyOn(window, 'confirm')
    expect(monter({ creation: { a_creer: [], rapprochements: [] }, onCreerPersonnes: () => {} })).toBe(1)
    expect(monter({})).toBe(1)
    expect(spy).not.toHaveBeenCalled()
  })
})
