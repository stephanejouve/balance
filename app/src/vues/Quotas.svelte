<script lang="ts">
  import type { Creneau } from '../domain/grille'
  import type { Inscriptions, Session } from '../domain/model'
  import { analyseQuotas } from '../engine/quotas'

  interface Props {
    session: Session
    inscriptions: Inscriptions
    creneaux: Creneau[]
  }
  let { session, inscriptions, creneaux }: Props = $props()

  const quotas = $derived(analyseQuotas(session, inscriptions, creneaux))
</script>

<p class="hint">
  État des effectifs par pupitre.
</p>
<table>
  <thead>
    <tr>
      <th>Pupitre</th>
      <th style="width:80px">Musiciens</th>
      <th style="width:90px">Groupes</th>
      <th style="width:100px">Saturation</th>
    </tr>
  </thead>
  <tbody>
    {#each quotas as q}
      {@const surcharge = q.ratio > 1}
      <tr class:surcharge>
        <td><b>{q.pupitre}</b></td>
        <td class="center mono">{q.nb_musiciens}</td>
        <td class="center mono">{q.nb_groupes_demandeurs}</td>
        <td class="center mono">
          {Math.round(q.ratio * 100)}%
          {#if surcharge}<span class="rouge"> ⚠</span>{/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
<p class="hint" style="margin-top:12px">
  Chaque pupitre a sa propre saturation — argument-clé au moment des inscriptions.
</p>

<style>
  /* Styles partagés hérités de App.svelte via :global — voir REFACTOR.md */
  :global(.rouge) { color: var(--rouge); font-style: italic; }
  :global(tr.surcharge td) { background: #f8e6e3; }
</style>
