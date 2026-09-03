<script lang="ts">
  import type { Inscriptions, Personne, Session } from '../domain/model'
  import { libellePersonne } from '../domain/model'

  interface Props {
    inscriptions: Inscriptions
    session: Session
    personnesParId: Map<string, Personne>
    onAjouterGroupe: () => void
    onSupprimerGroupe: (i: number) => void
    onRetirerMembre: (groupe_id: string, membreIdx: number) => void
    onInvalider: () => void
  }
  // `inscriptions` est mutée à travers ses items (groupe.titre, groupe.style,
  // groupe.tonalite, groupe.responsable_id, groupe.repetitions_deja_faites).
  // `$bindable()` exigé en Svelte 5. `session` reste read-only (utilisée
  // uniquement en attribut `max`).
  let {
    inscriptions = $bindable(),
    session,
    personnesParId,
    onAjouterGroupe,
    onSupprimerGroupe,
    onRetirerMembre,
    onInvalider,
  }: Props = $props()
</script>

<details class="sheet">
  <summary>
    <p class="eyebrow">Étape 1b · Inscriptions</p>
    <h2>{inscriptions.groupes.length} groupes, {inscriptions.personnes.length} musiciens</h2>
    <p class="hint">
      Édition inline titre / responsable / style / tonalité. Les membres se saisissent
      via le classeur Excel importé — édition détaillée pupitre par pupitre à venir.
    </p>
  </summary>
  <div class="body">
    <table>
      <thead>
        <tr>
          <th style="width:30px">N°</th>
          <th style="width:200px">Titre</th>
          <th style="width:110px">Resp.</th>
          <th style="width:90px">Style</th>
          <th style="width:55px">Tona</th>
          <th>Membres</th>
          <th style="width:65px" title="Répétitions déjà effectuées">Déjà fait</th>
          <th style="width:40px"></th>
        </tr>
      </thead>
      <tbody>
        {#each inscriptions.groupes as g, i}
          <tr>
            <td class="mono">{i + 1}</td>
            <td><input bind:value={g.titre} onchange={onInvalider} /></td>
            <td><input bind:value={g.responsable_id} onchange={onInvalider} /></td>
            <td><input bind:value={g.style} onchange={onInvalider} /></td>
            <td><input bind:value={g.tonalite} onchange={onInvalider} /></td>
            <td>
              <details class="membres-drop">
                <summary>
                  <span class="mono">{g.membres.length}</span>
                  membre{g.membres.length > 1 ? 's' : ''}
                  {#if g.membres.length > 0}
                    <span class="ink-soft">·</span>
                    <span class="ink-soft">{g.membres.map((m) => m.pupitre).join(', ')}</span>
                  {/if}
                  {#if g.postes_cherches.length > 0}
                    <span class="badge">cherche {g.postes_cherches.join(', ')}</span>
                  {/if}
                </summary>
                <div class="membres-list">
                  {#each g.membres as m, mi}
                    {@const p = personnesParId.get(m.personne_id)}
                    <span class="chip">
                      {p ? libellePersonne(p) : m.personne_id}
                      <em>{m.pupitre}{m.precision ? ` · ${m.precision}` : ''}</em>
                      <button class="mini" onclick={() => onRetirerMembre(g.id, mi)} title="Retirer ce membre du groupe">×</button>
                    </span>
                  {/each}
                  {#if g.postes_cherches.length > 0}
                    {#each g.postes_cherches as pup}
                      <span class="badge">cherche {pup}</span>
                    {/each}
                  {/if}
                </div>
              </details>
            </td>
            <td class="center">
              <input type="number" min="0" max={session.repetitions_visees} bind:value={g.repetitions_deja_faites} onchange={onInvalider} style="width:60px" />
            </td>
            <td class="center"><button class="mini" onclick={() => onSupprimerGroupe(i)}>×</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <button class="ghost" onclick={onAjouterGroupe}>+ Ajouter un groupe</button>
  </div>
</details>

<style>
  .membres-drop {
    margin: 0;
  }
  .membres-drop > summary {
    list-style: none;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 6px;
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 13px;
  }
  .membres-drop > summary::-webkit-details-marker {
    display: none;
  }
  .membres-drop > summary::before {
    content: '▸';
    display: inline-block;
    width: 12px;
    color: var(--ink-soft, #888);
    transition: transform 0.15s;
  }
  .membres-drop[open] > summary::before {
    transform: rotate(90deg);
  }
  .membres-drop > summary:hover {
    background: rgba(0, 0, 0, 0.04);
  }
  .membres-list {
    padding: 8px 0 4px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
</style>
