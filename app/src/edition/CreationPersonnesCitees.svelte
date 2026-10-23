<script lang="ts">
  /**
   * Geste « créer les personnes citées » de l'écran de relecture — lot 2b
   * #164, arbitrage CD 2026-10-22 : la création est une DÉCISION, jamais
   * d'office. La liste des noms est visible avant le geste, et les noms
   * proches sont tranchés avant création (sinon une faute de frappe crée
   * en silence une personne de trop).
   *
   * Présentation seule : la logique vit dans `io/personnes-citees.ts`.
   */
  import { SvelteMap } from 'svelte/reactivity'
  import { libellePersonne } from '../domain/model'
  import {
    cleRapprochement,
    fusionsRetenues,
    rapprochementsATrancher,
    type CreationPersonnes,
    type DecisionRapprochement,
  } from '../io/personnes-citees'

  interface Props {
    creation: CreationPersonnes
    onCreer: (decisions: ReadonlyMap<string, DecisionRapprochement>) => void
  }
  let { creation, onCreer }: Props = $props()

  const decisions = new SvelteMap<string, DecisionRapprochement>()
  const restants = $derived(rapprochementsATrancher(creation, decisions))
  /** Ids qui ne seront pas créés : fusionnés vers une autre orthographe ou une personne déclarée. */
  const fusionnes = $derived(new Set(fusionsRetenues(creation, decisions).keys()))
  const nbCreees = $derived(creation.a_creer.filter((p) => !fusionnes.has(p.id)).length)

  function decider(cle: string, d: DecisionRapprochement) {
    decisions.set(cle, d)
  }
  const choisi = (cle: string, d: DecisionRapprochement): boolean => {
    const actuel = decisions.get(cle)
    if (!actuel) return false
    if (actuel === 'distinctes' || d === 'distinctes') return actuel === d
    return actuel.garder === d.garder
  }
  // #186 : le pupitre, comme l'annonce l'intro, précision en complément (même forme que 1B).
  const pupitres = (p: CreationPersonnes['a_creer'][number]) =>
    p.instruments.map((i) => (i.precision ? `${i.pupitre} · ${i.precision}` : i.pupitre)).join(', ')
</script>

<section class="creation-citees" aria-labelledby="titre-creation-citees">
  <!-- #186 : le compteur suit les rapprochements tranchés, comme le bouton. -->
  <h3 id="titre-creation-citees">
    Personnes citées sans déclaration ({nbCreees} à créer{#if fusionnes.size > 0}{`, ${fusionnes.size} rattachée${fusionnes.size > 1 ? 's' : ''}`}{/if})
  </h3>
  <p class="hint">
    {#if creation.a_creer.length > 1}
      Ces noms sont cités dans la Liste mais ne correspondent à aucune personne déclarée. Les créer les
      rend utilisables : instruments, indisponibilités, planning individuel. Le pupitre vient de la
      colonne où le nom apparaît.
    {:else}
      Ce nom est cité dans la Liste mais ne correspond à aucune personne déclarée. Le créer le rend
      utilisable : instruments, indisponibilités, planning individuel. Le pupitre vient de la colonne
      où le nom apparaît.
    {/if}
  </p>

  {#if creation.rapprochements.length > 0}
    <h4>Noms proches — à trancher avant de créer</h4>
    <ul class="rapprochements">
      {#each creation.rapprochements as r (cleRapprochement(r))}
        {@const cle = cleRapprochement(r)}
        <li>
          <span>« {libellePersonne(r.cite)} » et « {libellePersonne(r.proche)} »{#if r.proche_declaree} <span class="ink-soft">(déclarée)</span>{/if}</span>
          <span class="choix">
            {#if r.proche_declaree}
              <button type="button" aria-pressed={choisi(cle, { garder: r.proche.id })} onclick={() => decider(cle, { garder: r.proche.id })}>
                Même personne que « {libellePersonne(r.proche)} »
              </button>
            {:else}
              <button type="button" aria-pressed={choisi(cle, { garder: r.cite.id })} onclick={() => decider(cle, { garder: r.cite.id })}>
                Même personne, garder « {libellePersonne(r.cite)} »
              </button>
              <button type="button" aria-pressed={choisi(cle, { garder: r.proche.id })} onclick={() => decider(cle, { garder: r.proche.id })}>
                Même personne, garder « {libellePersonne(r.proche)} »
              </button>
            {/if}
            <button type="button" aria-pressed={choisi(cle, 'distinctes')} onclick={() => decider(cle, 'distinctes')}>
              Deux personnes
            </button>
          </span>
        </li>
      {/each}
    </ul>
  {/if}

  <ul class="noms">
    {#each creation.a_creer as p (p.id)}
      <li class:fusionne={fusionnes.has(p.id)}>
        {libellePersonne(p)} <span class="ink-soft">— {pupitres(p) || 'sans pupitre'}</span>
      </li>
    {/each}
  </ul>

  <button type="button" class="bouton-creer" disabled={restants.length > 0 || nbCreees + fusionnes.size === 0} onclick={() => onCreer(decisions)}>
    Créer {nbCreees} personne{nbCreees > 1 ? 's' : ''}{#if fusionnes.size > 0}{` et rattacher ${fusionnes.size} orthographe${fusionnes.size > 1 ? 's' : ''}`}{/if}
  </button>
  {#if restants.length > 0}
    <!-- État désactivé porte sa raison -->
    <p class="raison" role="note">
      {restants.length} rapprochement{restants.length > 1 ? 's' : ''} à trancher avant de créer.
    </p>
  {/if}
</section>

<style>
  .creation-citees {
    border-left: 3px solid var(--ochre);
    padding: 0.5rem 1rem;
  }
  .rapprochements li,
  .noms li {
    margin: 4px 0;
  }
  .choix {
    display: inline-flex;
    gap: 6px;
    margin-left: 8px;
    flex-wrap: wrap;
  }
  .choix button[aria-pressed='true'] {
    background: var(--ochre);
  }
  .fusionne {
    text-decoration: line-through;
    opacity: 0.6;
  }
  .raison {
    font-size: 0.85em;
    color: var(--ink-soft);
  }
</style>
