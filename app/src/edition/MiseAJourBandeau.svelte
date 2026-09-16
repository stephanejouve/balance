<script lang="ts">
  import { onMount } from 'svelte'
  import {
    detecterMiseAJour,
    estDismissee,
    marquerDismissee,
    preparerEtatMaJPathSW,
    type EtatMiseAJour,
  } from './mise-a-jour'
  import { enregistrer } from './sw-register'

  let etat: EtatMiseAJour | null = $state(null)
  let masque = $state(false)

  function afficher(e: EtatMiseAJour) {
    // Premier qui trigger l'emporte : SW updatefound et fetch fallback
    // peuvent tous les 2 aboutir dans la même session — sans early-return,
    // l'user verrait un flash « installée en tâche de fond » puis
    // « v20260830.0800 » (ou l'inverse). On garde le 1er, ça suffit.
    if (etat?.statut === 'nouvelle-version') return
    etat = e
  }

  onMount(() => {
    // 1. Path SW (usage web, http(s)://) — le SW détecte push et notifie.
    //    Le SW ne connaît pas le numéro de version cible (juste qu'une
    //    nouvelle est prête). On fetch le manifest pour l'afficher —
    //    sans ça, on tombait sur « vinstallée en tâche de fond » (bug
    //    smoke Stéphane 2026-09-03) qui n'aide pas l'user à juger.
    //
    //    Ne PAS afficher si le manifest indique une version identique à
    //    la locale (CD 6980 : le SW `updatefound` fire quand le fichier
    //    sw.js change byte-à-byte, PAS forcément quand la version
    //    applicative change — un rebuild qui touche le SW sans bumper
    //    `__APP_VERSION__` provoquerait un faux positif « nouvelle
    //    version = version courante, recharger ». Sur un état chargé,
    //    l'utilisateur cliquerait et perdrait son travail, même famille
    //    de risque que les 2 reloads fermés par PR #140.
    //
    //    La logique de vérification vit dans `preparerEtatMaJPathSW`
    //    (mise-a-jour.ts) — testable en unité, aligné sur la même
    //    `versionEstPlusRecente` que Path fetch (pas de 2ᵉ lecteur qui
    //    divergerait un jour).
    enregistrer(async () => {
      const etat = await preparerEtatMaJPathSW(__APP_VERSION__, window.location.href)
      if (etat) afficher(etat)
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
        {#if etat.version_distante}v{etat.version_distante}{/if}
        {#if etat.installee_en_tache_de_fond}
          installée en tâche de fond
        {/if}
        — tu utilises v{etat.version_locale}
      </span>
    </div>
    <div class="actions">
      {#if etat.installee_en_tache_de_fond}
        <button type="button" class="btn-principal" onclick={recharger}>Recharger</button>
      {:else}
        <a class="btn-principal" href={etat.url_telechargement} download>Télécharger</a>
      {/if}
      <button type="button" class="btn-fermer" onclick={fermer} aria-label="Fermer">×</button>
    </div>
  </div>
{/if}

<style>
  /* Charte Balance : vert foncé + ocre (var(--board-deep) + var(--ochre)).
     Anciens bleus sombres/vifs (#1f2937 / #3b82f6) hors charte, remontés
     au smoke Stéphane 2026-09-03. */
  .bandeau {
    position: fixed;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    max-width: 640px;
    width: calc(100% - 24px);
    background: var(--board-deep);
    color: var(--paper);
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
    opacity: 0.85;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .btn-principal {
    background: var(--ochre);
    color: #231703;
    text-decoration: none;
    padding: 6px 12px;
    border-radius: 6px;
    font-weight: 600;
    border: none;
    cursor: pointer;
    font-size: 13px;
  }
  .btn-principal:hover {
    filter: brightness(1.08);
  }
  .btn-fermer {
    background: transparent;
    color: var(--paper);
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
