<script lang="ts">
  import type { Lieu } from '../domain/model'

  interface Props {
    lieu: Lieu
    onAjouterSalle: () => void
    onSupprimerSalle: (i: number) => void
    onAjouterRestriction: (salleIdx: number) => void
    onSupprimerRestriction: (salleIdx: number, resIdx: number) => void
    onInvalider: () => void
  }
  let {
    lieu,
    onAjouterSalle,
    onSupprimerSalle,
    onAjouterRestriction,
    onSupprimerRestriction,
    onInvalider,
  }: Props = $props()
</script>

<details class="sheet" open>
  <summary>
    <p class="eyebrow">Étape 2a · Lieu</p>
    <h2>{lieu.nom}</h2>
    <p class="hint">
      {lieu.salles.filter((s) => s.actif).length} salle(s) active(s) sur {lieu.salles.length}.
      Cliquer pour déplier / modifier.
    </p>
  </summary>
  <div class="body">
    <label class="line">
      Nom du lieu <input bind:value={lieu.nom} onchange={onInvalider} />
    </label>
    <table>
      <thead>
        <tr>
          <th>Salle</th>
          <th style="width:80px">Jauge</th>
          <th style="width:70px">Active</th>
          <th>Restrictions horaires</th>
          <th style="width:40px"></th>
        </tr>
      </thead>
      <tbody>
        {#each lieu.salles as salle, i}
          <tr>
            <td><input bind:value={salle.nom} onchange={onInvalider} /></td>
            <td><input type="number" min="1" bind:value={salle.jauge} onchange={onInvalider} /></td>
            <td class="center"><input type="checkbox" bind:checked={salle.actif} onchange={onInvalider} /></td>
            <td>
              {#each salle.restrictions as res, ri}
                <div class="restr">
                  <input type="time" bind:value={res.debut} onchange={onInvalider} />
                  <span>→</span>
                  <input type="time" bind:value={res.fin} onchange={onInvalider} />
                  <select bind:value={res.contrainte} onchange={onInvalider}>
                    <option value="interdit">fermée</option>
                    <option value="acoustique_seulement">acoustique</option>
                    <option value="pas_reduit">créneaux ≤</option>
                  </select>
                  {#if res.contrainte === 'pas_reduit'}
                    <input type="number" min="5" max="180" step="5" bind:value={res.pas_max_minutes} onchange={onInvalider} placeholder="min" style="width:70px" />
                    <span class="mono ink-soft">min</span>
                  {/if}
                  <input bind:value={res.motif} onchange={onInvalider} placeholder="motif (dortoirs, concert vendredi…)" />
                  <button class="mini" onclick={() => onSupprimerRestriction(i, ri)}>×</button>
                </div>
                <div class="restr sub">
                  <span class="ink-soft mono">jours&nbsp;:</span>
                  <input
                    value={res.jours.join(', ')}
                    oninput={(e) => {
                      const v = (e.currentTarget as HTMLInputElement).value
                      res.jours = v.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean)
                      onInvalider()
                    }}
                    placeholder="tous par défaut — ou 2026-08-28, 2026-08-27…"
                  />
                </div>
              {/each}
              <button class="ghost mini-ajout" onclick={() => onAjouterRestriction(i)}>+ restriction</button>
            </td>
            <td class="center"><button class="mini" onclick={() => onSupprimerSalle(i)}>×</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <button class="ghost" onclick={onAjouterSalle}>+ Ajouter une salle</button>
  </div>
</details>
