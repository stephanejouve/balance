<script lang="ts">
  import type { EtapeConcert } from '../engine/concert'

  interface EtapeMinutee extends EtapeConcert {
    heure_debut: string
    heure_fin: string
    duree_min: number
    change_min: number
    inversion_kit: boolean
    lateralite?: 'droitier' | 'gaucher'
  }
  interface ConducteurMinutéT {
    etapes: EtapeMinutee[]
    duree_totale_min: number
    heure_fin: string
    nb_inversions: number
  }
  interface RepartitionT {
    parts: Array<{ style: string; n: number; pct: number }>
    runs: Array<{ style: string; debut: number; fin: number }>
  }

  interface Props {
    ordre: EtapeConcert[]
    conducteurMinuté: ConducteurMinutéT
    repartitionStyles: RepartitionT
    stats: { mouvements: number }
    cdDebut: string
    cdDureeMorceau: number
    cdDureeChange: number
    cdDureeKit: number
    onDebut: (v: string) => void
    onDureeMorceau: (v: number) => void
    onDureeChange: (v: number) => void
    onDureeKit: (v: number) => void
    onReordonnerAuto: () => void
    onDragStart: (i: number) => void
    onDrop: (i: number) => void
    dragIdx: number | null
    couleurStyle: (style: string) => string
  }
  let {
    ordre,
    conducteurMinuté,
    repartitionStyles,
    stats,
    cdDebut,
    cdDureeMorceau,
    cdDureeChange,
    cdDureeKit,
    onDebut,
    onDureeMorceau,
    onDureeChange,
    onDureeKit,
    onReordonnerAuto,
    onDragStart,
    onDrop,
    dragIdx,
    couleurStyle,
  }: Props = $props()
</script>

<div class="toolbar" style="margin-bottom:14px">
  <button class="ghost" onclick={onReordonnerAuto}>Recalculer l'ordre optimal</button>
  <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;font-size:12.5px;letter-spacing:0;font-weight:400">
    <span>Début</span>
    <input type="time" value={cdDebut} oninput={(e) => onDebut((e.currentTarget as HTMLInputElement).value)} style="width:100px" />
  </label>
  <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;font-size:12.5px;letter-spacing:0;font-weight:400">
    <span>Durée / morceau</span>
    <input type="number" min="1" max="30" value={cdDureeMorceau} oninput={(e) => onDureeMorceau(Number((e.currentTarget as HTMLInputElement).value))} style="width:60px" />
    <span class="mono">min</span>
  </label>
  <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;font-size:12.5px;letter-spacing:0;font-weight:400">
    <span>Changement plateau</span>
    <input type="number" min="0" max="15" value={cdDureeChange} oninput={(e) => onDureeChange(Number((e.currentTarget as HTMLInputElement).value))} style="width:60px" />
    <span class="mono">min</span>
  </label>
  <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;font-size:12.5px;letter-spacing:0;font-weight:400">
    <span>Inversion kit</span>
    <input type="number" min="0" max="30" value={cdDureeKit} oninput={(e) => onDureeKit(Number((e.currentTarget as HTMLInputElement).value))} style="width:60px" />
    <span class="mono">min</span>
  </label>
  <span class="grow"></span>
  <span class="mono ink-soft">
    {stats.mouvements} mouvement(s)
    {#if conducteurMinuté.nb_inversions > 0}
      · {conducteurMinuté.nb_inversions} inversion(s) kit
    {/if}
    · fin
    <b>{conducteurMinuté.heure_fin}</b>
    ({Math.floor(conducteurMinuté.duree_totale_min / 60)}h{String(conducteurMinuté.duree_totale_min % 60).padStart(2, '0')})
  </span>
</div>
<p class="hint">
  Glisse-dépose les lignes pour réordonner à la main. Chaque étape affiche son heure
  de début. Les changements de plateau sont intercalés automatiquement.
</p>
{#if repartitionStyles.parts.length > 0}
  <div class="repart-styles">
    <span class="ink-soft mono">Programmation :</span>
    {#each repartitionStyles.parts as p}
      <span class="chip-style" style="background:{couleurStyle(p.style)}">
        {p.style} <em>{p.n} · {p.pct}%</em>
      </span>
    {/each}
  </div>
  {#if repartitionStyles.runs.length > 0}
    <div class="msg warn" style="margin:8px 0 0">
      <b>Séquences dominées par un style</b> — l'alternance améliore le concert.
      <ul>
        {#each repartitionStyles.runs as r}
          <li>
            <b>{r.style}</b> — {r.fin - r.debut + 1} morceaux d'affilée
            (positions {r.debut + 1} à {r.fin + 1})
          </li>
        {/each}
      </ul>
    </div>
  {/if}
{/if}
<ol class="conducteur">
  {#each conducteurMinuté.etapes as etape, i (etape.groupe_id)}
    {#if etape.inversion_kit}
      <li class="marker">
        <span class="badge" style="background:var(--rouge);color:white;border:none">
          ⚙ inversion de kit ({cdDureeKit} min)
        </span>
      </li>
    {/if}
    <li
      draggable="true"
      ondragstart={() => onDragStart(i)}
      ondragover={(e) => e.preventDefault()}
      ondrop={(e) => { e.preventDefault(); onDrop(i) }}
      class:dragging={dragIdx === i}
    >
      <span class="num">{i + 1}</span>
      <span class="heure mono">{etape.heure_debut}</span>
      <span class="corps">
        <b>{etape.titre}</b>
        {#if etape.style}
          <span class="chip-style" style="background:{couleurStyle(etape.style)}">{etape.style}</span>
        {/if}
        {#if etape.lateralite === 'gaucher'}
          <span class="badge" style="background:#e3eee6;color:var(--vert);border-color:#bbd5c3">
            batterie gauchère
          </span>
        {/if}
      </span>
      <span class="mouvements mono ink-soft">
        {#if i > 0}
          ↑ {etape.musiciens_qui_montent.length}
          ↓ {etape.musiciens_qui_descendent.length}
        {:else}
          démarrage
        {/if}
      </span>
    </li>
  {/each}
</ol>
