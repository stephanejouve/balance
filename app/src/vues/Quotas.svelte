<script lang="ts">
  import type { Creneau } from '../domain/grille'
  import type { Inscriptions, Session } from '../domain/model'
  import { analyseQuotas } from '../engine/quotas'

  interface Props {
    session: Session
    inscriptions: Inscriptions
    creneaux: Creneau[]
    deltas: Record<string, number>
    onDelta: (pupitre: string, valeur: number) => void
  }
  let { session, inscriptions, creneaux, deltas, onDelta }: Props = $props()

  const quotas = $derived(analyseQuotas(session, inscriptions, creneaux))
</script>

<p class="hint">
  Simulation par pupitre : combien de groupes seraient réalisables si le nombre
  de musiciens variait ? Curseur négatif = retirer, positif = ajouter —
  l'estimation se met à jour en direct.
</p>
<table>
  <thead>
    <tr>
      <th>Pupitre</th>
      <th style="width:80px">Musiciens</th>
      <th style="width:90px">Groupes</th>
      <th style="width:100px">Saturation</th>
      <th style="width:280px">Simuler ± musiciens</th>
      <th style="width:110px">Groupes serviables</th>
    </tr>
  </thead>
  <tbody>
    {#each quotas as q}
      {@const delta = deltas[q.pupitre] ?? 0}
      {@const serviables = q.simuler_delta(delta)}
      {@const surcharge = q.ratio > 1}
      <tr class:surcharge>
        <td><b>{q.pupitre}</b></td>
        <td class="center mono">{q.nb_musiciens}</td>
        <td class="center mono">{q.nb_groupes_demandeurs}</td>
        <td class="center mono">
          {Math.round(q.ratio * 100)}%
          {#if surcharge}<span class="rouge"> ⚠</span>{/if}
        </td>
        <td>
          <input
            type="range"
            min={-q.nb_musiciens}
            max="10"
            step="1"
            value={delta}
            oninput={(e) => onDelta(q.pupitre, Number((e.currentTarget as HTMLInputElement).value))}
          />
          <span class="mono ink-soft">
            {delta >= 0 ? '+' : ''}{delta} → {q.nb_musiciens + delta} musicien(s)
          </span>
        </td>
        <td class="center mono">
          <b>{Math.min(serviables, q.nb_groupes_demandeurs)}</b>
          {#if serviables < q.nb_groupes_demandeurs}
            <span class="rouge"> / {q.nb_groupes_demandeurs}</span>
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
<p class="hint" style="margin-top:12px">
  Le nombre de groupes serviables est plafonné par le pupitre le plus tendu.
  Bougez les curseurs pour trouver combien il faudrait de musiciens en plus (ou en
  moins) pour que tous les groupes tiennent — argument-clé au moment des inscriptions.
</p>

<style>
  /* Styles partagés hérités de App.svelte via :global — voir REFACTOR.md */
  :global(.rouge) { color: var(--rouge); font-style: italic; }
  :global(tr.surcharge td) { background: #f8e6e3; }
</style>
