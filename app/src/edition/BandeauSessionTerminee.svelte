<script lang="ts">
  /**
   * Bandeau affiché quand la session chargée a ses dates entièrement
   * passées et qu'aucun `?maintenant=` n'est déjà fixé — issue CD msg
   * 6833 (2026-09-14).
   *
   * Cadrage non négociable :
   *
   * - **La proposition ne s'applique pas toute seule** — CD 6833. Le
   *   bandeau EXPOSE le rejeu, l'utilisateur clique ou pas. Aucun effet
   *   collatéral tant que le bouton n'a pas été activé.
   * - **La date proposée est la veille de `date_debut`** — choisie pour
   *   que `genererCreneaux` conserve tous les créneaux (le premier
   *   créneau du 1ᵉʳ jour tombe strictement après la veille à midi via
   *   `parseMaintenantUrlParam`, qui fixe l'heure par défaut à 12:00).
   * - **Le calcul de proposition** (voir `propositionRejouer` dans
   *   `domain/maintenant.ts`) est pure : quand la proposition arrive
   *   ici, elle est prête à afficher.
   *
   * Symétrique de `BandeauMaintenantFixe.svelte` (mode figé actif) —
   * l'un OU l'autre est visible, jamais les deux ensemble.
   */

  interface Props {
    /** Proposition calculée par `propositionRejouer`, null = rien à proposer. */
    proposition: { dateFin: string; dateProposee: string } | null
    /**
     * Callback appelé au clic — le parent mute `maintenantFixe` en place
     * (post CD 6972). Avant : ce composant faisait un
     * `window.location.href = ...` qui vidait toutes les inscriptions et
     * imports en cours.
     */
    onRejouer: (dateIso: string) => void
  }

  let { proposition, onRejouer }: Props = $props()

  const libelleFin = $derived.by(() => {
    if (!proposition) return ''
    return formatDateFr(proposition.dateFin)
  })

  const libelleProposee = $derived.by(() => {
    if (!proposition) return ''
    return formatDateFr(proposition.dateProposee)
  })

  function formatDateFr(iso: string): string {
    const [y, m, d] = iso.split('-').map(Number)
    const dt = new Date(y, m - 1, d, 12, 0)
    return dt.toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }

  /**
   * Propage la date proposée au parent, qui mute `maintenantFixe` en
   * place et met à jour l'URL via `history.pushState`. Pas de reload —
   * post CD 6972 : reload détruisait toutes les inscriptions et imports
   * en cours (bug destructeur observé en ligne le 15/09).
   */
  function rejouer() {
    if (!proposition) return
    onRejouer(proposition.dateProposee)
  }
</script>

{#if proposition}
  <div class="bandeau" role="status" aria-live="polite">
    <div class="contenu">
      <b>Session terminée</b>
      <span>Le {libelleFin} est passé. Rejouer cette session à la veille du début ({libelleProposee}) ?</span>
    </div>
    <button type="button" class="rejouer" onclick={rejouer}>Rejouer à cette date</button>
  </div>
{/if}

<style>
  .bandeau {
    position: sticky;
    top: 0;
    z-index: 99;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    background: #e7f3ff;
    color: #0b4d80;
    border-bottom: 2px solid #4a90e2;
    font-size: 13.5px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }
  .contenu {
    display: flex;
    align-items: baseline;
    gap: 8px;
    flex-wrap: wrap;
  }
  .rejouer {
    background: #0b4d80;
    color: #fff;
    border: none;
    padding: 4px 10px;
    border-radius: 3px;
    font-size: 12.5px;
    cursor: pointer;
    white-space: nowrap;
  }
  .rejouer:hover {
    background: #073657;
  }
</style>
