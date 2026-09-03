<script lang="ts">
  import type { Lieu } from '../domain/model'

  interface Props {
    lieu: Lieu
    /** Nombre de morceaux proposés en mémoire — affiche un bandeau si
     *  `fonctionsActivees.proposes` est décoché alors qu'ils existent. */
    nbProposesEnMemoire: number
    /** Nombre de personnes déclarées — sert à afficher un hint sous
     *  « suggestions de renforts » quand elle est cochée et vide. */
    nbPersonnesDeclarees: number
    onAjouterSalle: () => void
    onSupprimerSalle: (i: number) => void
    onAjouterRestriction: (salleIdx: number) => void
    onSupprimerRestriction: (salleIdx: number, resIdx: number) => void
    onInvalider: () => void
  }
  // `lieu` est mutée à travers ses items (salle.nom, salle.jauge,
  // restriction.jours, etc.) et ses toggles `fonctionsActivees`.
  // `$bindable()` exigé en Svelte 5.
  let {
    lieu = $bindable(),
    nbProposesEnMemoire,
    nbPersonnesDeclarees,
    onAjouterSalle,
    onSupprimerSalle,
    onAjouterRestriction,
    onSupprimerRestriction,
    onInvalider,
  }: Props = $props()

  /**
   * Dépendance UI entre bascules : conducteur implique ordre_passage.
   *  - Cocher `conducteur` coche `ordre_passage` (on ne minute pas sans
   *    savoir dans quel ordre)
   *  - Décocher `ordre_passage` décoche `conducteur` (même raison, sens
   *    inverse)
   * L'invariant symétrique côté modèle est appliqué par
   * `normaliserFonctionsActivees` (engine/fonctions-activees.ts) — la
   * règle ici est UI seulement (comportement au clic).
   */
  function toggleConducteur(v: boolean) {
    lieu.fonctionsActivees.conducteur = v
    if (v) lieu.fonctionsActivees.ordre_passage = true
    onInvalider()
  }
  function toggleOrdrePassage(v: boolean) {
    lieu.fonctionsActivees.ordre_passage = v
    if (!v) lieu.fonctionsActivees.conducteur = false
    onInvalider()
  }
  function toggleProposes(v: boolean) {
    lieu.fonctionsActivees.proposes = v
    onInvalider()
  }
  function toggleCharge(v: boolean) {
    lieu.fonctionsActivees.charge = v
    onInvalider()
  }
  function toggleRenforts(v: boolean) {
    lieu.fonctionsActivees.renforts = v
    onInvalider()
  }
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

    <div class="fonctions-activees">
      <p class="eyebrow-sub">Fonctions activées pour ce lieu</p>
      <p class="hint">
        Ce que ce lieu utilise. Une case décochée ne fait pas que cacher la section —
        elle retire aussi les données correspondantes du calcul (une contrainte invisible
        mais active serait le pire résultat possible). Configuration voyage avec le profil
        du lieu (§12).
      </p>
      <div class="toggles-grid">
        <label class="toggle">
          <input type="checkbox" checked={lieu.fonctionsActivees.proposes}
            onchange={(e) => toggleProposes((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            <strong>Concert du vendredi</strong>
            <span class="ink-soft">— morceaux proposés par l'équipe (Étape 1c). Décoché : le solveur ignore les séances imposées.</span>
          </span>
        </label>
        {#if !lieu.fonctionsActivees.proposes && nbProposesEnMemoire > 0}
          <div class="msg warn compact">
            <b>{nbProposesEnMemoire} morceau{nbProposesEnMemoire > 1 ? 'x' : ''} proposé{nbProposesEnMemoire > 1 ? 's' : ''} en mémoire, non pris en compte.</b>
            Recocher « Concert du vendredi » pour réintégrer les séances au calcul, ou les retirer manuellement.
          </div>
        {/if}
        <label class="toggle">
          <input type="checkbox" checked={lieu.fonctionsActivees.conducteur}
            onchange={(e) => toggleConducteur((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            <strong>Conducteur du spectacle</strong>
            <span class="ink-soft">— minutage du concert, changements de plateau, inversions de kit (vue Concert). Coche automatiquement « Ordre de passage ».</span>
          </span>
        </label>
        <label class="toggle">
          <input type="checkbox" checked={lieu.fonctionsActivees.ordre_passage}
            onchange={(e) => toggleOrdrePassage((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            <strong>Ordre de passage</strong>
            <span class="ink-soft">— drag-drop et scoring de l'ordre du concert. Décocher retire aussi « Conducteur ».</span>
          </span>
        </label>
        <label class="toggle">
          <input type="checkbox" checked={lieu.fonctionsActivees.charge}
            onchange={(e) => toggleCharge((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            <strong>Charge par musicien</strong>
            <span class="ink-soft">— alertes seuil, vue Quotas. Utile pour repérer les personnes surchargées.</span>
          </span>
        </label>
        <label class="toggle">
          <input type="checkbox" checked={lieu.fonctionsActivees.renforts}
            onchange={(e) => toggleRenforts((e.currentTarget as HTMLInputElement).checked)} />
          <span>
            <strong>Suggestions de renforts</strong>
            <span class="ink-soft">— quand un groupe cherche un pupitre, propose les personnes libres disponibles.</span>
          </span>
        </label>
        {#if lieu.fonctionsActivees.renforts && nbPersonnesDeclarees === 0}
          <div class="hint ink-soft compact">
            (Pas de personnes déclarées pour l'instant — les suggestions n'auront rien à proposer tant que le référentiel de personnes est vide.)
          </div>
        {/if}
      </div>
    </div>
  </div>
</details>

<style>
  .fonctions-activees {
    margin-top: 24px;
    padding: 16px 18px 18px;
    border: 1px dashed var(--paper-edge, #E8E5DA);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.02);
  }
  .eyebrow-sub {
    font-family: var(--mono, monospace);
    font-size: 11px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ochre, #C8871F);
    font-weight: 600;
    margin: 0 0 6px;
  }
  .fonctions-activees .hint {
    font-size: 13px;
    margin: 0 0 12px;
  }
  .toggles-grid {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .toggle {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    font-size: 14px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
  }
  .toggle:hover {
    background: rgba(0, 0, 0, 0.03);
  }
  .toggle input[type='checkbox'] {
    margin-top: 3px;
    flex-shrink: 0;
  }
  .toggle strong {
    display: block;
    margin-bottom: 2px;
  }
  .toggle .ink-soft {
    display: block;
    font-size: 13px;
    line-height: 1.4;
  }
  .msg.compact,
  .hint.compact {
    padding: 8px 12px;
    font-size: 13px;
    margin: 0 0 0 26px;
  }
</style>
