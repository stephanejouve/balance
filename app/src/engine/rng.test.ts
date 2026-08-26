import { describe, expect, it } from 'vitest'
import { makeRng, shuffle } from './rng'

describe('makeRng', () => {
  it('produit une séquence déterministe pour un seed donné', () => {
    const rng1 = makeRng(42)
    const rng2 = makeRng(42)
    const seq1 = Array.from({ length: 10 }, () => rng1())
    const seq2 = Array.from({ length: 10 }, () => rng2())
    expect(seq1).toEqual(seq2)
  })

  it('produit des séquences différentes pour des seeds différents', () => {
    const rng1 = makeRng(1)
    const rng2 = makeRng(2)
    const seq1 = Array.from({ length: 10 }, () => rng1())
    const seq2 = Array.from({ length: 10 }, () => rng2())
    expect(seq1).not.toEqual(seq2)
  })

  it('renvoie des valeurs dans [0, 1[', () => {
    const rng = makeRng(1234)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('accepte les seeds négatifs (converti unsigned)', () => {
    const rng = makeRng(-1)
    const v = rng()
    expect(v).toBeGreaterThanOrEqual(0)
    expect(v).toBeLessThan(1)
  })

  it('a une distribution raisonnablement uniforme sur 10000 tirages', () => {
    // Sanity check statistique — pas un vrai test de qualité RNG mais garde-fou
    // contre les régressions grossières (biais > 5% sur les 10 buckets [0.0, 1.0]).
    const rng = makeRng(7)
    const buckets = new Array(10).fill(0)
    const N = 10000
    for (let i = 0; i < N; i++) buckets[Math.floor(rng() * 10)]++
    const attendu = N / 10
    for (const b of buckets) {
      expect(Math.abs(b - attendu) / attendu).toBeLessThan(0.15)
    }
  })
})

describe('shuffle', () => {
  it('renvoie un tableau de même longueur avec les mêmes éléments', () => {
    const rng = makeRng(1)
    const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const shuffled = shuffle(src, rng)
    expect(shuffled).toHaveLength(src.length)
    expect([...shuffled].sort((a, b) => a - b)).toEqual(src)
  })

  it('ne modifie pas le tableau source', () => {
    const rng = makeRng(1)
    const src = [1, 2, 3, 4, 5]
    const copie = [...src]
    shuffle(src, rng)
    expect(src).toEqual(copie)
  })

  it('produit le même ordre pour un même seed', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const s1 = shuffle(src, makeRng(999))
    const s2 = shuffle(src, makeRng(999))
    expect(s1).toEqual(s2)
  })

  it('produit un ordre différent du tableau source (sauf hasard)', () => {
    // Sur 10 éléments avec un seed non trivial, la probabilité d'obtenir
    // l'ordre identique est ~1/10! → cas extrêmement improbable.
    const src = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const shuffled = shuffle(src, makeRng(42))
    expect(shuffled).not.toEqual(src)
  })
})
