<script lang="ts">
  import type { IdContrainte } from '../engine/contraintes'
  import { REGISTRE_TOUT } from '../engine/contraintes'

  interface Props {
    contraintesActives: Record<IdContrainte, boolean>
    libelles: Record<IdContrainte, string>
    onToggle: (id: IdContrainte, actif: boolean) => void
  }
  let { contraintesActives, libelles, onToggle }: Props = $props()
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
</details>
