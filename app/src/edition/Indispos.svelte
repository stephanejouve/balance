<script lang="ts">
  import type { Personne } from '../domain/model'
  import { libellePersonne } from '../domain/model'
  import { afficherSaisieJours, dateFr, joursHorsSession, joursNonReconnus, libelleJoursIgnores, lireSaisieJours, normaliserJourSaisi } from '../domain/grille'
  import { descriptionBlocage, raisonIndispoIgnoree } from '../engine/indispo'
  import InputDuree from './InputDuree.svelte'

  interface Props {
    personnesAvecIndispo: Personne[]
    personnesSansIndispo: Personne[]
    nbIndispoTotal: number
    onAjouterIndispo: (pid: string) => void
    onSupprimerIndispo: (pid: string, i: number) => void
    onInvalider: () => void
    /** Jours ISO de la session — une date hors session ne bloque rien (#173). */
    joursSession?: string[]
  }
  let {
    personnesAvecIndispo,
    personnesSansIndispo,
    nbIndispoTotal,
    onAjouterIndispo,
    onSupprimerIndispo,
    onInvalider,
    joursSession,
  }: Props = $props()

  /** Aucun jour de la règle ne tombe dans la session : elle ne bloque rien (review Leader #178). */
  function horsSessionTotale(ind: Personne['indispos'][number]): boolean {
    if (!joursSession || ind.jours.length === 0) return false
    const session = new Set(joursSession)
    return ind.jours.every((j) => {
      const n = normaliserJourSaisi(j)
      return n === null || (/^\d{4}-/.test(n) && !session.has(n))
    })
  }

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

  /**
   * Règles vues IGNORÉES avant tout marqueur (#151, CD 2026-10-22). Une
   * écriture peut les rendre actives — même sur un champ anodin comme les
   * rôles — et l'éditeur doit alors le dire. Rempli au rendu, jamais vidé :
   * une règle saisie dans l'éditeur dès sa création n'y entre pas.
   */
  const ignoreesAvantMarqueur = new WeakSet<object>()
  function activeeParEcriture(ind: Personne['indispos'][number], raison: string | null): boolean {
    if (!ind.saisie_editeur) {
      if (raison) ignoreesAvantMarqueur.add(ind)
      return false
    }
    return raison === null && ignoreesAvantMarqueur.has(ind)
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
              value={afficherSaisieJours(ind.jours)}
              oninput={(e) => {
                ind.jours = lireSaisieJours((e.currentTarget as HTMLInputElement).value)
                modifie(ind)
              }}
              placeholder="mardi, 25/08/2026"
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
          {@const horsTout = !raison && horsSessionTotale(ind)}
          {@const hs = joursSession ? joursHorsSession(ind.jours, joursSession) : []}
          {@const activee = activeeParEcriture(ind, raison ?? (horsTout ? 'hors-session' : null))}
          {#if raison}
            <!-- #151 : une règle ignorée par le solveur le dit, là où on l'édite. -->
            <p class="indispo-ignoree" role="note">Ignorée dans le calcul. {raison}</p>
          {:else if horsTout}
            <!-- #173 (review Leader #178) : lisible mais hors session, elle ne bloque rien — jamais « compte maintenant ». -->
            <p class="indispo-ignoree" role="note">Ignorée dans le calcul. Hors des dates de la session ({hs.map(dateFr).join(', ')}) — la règle ne bloque rien. Pour que la règle compte : corrigez la date.</p>
          {:else if activee}
            <!-- #151 : le pendant — une règle que l'écriture vient d'activer le dit aussi. -->
            <p class="indispo-activee" role="note">Cette règle compte maintenant : elle bloque {descriptionBlocage(ind, joursSession)}.</p>
          {:else}
            <!-- #179 : « qu'est-ce que ma règle bloque », pour TOUTE règle active,
                 neuve ou pas — 160 ne répondait qu'à « qu'est-ce que je viens de
                 changer ». Registre informatif, pas une alerte. -->
            <p class="indispo-portee">Bloque : {descriptionBlocage(ind, joursSession)}.</p>
          {/if}
          {@const illisibles = joursNonReconnus(ind.jours)}
          {#if !raison && !horsTout && (illisibles.length > 0 || hs.length > 0)}
            <!-- #173 : un jour illisible ou hors session se voit là où il est saisi, même si d'autres jours de la règle comptent. -->
            <p class="indispo-ignoree" role="note">
              {#if illisibles.length > 0}{libelleJoursIgnores(illisibles)}{/if}
              {#if hs.length > 0}Hors des dates de la session, ignoré : {hs.map(dateFr).join(', ')}.{/if}
            </p>
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
  .indispo-portee {
    margin: 2px 0 8px;
    padding: 2px 8px;
    font-size: 0.85em;
    color: var(--ink-soft);
  }
  .indispo-activee {
    margin: 2px 0 8px;
    padding: 4px 8px;
    border-left: 3px solid var(--ink-soft);
    font-size: 0.85em;
  }
</style>
