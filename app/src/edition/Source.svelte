<script lang="ts">
  interface Props {
    sourceLabel: string
    erreurImport: string
    warningsImport: string[]
    onNouvelleSession: () => void
    onUtiliserDemo: () => void
    onImporterXlsx: (e: Event) => void
    onImporterJson: (e: Event) => void
    onExporterJson: () => void
  }
  let {
    sourceLabel,
    erreurImport,
    warningsImport,
    onNouvelleSession,
    onUtiliserDemo,
    onImporterXlsx,
    onImporterJson,
    onExporterJson,
  }: Props = $props()
</script>

<section class="sheet">
  <p class="eyebrow">Étape 1 · Source</p>
  <h2>Inscriptions</h2>
  <p class="hint">
    Lecture directe de l'onglet <code>Liste</code> du classeur Excel de l'association,
    ou du jeu de démonstration.
  </p>
  <div class="toolbar">
    <button class="ghost" onclick={onNouvelleSession}>Nouvelle session (garde le lieu)</button>
    <button class="ghost" onclick={onUtiliserDemo}>Recharger la démo</button>
    <label class="fake-btn">
      Importer .xlsx…
      <input type="file" accept=".xlsx,.xlsm" hidden onchange={onImporterXlsx} />
    </label>
    <label class="fake-btn">
      Charger un état .json…
      <input type="file" accept=".json" hidden onchange={onImporterJson} />
    </label>
    <button class="ghost" onclick={onExporterJson}>Sauvegarder l'état .json</button>
    <span class="grow"></span>
    <span class="ink-soft mono">Chargé : {sourceLabel}</span>
  </div>
  {#if erreurImport}
    <div class="msg err"><b>Import échoué :</b> {erreurImport}</div>
  {/if}
  {#if warningsImport.length > 0}
    <div class="msg warn">
      <b>Avertissements d'import :</b>
      <ul>
        {#each warningsImport as w}<li>{w}</li>{/each}
      </ul>
    </div>
  {/if}
</section>
