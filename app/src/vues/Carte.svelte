<script lang="ts">
  import type { Creneau } from '../domain/grille'
  import type { Groupe, Inscriptions, Lieu, Salle, Session } from '../domain/model'
  import { ciblesValides } from '../engine/manuel'
  import type { Assignation } from '../engine/types'

  interface Props {
    session: Session
    lieu: Lieu
    inscriptions: Inscriptions
    creneaux: Creneau[]
    assignations: Assignation[]
    groupesParId: Map<string, Groupe>
    sallesParId: Map<string, Salle>
    creneauxParId: Map<string, Creneau>
    estFigee: (a: Assignation) => boolean
    inspecteCase: { creneauId: string; salleId: string } | null
    onInspect: (v: { creneauId: string; salleId: string } | null) => void
  }
  let {
    session,
    lieu,
    inscriptions,
    creneaux,
    assignations,
    groupesParId,
    sallesParId,
    creneauxParId,
    estFigee,
    inspecteCase,
    onInspect,
  }: Props = $props()

  const sallesAffichees = $derived(lieu.salles.filter((s) => s.actif))
  const creneauxTries = $derived(
    [...creneaux].sort((a, b) => `${a.date}T${a.debut}`.localeCompare(`${b.date}T${b.debut}`)),
  )
  const candidatsCase = $derived.by(() => {
    if (!inspecteCase) return []
    const c = creneauxParId.get(inspecteCase.creneauId)
    if (!c) return []
    const autres = assignations.filter(
      (a) => !(a.creneau_id === inspecteCase!.creneauId && a.salle_id === inspecteCase!.salleId),
    )
    const out: Array<{ groupe_id: string; titre: string }> = []
    for (const g of inscriptions.groupes) {
      const fictif: Assignation = { groupe_id: g.id, creneau_id: '__none__', salle_id: '__none__' }
      const cibles = ciblesValides(fictif, g, lieu, inscriptions, creneaux, autres, {
        date: session.date_butoir,
        heure: session.butoir_heure,
      })
      if (
        cibles.some(
          (x) => x.creneau.id === inspecteCase!.creneauId && x.salle_id === inspecteCase!.salleId,
        )
      )
        out.push({ groupe_id: g.id, titre: g.titre })
    }
    return out
  })
</script>

<table class="carte">
  <thead>
    <tr>
      <th style="width:150px">Créneau</th>
      {#each sallesAffichees as s}
        <th class="mono" style="text-align:center;font-size:11px">{s.nom}</th>
      {/each}
      <th style="width:60px">Occ.</th>
    </tr>
  </thead>
  <tbody>
    {#each creneauxTries as c}
      {@const assCr = assignations.filter((a) => a.creneau_id === c.id)}
      {@const parSalle = new Map(assCr.map((a) => [a.salle_id, a]))}
      {@const salleOuverte = new Set(c.salles)}
      {@const nbOuvertes = sallesAffichees.filter((s) => salleOuverte.has(s.id)).length}
      {@const nbOccupees = assCr.length}
      <tr>
        <td class="mono">{c.date.slice(5).replace('-', '/')} · {c.debut}–{c.fin}</td>
        {#each sallesAffichees as s}
          {@const ass = parSalle.get(s.id)}
          {@const ouvert = salleOuverte.has(s.id)}
          {#if !ouvert}
            <td class="fermee">—</td>
          {:else if ass}
            {@const g = groupesParId.get(ass.groupe_id)}
            <td class="occ" class:figee={estFigee(ass)}>{g?.titre ?? ass.groupe_id}</td>
          {:else}
            <td
              class="libre-cell"
              class:inspecte={inspecteCase &&
                inspecteCase.creneauId === c.id &&
                inspecteCase.salleId === s.id}
              onclick={() =>
                onInspect(
                  inspecteCase && inspecteCase.creneauId === c.id && inspecteCase.salleId === s.id
                    ? null
                    : { creneauId: c.id, salleId: s.id },
                )}
              role="button"
              tabindex="0"
            >libre</td>
          {/if}
        {/each}
        <td class="mono taux" class:hot={nbOccupees === nbOuvertes && nbOuvertes > 0}>
          {nbOccupees}/{nbOuvertes}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
{#if inspecteCase}
  {@const c = creneauxParId.get(inspecteCase.creneauId)}
  {@const s = sallesParId.get(inspecteCase.salleId)}
  <div class="candidats">
    <b>{s?.nom} · {c?.date.slice(5).replace('-', '/')} · {c?.debut}–{c?.fin}</b>
    <span class="ink-soft mono"> — {candidatsCase.length} groupe(s) compatible(s)</span>
    {#if candidatsCase.length > 0}
      <div class="chips" style="margin-top:8px">
        {#each candidatsCase as gc}
          <span class="chip">{gc.titre}</span>
        {/each}
      </div>
    {:else}
      <p class="hint" style="margin-top:6px">
        Aucun groupe ne peut occuper cette case (tous ont un membre déjà pris,
        indisponible, ou la salle est restreinte).
      </p>
    {/if}
  </div>
{/if}
