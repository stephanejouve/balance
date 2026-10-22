/**
 * Lot 2b #164 — le geste de création sur l'écran de relecture : liste
 * visible avant le geste, création bloquée tant qu'un nom proche n'est pas
 * tranché (et le bouton dit pourquoi), décisions transmises au clic.
 */
import { flushSync, mount, unmount } from 'svelte'
import { expect, it } from 'vitest'
import { Personne } from '../domain/model'
import type { CreationPersonnes, DecisionRapprochement } from '../io/personnes-citees'
import CreationPersonnesCitees from './CreationPersonnesCitees.svelte'

const p = (id: string, nom: string, pupitre: string) => Personne.parse({ id, nom, instruments: [{ pupitre }] })

function rendre(creation: CreationPersonnes) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const recu: ReadonlyMap<string, DecisionRapprochement>[] = []
  const c = mount(CreationPersonnesCitees, { target: container, props: { creation, onCreer: (d) => recu.push(new Map(d)) } })
  flushSync()
  const bouton = () => container.querySelector<HTMLButtonElement>('.bouton-creer')!
  const cliquer = (texte: string) => {
    const b = [...container.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent!.trim().startsWith(texte))!
    b.click()
    flushSync()
  }
  return { container, c, recu, bouton, cliquer }
}

it('sans nom proche : la liste est visible et le bouton crée tout', () => {
  const { container, c, recu, bouton } = rendre({ a_creer: [p('sophie', 'Sophie', 'chant'), p('yann', 'Yann', 'basse')], rapprochements: [] })
  expect(container.textContent).toContain('Sophie')
  expect(container.textContent).toContain('Yann')
  expect(bouton().disabled).toBe(false)
  expect(bouton().textContent).toContain('Créer 2 personnes')
  bouton().click()
  expect(recu).toHaveLength(1)
  unmount(c)
})

it('nom proche : bouton désactivé AVEC sa raison, puis « même personne » le libère et retire une création', () => {
  const a = p('helene-barrault', 'Hélène Barrault', 'chant')
  const b = p('helene-barault', 'Hélène Barault', 'piano')
  const { container, c, recu, bouton, cliquer } = rendre({ a_creer: [a, b], rapprochements: [{ cite: a, proche: b, proche_declaree: false }] })
  expect(bouton().disabled).toBe(true)
  expect(container.querySelector('[role="note"]')!.textContent).toContain('1 rapprochement à trancher avant de créer')
  cliquer('Même personne, garder « Hélène Barrault »')
  expect(bouton().disabled).toBe(false)
  expect(bouton().textContent).toContain('Créer 1 personne et rattacher 1 orthographe')
  bouton().click()
  expect([...recu[0].values()]).toEqual([{ garder: 'helene-barrault' }])
  unmount(c)
})

it('« deux personnes » : les deux restent à créer', () => {
  const a = p('tom-vidal', 'Tom Vidal', 'chant')
  const b = p('tim-vidal', 'Tim Vidal', 'chant')
  const { c, bouton, cliquer } = rendre({ a_creer: [a, b], rapprochements: [{ cite: a, proche: b, proche_declaree: false }] })
  cliquer('Deux personnes')
  expect(bouton().textContent).toContain('Créer 2 personnes')
  unmount(c)
})

it('triangle de noms proches, trois noms gardés différents : l\'écran annonce UNE création (review Leader #185)', () => {
  const a = p('martin', 'Martin', 'chant')
  const b = p('martine', 'Martine', 'piano')
  const m = p('martins', 'Martins', 'basse')
  const { container, c, bouton } = rendre({
    a_creer: [a, b, m],
    rapprochements: [
      { cite: a, proche: b, proche_declaree: false },
      { cite: a, proche: m, proche_declaree: false },
      { cite: b, proche: m, proche_declaree: false },
    ],
  })
  const choisir = (ligne: number, texte: string) => {
    const li = container.querySelectorAll('.rapprochements li')[ligne]
    ;[...li.querySelectorAll<HTMLButtonElement>('button')].find((x) => x.textContent!.trim() === texte)!.click()
    flushSync()
  }
  choisir(0, 'Même personne, garder « Martin »')
  choisir(1, 'Même personne, garder « Martins »')
  choisir(2, 'Même personne, garder « Martine »')
  expect(bouton().textContent).toContain('Créer 1 personne et rattacher 2 orthographes')
  expect(container.querySelectorAll('.noms li.fusionne')).toHaveLength(2)
  unmount(c)
})
