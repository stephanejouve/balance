<script lang="ts">
  import { parseLegacyInscriptions } from './domain/legacy'
  import fixture from './fixtures/apero_mercredi.json'

  const data = parseLegacyInscriptions(fixture)
</script>

<main>
  <header>
    <p class="eyebrow">Balance — refonte en cours</p>
    <h1>Répartiteur de <em>répétitions</em></h1>
    <p class="hint">
      Scaffold Svelte + TypeScript + Vite. Le prototype hérité reste à la racine du
      projet. La refonte se construit ici, à partir du cahier des charges.
    </p>
  </header>

  <section class="sheet">
    <p class="eyebrow">Lecture du jeu réel</p>
    <p class="hint">
      Chargement de <code>apero_mercredi.json</code> via le parseur legacy et Zod.
    </p>
    <ul>
      <li><b>{data.groupes.length}</b> groupe(s)</li>
      <li><b>{data.indispos.length}</b> règle(s) d'indisponibilité</li>
      <li><b>{data.identitesConnues.length}</b> identité(s) whitelistée(s)</li>
    </ul>
  </section>
</main>

<style>
  main {
    max-width: 960px;
    margin: 0 auto;
    padding: 40px 20px 80px;
    color: var(--paper, #faf9f4);
    background: var(--board, #26332c);
    min-height: 100vh;
  }
  .eyebrow {
    font-family: 'IBM Plex Mono', ui-monospace, monospace;
    font-size: 11px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ochre, #c8871f);
    margin: 0 0 6px;
    font-weight: 600;
  }
  h1 {
    font-family: 'Instrument Serif', Georgia, serif;
    font-size: clamp(34px, 5vw, 54px);
    line-height: 1.02;
    margin: 0 0 8px;
    font-weight: 400;
  }
  h1 em {
    font-style: italic;
    color: var(--ochre, #c8871f);
  }
  .hint {
    color: rgba(250, 249, 244, 0.7);
    max-width: 60ch;
  }
  .sheet {
    background: var(--paper, #faf9f4);
    color: var(--ink, #1a211d);
    border-radius: 2px;
    padding: 26px 28px 30px;
    margin: 30px 0 0;
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
  }
  .sheet .eyebrow {
    color: var(--ochre, #c8871f);
  }
  .sheet .hint {
    color: #5b6660;
  }
  ul {
    margin-top: 12px;
  }
</style>
