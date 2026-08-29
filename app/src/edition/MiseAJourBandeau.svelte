<script lang="ts">
  import { onMount } from 'svelte'
  import {
    detecterMiseAJour,
    estDismissee,
    marquerDismissee,
    type EtatMiseAJour,
  } from './mise-a-jour'
  import { enregistrer } from './sw-register'

  let etat: EtatMiseAJour | null = $state(null)
  let masque = $state(false)

  function afficher(e: EtatMiseAJour) {
    etat = e
  }

  onMount(() => {
    // 1. Path SW (usage web, http(s)://) — le SW détecte push et notifie.
    enregistrer(() => {
      afficher({
        statut: 'nouvelle-version',
        version_locale: __APP_VERSION__,
        version_distante: 'installée en tâche de fond',
        url_telechargement: window.location.href,
      })
    })
    // 2. Path fetch fallback (usage file:// ou pour vérification proactive
    //    même sur http). Ne fait rien si offline.
    detecterMiseAJour(__APP_VERSION__).then((e) => {
      if (e.statut === 'nouvelle-version' && !estDismissee(e.version_distante)) {
        afficher(e)
      }
    })
  })

  function fermer() {
    if (etat?.statut === 'nouvelle-version') {
      marquerDismissee(etat.version_distante)
    }
    masque = true
  }

  function recharger() {
    window.location.reload()
  }
</script>

{#if etat?.statut === 'nouvelle-version' && !masque}
  <div class="bandeau" role="status" aria-live="polite">
    <div class="contenu">
      <strong>Nouvelle version disponible</strong>
      <span class="details">
        v{etat.version_distante} — tu utilises v{etat.version_locale}
      </span>
    </div>
    <div class="actions">
      {#if etat.version_distante === 'installée en tâche de fond'}
        <button type="button" class="btn-principal" onclick={recharger}>Recharger</button>
      {:else}
        <a class="btn-principal" href={etat.url_telechargement} download>Télécharger</a>
      {/if}
      <button type="button" class="btn-fermer" onclick={fermer} aria-label="Fermer">×</button>
    </div>
  </div>
{/if}

<style>
  .bandeau {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 640px;
    width: calc(100% - 24px);
    background: #1f2937;
    color: #f9fafb;
    border-radius: 8px;
    padding: 12px 16px;
    display: flex;
    align-items: center;
    gap: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.24);
    font-size: 14px;
    z-index: 1000;
  }
  .contenu {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .details {
    font-size: 12px;
    opacity: 0.75;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .btn-principal {
    background: #3b82f6;
    color: white;
    text-decoration: none;
    padding: 6px 12px;
    border-radius: 6px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    font-size: 13px;
  }
  .btn-principal:hover {
    background: #2563eb;
  }
  .btn-fermer {
    background: transparent;
    color: #f9fafb;
    border: none;
    cursor: pointer;
    font-size: 20px;
    line-height: 1;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .btn-fermer:hover {
    background: rgba(255, 255, 255, 0.1);
  }
</style>
