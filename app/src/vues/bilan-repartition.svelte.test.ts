/**
 * Bloc de tête de l'étape 3 — #175 (gravité du compteur de problèmes) et
 * #184 (dépassement du seuil de charge par jour relayé, sans être compté).
 */
import { flushSync, mount, unmount } from 'svelte'
import { expect, it } from 'vitest'
import BilanRepartition from './BilanRepartition.svelte'

const base = {
  groupesComplets: 13,
  groupesTotal: 13,
  repetitionsPosees: 39,
  dureeMs: 120,
  essais: 1,
  problemes: 0,
  musiciensAuDelaSeuil: 0,
  seuilChargeJour: 4,
}

function rendre(props: Partial<typeof base>) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const c = mount(BilanRepartition, { target: container, props: { ...base, ...props } })
  flushSync()
  return {
    container,
    texte: () => container.textContent!.replace(/\s+/g, ' '),
    fin: () => {
      unmount(c)
      container.remove()
    },
  }
}

it('#175 : 0 problème reste neutre, sans lien ni alerte', () => {
  const r = rendre({})
  expect(r.container.querySelector('.alerte')).toBeNull()
  expect(r.container.querySelector('a[href="#controle-independant"]')).toBeNull()
  expect(r.texte()).toContain('0 problème(s) détecté(s)')
  r.fin()
})

it('#175 : un problème non nul porte l\'alerte et renvoie au Contrôle indépendant', () => {
  const r = rendre({ problemes: 1, groupesComplets: 12, groupesTotal: 12 })
  const alerte = r.container.querySelector('.alerte')!
  expect(alerte.textContent!.replace(/\s+/g, ' ')).toContain('1 problème(s) détecté(s)')
  expect(alerte.querySelector('a')!.getAttribute('href')).toBe('#controle-independant')
  // le critère « groupes complets » ne change pas (arbitrage #163)
  expect(r.texte()).toContain('12/12 groupes complets')
  r.fin()
})

it('#184 : le dépassement du seuil est relayé comme avertissement distinct, pas compté comme problème', () => {
  const r = rendre({ musiciensAuDelaSeuil: 1, seuilChargeJour: 4 })
  const avert = r.container.querySelector('.charge-jour')!
  expect(avert.textContent!.replace(/\s+/g, ' ')).toContain('⚠ 1 musicien(s) au-delà du seuil de 4 répétitions par jour')
  expect(avert.textContent).toContain("Ce n'est pas compté comme problème")
  // le compteur de problèmes reste à 0 et neutre
  expect(r.container.querySelector('.alerte')).toBeNull()
  expect(r.texte()).toContain('0 problème(s) détecté(s)')
  r.fin()
})

it('#184 : sous le seuil, aucun avertissement', () => {
  const r = rendre({ musiciensAuDelaSeuil: 0 })
  expect(r.container.querySelector('.charge-jour')).toBeNull()
  r.fin()
})
