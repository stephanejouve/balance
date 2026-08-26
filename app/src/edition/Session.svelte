<script lang="ts">
  import type { Session } from '../domain/model'

  interface Props {
    session: Session
    nbCreneaux: number
    onAjouterRegle: () => void
    onSupprimerRegle: (i: number) => void
    onInvalider: () => void
  }
  let { session, nbCreneaux, onAjouterRegle, onSupprimerRegle, onInvalider }: Props = $props()
</script>

<details class="sheet" open>
  <summary>
    <p class="eyebrow">Étape 2b · Session</p>
    <h2>{session.nom}</h2>
    <p class="hint">
      {session.date_debut} → {session.date_fin}, butoir {session.date_butoir} {session.butoir_heure}.
      {session.grille.filter((r) => !r.bloque).length} règle(s) créatrice(s),
      {session.grille.filter((r) => r.bloque).length} règle(s) de blocage —
      <b>{nbCreneaux}</b> créneaux générés.
    </p>
  </summary>
  <div class="body">
    <label class="line">
      Nom de session <input bind:value={session.nom} onchange={onInvalider} />
    </label>
    <div class="fields">
      <label>Début <input type="date" bind:value={session.date_debut} onchange={onInvalider} /></label>
      <label>Fin <input type="date" bind:value={session.date_fin} onchange={onInvalider} /></label>
      <label>Butoir <input type="date" bind:value={session.date_butoir} onchange={onInvalider} /></label>
      <label>Butoir heure <input type="time" bind:value={session.butoir_heure} onchange={onInvalider} /></label>
      <label>Répétitions visées <input type="number" min="1" max="10" bind:value={session.repetitions_visees} onchange={onInvalider} /></label>
      <label>Minimum acceptable <input type="number" min="1" max="10" bind:value={session.repetitions_min} onchange={onInvalider} /></label>
      <label>
        Marge d'occupation ({session.marge_pct}%)
        <input type="range" min="0" max="50" step="5" bind:value={session.marge_pct} onchange={onInvalider} />
      </label>
    </div>
    <p class="hint" style="margin:6px 0 0;font-size:12.5px">
      <b>Marge {session.marge_pct}%</b> — le solveur ne remplira pas plus de
      {100 - session.marge_pct}% des salles disponibles à chaque créneau. À 0%,
      il peut saturer à 100% (moins de tolérance aux imprévus).
    </p>
    <h3>Grille de créneaux</h3>
    <p class="hint">
      Chaque règle génère des créneaux sur les jours ciblés (colonne <b>Jours</b> —
      vide = tous les jours de la session). Accepte des dates ISO (<code>2026-08-26</code>)
      ou des noms de jour FR (<code>mercredi</code>, <code>lundi</code>…).
      « Bloque » retire les créneaux qui tombent dans la plage. Pour minuit, saisis
      <code>24:00</code> plutôt que <code>00:00</code> (mieux compris par le solveur).
    </p>
    <table>
      <thead>
        <tr>
          <th>Jours (ISO, CSV)</th>
          <th style="width:110px">Début</th>
          <th style="width:110px">Fin</th>
          <th style="width:80px">Pas (min)</th>
          <th style="width:80px">Bloque</th>
          <th style="width:40px"></th>
        </tr>
      </thead>
      <tbody>
        {#each session.grille as regle, i}
          <tr>
            <td>
              <input
                value={regle.jours.join(', ')}
                oninput={(e) => {
                  regle.jours = (e.currentTarget as HTMLInputElement).value
                    .split(/[,;\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                  onInvalider()
                }}
                placeholder="tous les jours"
              />
            </td>
            <td><input type="time" bind:value={regle.debut} onchange={onInvalider} /></td>
            <td><input type="time" bind:value={regle.fin} onchange={onInvalider} /></td>
            <td><input type="number" min="10" max="240" step="15" bind:value={regle.pas_minutes} onchange={onInvalider} /></td>
            <td class="center"><input type="checkbox" bind:checked={regle.bloque} onchange={onInvalider} /></td>
            <td class="center"><button class="mini" onclick={() => onSupprimerRegle(i)}>×</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <button class="ghost" onclick={onAjouterRegle}>+ Ajouter une règle</button>
  </div>
</details>
