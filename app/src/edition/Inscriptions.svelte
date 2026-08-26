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
  let {
    inscriptions,
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
