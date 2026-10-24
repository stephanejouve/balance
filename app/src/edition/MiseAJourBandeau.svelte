<script lang="ts">
  import { onMount } from 'svelte'
  import {
    detecterMiseAJour,
    estDismissee,
    marquerDismissee,
    preparerEtatMaJPathSW,
    type EtatMiseAJour,
  } from './mise-a-jour'
  import { rechargerPage } from './recharger-page'
  import { enregistrer, preparerRechargement } from './sw-register'

  let etat = $state<EtatMiseAJour | null>(null)
  let masque = $state(false)
  /**
   * #205 : « Recharger » cliqué, nouveau SW pas encore aux commandes.
   * #216 : passé le délai, `attente` jusqu'au `controllerchange`, puis
   * `prete` : la page ne se recharge pas d'elle-même, un nouveau clic le
   * fait (arbitrage CD 59806). `echec` si la vérification n'a pas eu lieu.
   */
  let installation: 'en-cours' | 'attente' | 'prete' | 'echec' | null = $state(null)

  // #205 : sur le web, recharger suffit. Le SW installe la nouvelle
  // version (skipWaiting + clients.claim) et la sert au chargement
  // suivant ; c'est ce qu'a constaté CD au 2ᵉ chargement. Avant, seul le
  // path SW proposait « Recharger » : quand le path fetch arrivait le
  // premier, le bandeau n'offrait que « Télécharger », qui dépose un
  // fichier et laisse l'onglet sur l'ancienne version. Sur `file://`,
  // recharger rouvre le même fichier : seul le téléchargement aide.
  const surLeWeb = typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
  const peutRecharger = $derived(
    etat?.statut === 'nouvelle-version' && (etat.installee_en_tache_de_fond === true || surLeWeb),
  )

  function afficher(e: EtatMiseAJour) {
    // Premier qui trigger l'emporte : SW updatefound et fetch fallback
    // peuvent tous les 2 aboutir dans la même session — sans early-return,
    // l'user verrait un flash « installée en tâche de fond » puis
    // « v20260830.0800 » (ou l'inverse). On garde le 1er, ça suffit.
    if (etat?.statut === 'nouvelle-version') return
    etat = e
  }

  onMount(() => {
    // #216 : le nouveau SW peut prendre la main APRÈS le délai (30 s
    // mesurées en production pour 15 s). Pas de rechargement tardif : un
    // clic vaut accord pour recharger tout de suite, pas trente secondes
    // plus tard. Le bandeau annonce la version prête, et un message
    // d'échec qui nierait la prise de main disparaît. `en-cours` : c'est
    // `preparerRechargement` qui écoute et recharge.
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
    const surPriseDeMain = () => {
      if (installation === 'attente') installation = 'prete'
      else if (installation === 'echec') installation = null
    }
    sw?.addEventListener('controllerchange', surPriseDeMain)

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

    return () => sw?.removeEventListener('controllerchange', surPriseDeMain)
  })

  function fermer() {
    if (etat?.statut === 'nouvelle-version') {
      marquerDismissee(etat.version_distante)
    }
    masque = true
  }

  async function recharger() {
    installation = 'en-cours'
    const issue = await preparerRechargement()
    if (issue === 'pret') rechargerPage()
    else installation = issue === 'delai' ? 'attente' : 'echec'
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
      {#if peutRecharger}
        <!-- Rien ne survit au rechargement (aucun état en localStorage,
             cf PR #140) : le dire avant le clic, pas après. Et ne pas
             promettre plus que le bouton cité : exporterEtat écrit lieu,
             session, inscriptions et contraintes, pas le planning (#209). -->
        <span class="details">
          Le rechargement repart d'une page vierge : sauvegarde d'abord ton travail
          (« Sauvegarder l'état .json »). Le .json garde les données, pas le planning :
          les séances figées ou déplacées à la main seront à refaire.
        </span>
      {/if}
      {#if installation === 'attente'}
        <!-- #216 : vrai tant que l'écoute tient ; au controllerchange le
             bandeau passe à `prete`, sans recharger. -->
        <span class="details">
          L'installation prend plus de temps que prévu. La page ne se rechargera pas d'elle-même :
          ce message changera quand la nouvelle version sera prête.
        </span>
      {:else if installation === 'prete'}
        <span class="details">
          La nouvelle version est prête : clique sur « Recharger » pour l'utiliser.
        </span>
      {:else if installation === 'echec'}
        <!-- #216 : retiré au controllerchange, qui le rendrait faux. -->
        <span class="details">
          La vérification de la nouvelle version a échoué : réessaie dans un instant.
        </span>
      {/if}
    </div>
    <div class="actions">
      {#if peutRecharger}
        <button type="button" class="btn-principal" onclick={recharger} disabled={installation === 'en-cours'}>
          {installation === 'en-cours' ? 'Installation…' : 'Recharger'}
        </button>
      {/if}
      {#if !etat.installee_en_tache_de_fond}
        <a class={peutRecharger ? 'btn-secondaire' : 'btn-principal'} href={etat.url_telechargement} download>Télécharger</a>
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
  .btn-secondaire {
    color: var(--paper);
    text-decoration: underline;
    padding: 6px 8px;
    font-size: 13px;
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
