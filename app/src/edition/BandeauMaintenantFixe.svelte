<script lang="ts">
  /**
   * Bandeau permanent affiché tant que le paramètre URL `?maintenant=` a
   * figé le présent — issue CD msg 6777.
   *
   * Cadrage non négociable :
   *
   * - **Visible en permanence tant que l'état dure** : pas un message qui
   *   disparaît, pas un pied de page. Le composant est monté au sommet
   *   du DOM et reste tant que `maintenantFixe` est non-null.
   * - **Dire la valeur** : « date de référence fixée au 23 août 2026 »,
   *   pas « mode test ». L'utilisateur doit voir CE QUE l'application
   *   croit être aujourd'hui.
   * - **Moyen d'en sortir** : lien « Revenir à aujourd'hui » qui remet
   *   `maintenantFixe` à null en place (via callback parent) et retire
   *   le paramètre de l'URL via `history.pushState`. Post CD 6972 : plus
   *   de reload, l'état de travail (inscriptions, imports) est préservé.
   *
   * Pourquoi ce bandeau existe : sans lui, quelqu'un qui ajoute
   * `?maintenant=` à son URL (favoris, lien partagé) peut se retrouver
   * à travailler dans un présent faux sans le savoir — planning
   * cohérent en apparence, jugements pris sur une base fausse. C'est la
   * famille « un état qui ne s'annonce pas » qu'on corrige depuis une
   * semaine, à ne pas reconstruire ici.
   */

  interface Props {
    /** Date de référence si le paramètre `?maintenant=` est présent, sinon null. */
    maintenantFixe: Date | null
    /**
     * Vrai quand `inscriptions` est complètement vide (aucune personne,
     * aucun groupe, aucun imposé) — CD 6982. Une date de référence fixée
     * sans session chargée n'a pas d'objet ; l'écran doit le NOMMER
     * plutôt que laisser croire que le rejeu a fait perdre les données.
     * Cas typique : F5 accidentel (ou clic sur MàJ bandeau faussement
     * positif — corrigé PR #141 SW path) qui préserve `?maintenant=` via
     * URL mais vide `inscriptions` (init back to empty).
     */
    sessionVide: boolean
    /**
     * Callback appelé au clic « Revenir à aujourd'hui » — le parent mute
     * `maintenantFixe` à `null` en place (post CD 6972). Avant : ce
     * composant faisait un `window.location.href = ...` qui vidait toutes
     * les inscriptions et imports en cours (bug jumeau du Rejouer).
     */
    onRevenirAujourdhui: () => void
  }

  let { maintenantFixe, sessionVide, onRevenirAujourdhui }: Props = $props()

  const libelleDate = $derived.by(() => {
    if (!maintenantFixe) return ''
    return maintenantFixe.toLocaleString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  })

  /**
   * Propage l'action au parent, qui mute `maintenantFixe` à null et
   * supprime `?maintenant=` de l'URL via `history.pushState`. Pas de
   * reload — post CD 6972 : reload détruisait toutes les inscriptions
   * et imports en cours (bug jumeau du « Rejouer »).
   */
  function revenirAujourdhui() {
    onRevenirAujourdhui()
  }
</script>

{#if maintenantFixe}
  <div class="bandeau" role="status" aria-live="polite">
    <div class="contenu">
      <b>Date de référence fixée</b>
      <span class="valeur">au {libelleDate}</span>
      {#if sessionVide}
        <span class="vide">— aucune session chargée</span>
      {/if}
    </div>
    <button type="button" class="sortir" onclick={revenirAujourdhui}>
      Revenir à aujourd'hui
    </button>
  </div>
{/if}

<style>
  .bandeau {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    background: #fff3cd;
    color: #664d03;
    border-bottom: 2px solid #ffc107;
    font-size: 13.5px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }
  .contenu {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .valeur {
    font-variant-numeric: tabular-nums;
  }
  .vide {
    font-style: italic;
    opacity: 0.85;
  }
  .sortir {
    background: #664d03;
    color: #fff;
    border: none;
    padding: 4px 10px;
    border-radius: 3px;
    font-size: 12.5px;
    cursor: pointer;
    white-space: nowrap;
  }
  .sortir:hover {
    background: #4a380a;
  }
</style>
