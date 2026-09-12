<script lang="ts">
  /**
   * Pied de page discret affiché en permanence.
   *
   * Objet : lever le doute « ai-je la version à jour ? » sans avoir à
   * attendre le bandeau `MiseAJourBandeau` (qui ne se montre que si une
   * version distante plus récente est détectée).
   *
   * Feedback Stéphane 2026-09-01 : la version dynamique n'apparaissait
   * qu'au moment d'une mise à jour disponible — il fallait pouvoir la
   * lire à tout moment, notamment pour reporter un bug (« je suis sur la
   * v20260901.1420 et j'ai vu ceci… »).
   *
   * Format : `YYYYMMDD.HHMM` UTC — parsé pour un rendu humain
   * « 1 septembre 2026 · 14:20 UTC ». Cliquable pour copier la version
   * brute dans le presse-papiers (usage support).
   */

  const raw = __APP_VERSION__
  // SHA court du commit au moment du build (7 caractères). Ajouté par CD
  // 2026-09-12 après incident de cache navigateur : le timestamp seul dit
  // QUAND, il ne dit pas CE QUI. Un SHA à côté vérifie qu'on est bien sur
  // le bon commit — utile pour un rapport de bug traçable ou une confusion
  // branche/main. Chaîne vide si le build n'a pas eu accès à un repo git
  // (dev local sans .git, container non initialisé) — dégradation silencieuse.
  const raw_sha = __APP_SHA__

  function formaterVersion(v: string): string {
    // Format attendu : YYYYMMDD.HHMM (ex. 20260901.1420)
    const m = v.match(/^(\d{4})(\d{2})(\d{2})\.(\d{2})(\d{2})$/)
    if (!m) return v // fallback : version brute si format inattendu
    const [, y, mm, d, hh, mn] = m
    const mois = [
      'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
      'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre',
    ]
    const nomMois = mois[parseInt(mm, 10) - 1] ?? mm
    // Retire le zéro non significatif du jour pour respecter la
    // convention française (« 1 septembre » et non « 01 septembre »).
    const jour = parseInt(d, 10)
    return `${jour} ${nomMois} ${y} · ${hh}:${mn} UTC`
  }

  // Contenu à copier : version + SHA si dispo, pour qu'un rapport de bug
  // porte les deux d'un coup (« je suis sur v20260912.1351 · 151eb51 »).
  const contenuCopie = raw_sha ? `v${raw} · ${raw_sha}` : `v${raw}`

  let copie = $state<boolean>(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function copier() {
    try {
      await navigator.clipboard.writeText(contenuCopie)
      copie = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => (copie = false), 1500)
    } catch {
      // Pas de clipboard disponible (contexte file://, permission refusée) —
      // silence acceptable, l'user voit la version dans le texte du bouton.
    }
  }
</script>

<footer class="pied-page">
  <button
    type="button"
    class="version"
    onclick={copier}
    title="Cliquer pour copier la version + SHA"
  >
    <span class="tag">Balance</span>
    <span class="ver">v{raw}</span>
    {#if raw_sha}
      <span class="sep">·</span>
      <span class="sha" title="Commit au moment du build">{raw_sha}</span>
    {/if}
    <span class="humaine">({formaterVersion(raw)})</span>
    {#if copie}<span class="copie">✓ copié</span>{/if}
  </button>
</footer>

<style>
  .pied-page {
    padding: 12px 16px 24px;
    text-align: center;
    color: #6b7280;
    font-size: 12px;
  }
  .version {
    background: none;
    border: none;
    color: inherit;
    font-size: inherit;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-family: inherit;
  }
  .version:hover {
    background: #f3f4f6;
    color: #374151;
  }
  .tag {
    font-weight: 600;
  }
  .ver {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #9ca3af;
  }
  .sep {
    color: #d1d5db;
  }
  .sha {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #9ca3af;
  }
  .humaine {
    color: #9ca3af;
  }
  .copie {
    color: #059669;
    font-weight: 600;
  }
  @media print {
    .pied-page {
      display: none;
    }
  }
</style>
