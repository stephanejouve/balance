<script lang="ts">
  import type { Personne } from '../domain/model'
  import { libellePersonne } from '../domain/model'
  import { raisonIndispoIgnoree } from '../engine/indispo'
  import InputDuree from './InputDuree.svelte'

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

  /**
   * Toute écriture dans l'éditeur pose le marqueur de saisie (#151) : ce que
   * l'organisateur voit dans les champs est ce qui s'applique. La simple
   * ouverture de la feuille ne marque RIEN — sinon une indispo importée
   * « arrive mardi midi » deviendrait structurée juste parce qu'on l'a vue.
   */
  function modifie(ind: Personne['indispos'][number]) {
    ind.saisie_editeur = true
    onInvalider()
  }
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
                modifie(ind)
              }}
              placeholder="mardi, 2026-08-25"
              title="Vide = l'indisponibilité s'applique à toute la session."
              style="flex:1;min-width:150px"
            />
            <input type="time" bind:value={ind.debut} onchange={() => modifie(ind)} placeholder="début" />
            <span>+</span>
            <InputDuree
              debut={ind.debut}
              bind:duree_minutes={ind.duree_minutes}
              bind:fin={ind.fin}
              onchange={() => modifie(ind)}
              placeholder="durée — 2h, 90, 1h30 (vide = créneau démarrant pile à l'heure)"
            />
            <input
              value={ind.roles.join(', ')}
              oninput={(e) => {
                ind.roles = (e.currentTarget as HTMLInputElement).value
                  .split(/[,;\s]+/)
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean)
                modifie(ind)
              }}
              placeholder="rôles (chant, piano… vide = tous)"
              style="flex:1;min-width:120px"
            />
            <input bind:value={ind.motif} onchange={() => modifie(ind)} placeholder="motif" style="flex:1;min-width:120px" />
            <button class="mini" onclick={() => onSupprimerIndispo(p.id, i)}>×</button>
          </div>
          {@const raison = raisonIndispoIgnoree(ind)}
          {#if raison}
            <!-- #151 : une règle ignorée par le solveur le dit, là où on l'édite. -->
            <p class="indispo-ignoree" role="note">Ignorée dans le calcul. {raison}</p>
          {/if}
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

<style>
  .indispo-ignoree {
    margin: 2px 0 8px;
    padding: 4px 8px;
    border-left: 3px solid var(--rouge);
    color: var(--rouge);
    font-size: 0.85em;
  }
</style>
