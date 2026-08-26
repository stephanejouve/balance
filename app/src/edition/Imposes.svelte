<script lang="ts">
  import type { Inscriptions, Personne } from '../domain/model'
  import { libellePersonne } from '../domain/model'

  interface Props {
    inscriptions: Inscriptions
    personnesParId: Map<string, Personne>
    onAjouterImpose: () => void
    onSupprimerImpose: (i: number) => void
    onAjouterSeance: (imposeIdx: number) => void
    onSupprimerSeance: (imposeIdx: number, seanceIdx: number) => void
    onInvalider: () => void
  }
  let {
    inscriptions,
    personnesParId,
    onAjouterImpose,
    onSupprimerImpose,
    onAjouterSeance,
    onSupprimerSeance,
    onInvalider,
  }: Props = $props()
</script>

<details class="sheet">
  <summary>
    <p class="eyebrow">Étape 1c · Morceaux imposés</p>
    <h2>{inscriptions.imposes.length} imposé(s)</h2>
    <p class="hint">
      Morceaux « obligatoires » du stage avec leurs séances de répétition déjà planifiées.
      Les membres listés seront bloqués sur ces créneaux — le solveur en tient compte
      pour les groupes volontaires qui les partagent.
    </p>
  </summary>
  <div class="body">
    {#each inscriptions.imposes as imp, i}
      <div class="impose-bloc">
        <div class="impose-titre">
          <input bind:value={imp.morceau} onchange={onInvalider} class="strong" />
          <span class="mono ink-soft">{imp.membres.length} membres</span>
          <button class="mini" onclick={() => onSupprimerImpose(i)}>×</button>
        </div>
        <div class="chips">
          {#each imp.membres as pid}
            {@const p = personnesParId.get(pid)}
            <span class="chip">{p ? libellePersonne(p) : pid}</span>
          {/each}
          {#if imp.membres.length === 0}<span class="ink-soft">aucun membre</span>{/if}
        </div>
        <table class="seances">
          <thead>
            <tr>
              <th style="width:140px">Date</th>
              <th style="width:110px">Début</th>
              <th style="width:110px">Fin</th>
              <th>Salle (info)</th>
              <th style="width:40px"></th>
            </tr>
          </thead>
          <tbody>
            {#each imp.seances as s, si}
              <tr>
                <td><input type="date" bind:value={s.date} onchange={onInvalider} /></td>
                <td><input type="time" bind:value={s.debut} onchange={onInvalider} /></td>
                <td><input type="time" bind:value={s.fin} onchange={onInvalider} /></td>
                <td><input bind:value={s.salle_id} onchange={onInvalider} placeholder="XVème, Le Garage…" /></td>
                <td class="center">
                  <button class="mini" onclick={() => onSupprimerSeance(i, si)}>×</button>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <button class="ghost mini-ajout" onclick={() => onAjouterSeance(i)}>+ séance</button>
      </div>
    {/each}
    <button class="ghost" onclick={onAjouterImpose}>+ Ajouter un morceau imposé</button>
  </div>
</details>
