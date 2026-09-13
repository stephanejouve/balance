<script lang="ts">
  import type { Groupe, Personne } from '../domain/model'
  import { libellePersonne } from '../domain/model'
  import type { Proposition } from '../engine/pool'

  /**
   * Panneau d'affichage du pool de propositions de mouvement — issue #96,
   * PR 3/6 chantier §D+§E.
   *
   * Cadrage CD 6656 pt c + CD 6657 : « affichage sans actionnable ». Ce
   * composant ne fait qu'AFFICHER les propositions calculées par la
   * fonction pure `calculerPool` — aucune interaction (pas de bouton
   * accepter/refuser). Les actions viennent en PR 4 (enregistrer refus)
   * et PR 5 (accepter mouvement).
   *
   * Position : panneau latéral repliable placé juste après l'Étape 1B
   * Inscriptions. Le pool dépend uniquement des inscriptions courantes
   * (+ créneaux, jauge, refus persistants) — il fonctionne dès la
   * composition, sans planning en cours.
   */

  interface Props {
    propositions: readonly Proposition[]
    groupesParId: Map<string, Groupe>
    personnesParId: Map<string, Personne>
    /**
     * Composant repliable : ouvert par défaut quand le pool contient au
     * moins une proposition (utilité immédiate), fermé sinon (économie
     * d'espace, message vide fugace). L'utilisateur peut le forcer
     * ouvert/fermé via l'interaction native `<details>`.
     */
    openParDefaut?: boolean
  }

  let { propositions, groupesParId, personnesParId, openParDefaut }: Props = $props()

  const open = $derived(openParDefaut ?? propositions.length > 0)

  function nomGroupe(id: string): string {
    return groupesParId.get(id)?.titre ?? id
  }

  function nomPersonne(id: string): string {
    const p = personnesParId.get(id)
    return p ? libellePersonne(p) : id
  }

  /**
   * Compose la phrase de gain à afficher sous la proposition — combine
   * les contributions individuelles (`gain_source`, `gain_cible`,
   * `cout_source`) qui se somment en `gain_net`. Le format factuel énonce
   * ce qui compte : « +1 source » (le morceau source loge maintenant),
   * « +1 cible » (le CHERCHE cible est pourvu), « −1 source » (pupitre
   * vidé côté source).
   */
  function libelleGain(p: Proposition): string {
    const parts: string[] = []
    if (p.gain_source > 0) parts.push(`+${p.gain_source} source loge`)
    if (p.gain_cible > 0) parts.push(`+${p.gain_cible} cible pourvue`)
    if (p.cout_source > 0) parts.push(`−${p.cout_source} pupitre source vidé`)
    return parts.length > 0 ? parts.join(' · ') : 'aucun gain'
  }
</script>

<details class="sheet pool" {open}>
  <summary>
    <p class="eyebrow">Étape 1B · Pool d'arbitrage</p>
    <h2>Mouvements pertinents ({propositions.length})</h2>
    <p class="hint">
      Vue calculée à partir des inscriptions et des refus persistants —
      indépendante du planning en cours. Affichage sans actionnable pour
      l'instant : les décisions (accepter, refuser, reporter) viendront
      dans les prochaines livraisons du chantier §96.
    </p>
  </summary>
  <div class="body">
    {#if propositions.length === 0}
      <p class="empty">
        Le pool est vide — aucun mouvement pertinent n'est disponible
        dans l'état actuel (soit tous les morceaux logent et pourvoient
        leurs postes cherchés, soit tous les mouvements possibles ont
        déjà été refusés).
      </p>
    {:else}
      <ul class="propositions">
        {#each propositions as p (`${p.personne_id}|${p.source_groupe_id}|${p.cible_groupe_id ?? '_'}`)}
          <li>
            <div class="tete">
              <b>{nomPersonne(p.personne_id)}</b>
              <span class="pupitre">({p.pupitre})</span>
              <span class="gain" title="gain net = gain_source + gain_cible − cout_source">
                gain net {p.gain_net}
              </span>
            </div>
            <div class="mouvement">
              {#if p.nom_mouvement === 'transfert' && p.cible_groupe_id}
                <span class="verbe">Transférer</span>
                de <b>{nomGroupe(p.source_groupe_id)}</b>
                vers <b>{nomGroupe(p.cible_groupe_id)}</b>
              {:else}
                <span class="verbe">Retirer</span>
                de <b>{nomGroupe(p.source_groupe_id)}</b>
                <span class="hint-inline">(sans réaffectation)</span>
              {/if}
            </div>
            <div class="detail-gain">{libelleGain(p)}</div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</details>

<style>
  .pool {
    margin-top: 10px;
  }
  .empty {
    color: var(--ink-soft, #666);
    font-style: italic;
    margin: 4px 0;
  }
  .propositions {
    list-style: none;
    padding: 0;
    margin: 8px 0 0 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .propositions li {
    padding: 8px 10px;
    background: var(--tint, #f6f6f6);
    border-radius: 4px;
    border-left: 3px solid var(--accent, #556270);
  }
  .tete {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .pupitre {
    color: var(--ink-soft, #666);
    font-size: 12.5px;
  }
  .gain {
    margin-left: auto;
    font-variant-numeric: tabular-nums;
    color: var(--accent, #556270);
    font-weight: 600;
    font-size: 12.5px;
  }
  .mouvement {
    margin-top: 4px;
    font-size: 13.5px;
  }
  .verbe {
    color: var(--accent, #556270);
    font-weight: 600;
  }
  .hint-inline {
    color: var(--ink-soft, #666);
    font-size: 12px;
    margin-left: 4px;
  }
  .detail-gain {
    margin-top: 4px;
    font-size: 12px;
    color: var(--ink-soft, #666);
    font-family: var(--font-mono, monospace);
  }
</style>
