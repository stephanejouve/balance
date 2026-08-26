<script lang="ts">
  import type { Personne } from '../domain/model'
  import { libellePersonne } from '../domain/model'

  interface Props {
    personnesAvecIndispo: Personne[]
    personnesSansIndispo: Personne[]
    nbIndispoTotal: number
    onAjouterIndispo: (pid: string) => void
    onSupprimerIndispo: (pid: string, i: number) => void
    onInvalider: () => void
  }
  let {
    personnesAvecIndispo,
    personnesSansIndispo,
    nbIndispoTotal,
    onAjouterIndispo,
    onSupprimerIndispo,
    onInvalider,
  }: Props = $props()
</script>

<details class="sheet">
  <summary>
    <p class="eyebrow">Étape 1d · Indisponibilités déclarées</p>
    <h2>{nbIndispoTotal} règle(s) d'indisponibilité</h2>
    <p class="hint">
      Créneaux où une personne ne peut pas être placée. Un rôle (chant, piano…)
      restreint la règle à ce pupitre uniquement — utile pour un chanteur qui suit
      un atelier de chant à 9h mais reste disponible pour son autre instrument.
    </p>
  </summary>
  <div class="body">
    {#each personnesAvecIndispo as p}
      <div class="impose-bloc">
        <div class="impose-titre">
          <span class="strong">{libellePersonne(p)}</span>
          <span class="mono ink-soft">{p.indispos.length} règle(s)</span>
          <button class="ghost mini-ajout" onclick={() => onAjouterIndispo(p.id)}>+ règle</button>
        </div>
        {#each p.indispos as ind, i}
          <div class="restr">
            <input
              value={ind.jours.join(', ')}
              oninput={(e) => {
                ind.jours = (e.currentTarget as HTMLInputElement).value
                  .split(/[,;\s]+/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                onInvalider()
              }}
              placeholder="jours ISO (vide = tous)"
              style="flex:1;min-width:150px"
            />
            <input type="time" bind:value={ind.debut} onchange={onInvalider} placeholder="début" />
            <span>→</span>
            <input
              type="time"
              value={ind.fin ?? ''}
              oninput={(e) => {
                const v = (e.currentTarget as HTMLInputElement).value
                ind.fin = v || undefined
                onInvalider()
              }}
              placeholder="fin (vide = match exact)"
            />
            <input
              value={ind.roles.join(', ')}
              oninput={(e) => {
                ind.roles = (e.currentTarget as HTMLInputElement).value
                  .split(/[,;\s]+/)
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean)
                onInvalider()
              }}
              placeholder="rôles (chant, piano… vide = tous)"
              style="flex:1;min-width:120px"
            />
            <input bind:value={ind.motif} onchange={onInvalider} placeholder="motif" style="flex:1;min-width:120px" />
            <button class="mini" onclick={() => onSupprimerIndispo(p.id, i)}>×</button>
          </div>
        {/each}
      </div>
    {/each}
    {#if personnesSansIndispo.length > 0}
      <details class="renforts" style="margin-top:14px">
        <summary>
          <span class="mono ink-soft">Ajouter une indispo à une personne sans règle ({personnesSansIndispo.length})</span>
        </summary>
        <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">
          {#each personnesSansIndispo as p}
            <button class="ghost mini-ajout" onclick={() => onAjouterIndispo(p.id)}>
              {libellePersonne(p)}
            </button>
          {/each}
        </div>
      </details>
    {/if}
  </div>
</details>
