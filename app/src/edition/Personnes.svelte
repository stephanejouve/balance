<script lang="ts">
  import type { Inscriptions, Lieu, Personne } from '../domain/model'
  import { libellePersonne } from '../domain/model'
  import { classePourPupitre, type StagiaireDuPupitre } from './libres-tri'

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

  /**
   * Vue « classe par pupitre » — pour l'intervenant de chaque pupitre :
   * l'ensemble des stagiaires ayant ce pupitre, triés par engagement
   * croissant, avec le nb de groupes engageant chacun. Objectif :
   * repérer les stagiaires qui n'ont pas encore su/senti s'engager
   * (0 groupe) et pouvoir leur proposer un morceau adapté.
   *
   * Les personnes apparaissent dans plusieurs sections si elles ont
   * plusieurs pupitres (principal + additionnels).
   */
  const classesParPupitre = $derived.by(() => {
    const sections: Array<{ pupitre: string; personnes: StagiaireDuPupitre[] }> = []
    for (const pup of lieu.pupitres) {
      const lst = classePourPupitre(pup, inscriptions)
      if (lst.length > 0) sections.push({ pupitre: pup, personnes: lst })
    }
    return sections
  })

  function precisionsAffichees(p: Personne): string {
    const parts: string[] = []
    for (const ins of p.instruments) {
      if (ins.precision) parts.push(ins.precision)
    }
    if (p.instruments.some((i) => i.pupitre === 'batterie') && p.lateralite) {
      parts.push(p.lateralite)
    }
    return parts.join(', ')
  }
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

    {#if classesParPupitre.length > 0}
      <section class="libres-par-pupitre" aria-label="Classe par pupitre — pilotage engagement">
        <h3>Classes par pupitre</h3>
        <p class="hint">
          Vue par pupitre pour les intervenants : stagiaires triés par
          engagement croissant. Les <span class="badge-libre">libres</span>
          sont en tête, à proposer en priorité pour combler les morceaux
          qui cherchent le pupitre.
        </p>
        <div class="colonnes">
          {#each classesParPupitre as section (section.pupitre)}
            {@const nLibres = section.personnes.filter((c) => c.nb_groupes === 0).length}
            <div class="colonne">
              <h4>
                <span class="pup">{section.pupitre}</span>
                <span class="count">
                  {section.personnes.length}
                  {#if nLibres > 0}
                    · <span class="badge-libre">{nLibres} libre{nLibres > 1 ? 's' : ''}</span>
                  {/if}
                </span>
              </h4>
              <ul>
                {#each section.personnes as c (c.personne.id)}
                  {@const details = precisionsAffichees(c.personne)}
                  <li class:est-libre={c.nb_groupes === 0}>
                    <span class="nom">{libellePersonne(c.personne)}</span>
                    {#if details}
                      <span class="details">— {details}</span>
                    {/if}
                    <span class="engagement">
                      {#if c.nb_groupes === 0}
                        <span class="tag-mini tag-mini-libre">libre</span>
                      {:else}
                        <span class="tag-mini">{c.nb_groupes} gr.</span>
                      {/if}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/each}
        </div>
      </section>
    {/if}
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
  .libres-par-pupitre {
    margin-top: 20px;
    padding-top: 16px;
    border-top: 1px dashed var(--rule, #ddd);
  }
  .libres-par-pupitre h3 {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 600;
  }
  .libres-par-pupitre .hint {
    font-size: 12px;
    color: var(--ink-soft, #888);
    margin: 0 0 12px;
  }
  .libres-par-pupitre .colonnes {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 12px;
  }
  .libres-par-pupitre .colonne {
    background: var(--surface-alt, rgba(0, 0, 0, 0.02));
    border-radius: 6px;
    padding: 10px 12px;
  }
  .libres-par-pupitre .colonne h4 {
    margin: 0 0 6px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }
  .libres-par-pupitre .pup {
    font-weight: 600;
  }
  .libres-par-pupitre .count {
    font-size: 11px;
    color: var(--ink-soft, #888);
    font-weight: 400;
  }
  .libres-par-pupitre ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .libres-par-pupitre li {
    font-size: 13px;
    padding: 3px 0;
    line-height: 1.4;
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-wrap: wrap;
    color: var(--ink-soft, #666);
  }
  .libres-par-pupitre li.est-libre {
    color: inherit;
  }
  .libres-par-pupitre .nom {
    font-weight: 500;
  }
  .libres-par-pupitre .details {
    color: var(--ink-soft, #888);
    font-size: 12px;
    flex: 1;
  }
  .libres-par-pupitre .engagement {
    margin-left: auto;
  }
  .libres-par-pupitre .tag-mini {
    font-size: 10.5px;
    padding: 1px 6px;
    border-radius: 8px;
    background: var(--rule, #eee);
    color: var(--ink-soft, #666);
  }
  .libres-par-pupitre .tag-mini-libre {
    background: #dcfce7;
    color: #166534;
    font-weight: 600;
  }
  .libres-par-pupitre .badge-libre {
    color: #166534;
    font-weight: 600;
  }
</style>
