/**
 * #204 (smoke CD) : « (5 groupes × 12 ) ». Un saut de ligne entre une
 * interpolation et un `{#if …}…{/if})` s'affiche comme une espace : quand le
 * bloc est vide, elle tombe devant la ponctuation qui le suit.
 *
 * Les phrases de surcharge et d'exclusion vivent dans App.svelte, qui ne se
 * monte pas seul en test : la garde porte sur la source.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('App.svelte : aucun {#if}…{/if} suivi de ponctuation en tête de ligne après une interpolation', () => {
  const source = readFileSync(join(__dirname, '..', 'App.svelte'), 'utf8')
  const fautifs = source.match(/\}\n[ \t]*\{#if[^\n]*\{\/if\}[).,;:]/g) ?? []
  expect(fautifs).toEqual([])
})
