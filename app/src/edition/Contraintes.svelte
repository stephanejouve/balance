<script lang="ts">
  import type { IdContrainte } from '../engine/contraintes'
  import { REGISTRE_TOUT } from '../engine/contraintes'

  interface Props {
    contraintesActives: Record<IdContrainte, boolean>
    libelles: Record<IdContrainte, string>
    onToggle: (id: IdContrainte, actif: boolean) => void
    onReplace: (nouv: Record<IdContrainte, boolean>) => void
  }
  let { contraintesActives, libelles, onToggle, onReplace }: Props = $props()

  function exporterJson() {
    if (typeof document === 'undefined') return
    const blob = new Blob([JSON.stringify(contraintesActives, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `balance-contraintes-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }
  async function importerJson(e: Event) {
    const cible = e.target as HTMLInputElement
    const file = cible.files?.[0]
    if (!file) return
    try {
      const brut = JSON.parse(await file.text()) as Partial<Record<IdContrainte, boolean>>
      // Merge : garde les valeurs actuelles pour les clés absentes
      const nouv = { ...contraintesActives }
      for (const id of REGISTRE_TOUT) if (id in brut) nouv[id] = !!brut[id]
      onReplace(nouv)
    } catch (err) {
      alert(`Import JSON échoué : ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      cible.value = ''
    }
  }
</script>

<details class="sheet">
  <summary>
    <p class="eyebrow">Étape 2c · Contraintes</p>
    <h2>Règles activées</h2>
    <p class="hint">
      {Object.values(contraintesActives).filter(Boolean).length} / {REGISTRE_TOUT.length}
      contraintes actives. Désactive une règle pour tester ce qui bloque.
    </p>
  </summary>
  <div class="body">
    <div class="toolbar" style="margin-top:0;margin-bottom:14px">
      <button class="ghost" onclick={exporterJson}>Exporter le profil .json</button>
      <label class="fake-btn">
        Importer un profil .json…
        <input type="file" accept=".json" hidden onchange={importerJson} />
      </label>
      <span class="grow"></span>
      <span class="mono ink-soft">
        {Object.values(contraintesActives).filter(Boolean).length} / {REGISTRE_TOUT.length}
      </span>
    </div>
    <div class="contraintes-grid">
      {#each REGISTRE_TOUT as id}
        <label class="check">
          <input
            type="checkbox"
            checked={contraintesActives[id]}
            onchange={(e) => onToggle(id, (e.currentTarget as HTMLInputElement).checked)}
          />
          <span>{libelles[id]}</span>
          <code>{id}</code>
        </label>
      {/each}
    </div>
  </div>
</details>

<style>
  .contraintes-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 0 20px;
  }
</style>
