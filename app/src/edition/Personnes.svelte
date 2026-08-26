<script lang="ts">
  import type { Inscriptions, Lieu } from '../domain/model'
  import { libellePersonne } from '../domain/model'

  interface Props {
    inscriptions: Inscriptions
    lieu: Lieu
    nbPersonnesLibres: number
    onAjouterPersonne: () => void
    onSupprimerPersonne: (pid: string) => void
    onAjouterInstrument: (pid: string) => void
    onSupprimerInstrument: (pid: string, i: number) => void
    onInvalider: () => void
  }
  let {
    inscriptions,
    lieu,
    nbPersonnesLibres,
    onAjouterPersonne,
    onSupprimerPersonne,
    onAjouterInstrument,
    onSupprimerInstrument,
    onInvalider,
  }: Props = $props()
</script>

<details class="sheet">
  <summary>
    <p class="eyebrow">Étape 1a · Personnes</p>
    <h2>{inscriptions.personnes.length} personne(s) — dont {nbPersonnesLibres} sans engagement</h2>
    <p class="hint">
      Musiciens et chanteurs du stage. Un stagiaire sans groupe reste utilisable
      comme renfort quand un groupe cherche son pupitre.
    </p>
  </summary>
  <div class="body">
    <table>
      <thead>
        <tr>
          <th style="width:180px">Nom</th>
          <th style="width:100px">Discriminant</th>
          <th>Instruments</th>
          <th style="width:110px">Rôle</th>
          <th style="width:70px">Groupes</th>
          <th style="width:40px"></th>
        </tr>
      </thead>
      <tbody>
        {#each inscriptions.personnes as p}
          {@const nGroupes = inscriptions.groupes.filter((g) => g.membres.some((m) => m.personne_id === p.id)).length}
          <tr>
            <td><input bind:value={p.nom} onchange={onInvalider} /></td>
            <td><input bind:value={p.discriminant} onchange={onInvalider} placeholder="(B), R., L…" /></td>
            <td>
              {#each p.instruments as ins, ii}
                <span class="chip" class:chip-lourd={ins.lourd}>
                  <select bind:value={ins.pupitre} onchange={onInvalider} style="border:none;background:transparent;font-size:12.5px">
                    {#each lieu.pupitres as pup}
                      <option value={pup}>{pup}</option>
                    {/each}
                  </select>
                  <input bind:value={ins.precision} onchange={onInvalider} placeholder="précision" style="width:100px;font-size:11px" />
                  <label class="mini-lourd" title="Instrument lourd / difficile à déplacer — le solveur préfère alors regrouper les répés dans la même salle">
                    <input type="checkbox" bind:checked={ins.lourd} onchange={onInvalider} />
                    lourd
                  </label>
                  <button class="mini" onclick={() => onSupprimerInstrument(p.id, ii)}>×</button>
                </span>
              {/each}
              <button class="ghost mini-ajout" onclick={() => onAjouterInstrument(p.id)}>+ instrument</button>
            </td>
            <td>
              <select bind:value={p.role} onchange={onInvalider}>
                <option value="musicien">musicien</option>
                <option value="chanteur">chanteur</option>
                <option value="intervenant">intervenant</option>
              </select>
              {#if p.instruments.some((i) => i.pupitre === 'batterie')}
                <select
                  value={p.lateralite ?? ''}
                  onchange={(e) => {
                    const v = (e.currentTarget as HTMLSelectElement).value
                    p.lateralite = v === '' ? undefined : (v as 'droitier' | 'gaucher')
                    onInvalider()
                  }}
                  style="margin-top:4px;font-size:11px"
                  title="Latéralité (batteurs) — détermine les inversions de kit au concert"
                >
                  <option value="">latéralité ?</option>
                  <option value="droitier">droitier</option>
                  <option value="gaucher">gaucher</option>
                </select>
              {/if}
            </td>
            <td class="center mono">
              {nGroupes}
              {#if nGroupes === 0}<span class="tag-libre">libre</span>{/if}
            </td>
            <td class="center"><button class="mini" onclick={() => onSupprimerPersonne(p.id)}>×</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <button class="ghost" onclick={onAjouterPersonne}>+ Ajouter une personne</button>
  </div>
</details>

<style>
  .mini-lourd {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 10.5px;
    color: var(--ink-soft, #888);
    cursor: pointer;
    user-select: none;
  }
  .mini-lourd input[type='checkbox'] {
    margin: 0;
    transform: scale(0.85);
    accent-color: #b45309;
  }
  .chip-lourd {
    background: linear-gradient(180deg, rgba(180, 83, 9, 0.08), rgba(180, 83, 9, 0.03));
    border-color: rgba(180, 83, 9, 0.35) !important;
  }
</style>
