<script lang="ts">
  import type { Creneau } from '../domain/grille'
  import type { Groupe, Inscriptions, Personne, Salle } from '../domain/model'
  import { libellePersonne } from '../domain/model'
  import { chargeParMusicien } from '../engine/charge'
  import type { Assignation } from '../engine/types'

  interface Props {
    inscriptions: Inscriptions
    creneaux: Creneau[]
    assignations: Assignation[]
    groupesParId: Map<string, Groupe>
    sallesParId: Map<string, Salle>
    creneauxParId: Map<string, Creneau>
    seuilChargeJour: number
    onSeuilChange: (v: number) => void
  }
  let {
    inscriptions,
    creneaux,
    assignations,
    groupesParId,
    sallesParId,
    creneauxParId,
    seuilChargeJour,
    onSeuilChange,
  }: Props = $props()

  const chargeMap = $derived(chargeParMusicien(inscriptions, creneaux, assignations))
  const parPersonne = $derived.by(() => {
    const m = new Map<string, Array<{ a: Assignation; c: Creneau }>>()
    for (const a of assignations) {
      const c = creneauxParId.get(a.creneau_id)
      const g = groupesParId.get(a.groupe_id)
      if (!c || !g) continue
      const membres = new Set(g.membres.map((mm) => mm.personne_id))
      for (const pid of membres) {
        if (!m.has(pid)) m.set(pid, [])
        m.get(pid)!.push({ a, c })
      }
    }
    for (const l of m.values())
      l.sort((x, y) => `${x.c.date}T${x.c.debut}`.localeCompare(`${y.c.date}T${y.c.debut}`))
    return m
  })
  const surcharges = $derived([...chargeMap.values()].filter((c) => c.max_jour > seuilChargeJour))
  const personnesTriees = $derived(
    [...inscriptions.personnes].sort((a, b) => libellePersonne(a).localeCompare(libellePersonne(b), 'fr')),
  )
</script>

<div class="toolbar" style="margin-bottom:12px">
  <label style="margin:0;display:flex;align-items:center;gap:8px;font-family:var(--sans);text-transform:none;font-weight:400;font-size:13.5px;letter-spacing:0">
    <span>Seuil charge / jour</span>
    <input
      type="number"
      min="1"
      max="12"
      value={seuilChargeJour}
      oninput={(e) => onSeuilChange(Number((e.currentTarget as HTMLInputElement).value))}
      style="width:70px"
    />
  </label>
  <span class="grow"></span>
  {#if surcharges.length > 0}
    <span class="badge">⚠ {surcharges.length} musicien(s) au-delà du seuil</span>
  {/if}
</div>
<table>
  <thead>
    <tr>
      <th>Musicien</th>
      <th style="width:70px">Total</th>
      <th style="width:100px">Max/jour</th>
      <th>Planning chronologique</th>
    </tr>
  </thead>
  <tbody>
    {#each personnesTriees as p}
      {@const items = parPersonne.get(p.id) ?? []}
      {@const ch = chargeMap.get(p.id)}
      {#if items.length > 0 || (ch && ch.total > 0)}
        {@const surcharge = ch && ch.max_jour > seuilChargeJour}
        <tr class:surcharge>
          <td><b>{libellePersonne(p)}</b></td>
          <td class="mono">{ch?.total ?? items.length}</td>
          <td class="mono">
            {ch?.max_jour ?? 0}
            {#if surcharge}<span class="rouge"> ⚠</span>{/if}
          </td>
          <td>
            {#each items as { a, c }}
              {@const g = groupesParId.get(a.groupe_id)}
              <span class="chip">
                {c.date.slice(5).replace('-', '/')} · {c.debut}
                <em>{g?.titre ?? a.groupe_id}</em>
                <em>{sallesParId.get(a.salle_id)?.nom ?? a.salle_id}</em>
              </span>
            {/each}
          </td>
        </tr>
      {/if}
    {/each}
  </tbody>
</table>
