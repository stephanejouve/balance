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

  let copie = $state<boolean>(false)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function copier() {
    try {
      await navigator.clipboard.writeText(raw)
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
    title="Cliquer pour copier la version brute"
  >
    <span class="tag">Balance</span>
    <span class="ver">v{raw}</span>
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
