<script lang="ts">
  import type { Creneau } from '../domain/grille'
  import { finInclusive } from '../domain/grille'
  import type { Groupe, Inscriptions, Lieu, Personne, Salle } from '../domain/model'
  import { libellePersonne } from '../domain/model'
  import { imposesOccupantCreneau } from '../engine/imposes'
  import type { Assignation } from '../engine/types'

  interface Props {
    lieu: Lieu
    inscriptions: Inscriptions
    creneaux: Creneau[]
    assignations: Assignation[]
    groupesParId: Map<string, Groupe>
    personnesParId: Map<string, Personne>
    estFigee: (a: Assignation) => boolean
    toggleFigee: (a: Assignation) => void
    deplacementEnCours: Assignation | null
    demarrerDeplacement: (a: Assignation) => void
    estCibleValide: (creneauId: string, salleId: string) => boolean
    appliquerDeplacement: (creneauId: string, salleId: string) => void
    keyFigee: (a: Assignation) => string
  }
  let {
    lieu,
    inscriptions,
    creneaux,
    assignations,
    groupesParId,
    personnesParId,
    estFigee,
    toggleFigee,
    deplacementEnCours,
    demarrerDeplacement,
    estCibleValide,
    appliquerDeplacement,
    keyFigee,
  }: Props = $props()

  const sallesActives = $derived(lieu.salles.filter((s) => s.actif))
</script>

<table>
  <thead>
    <tr>
      <th>Salle</th>
      <th>Créneau</th>
      <th>Groupe</th>
      <th>Responsable</th>
      <th style="width:40px"></th>
    </tr>
  </thead>
  <tbody>
    {#each sallesActives as salle}
      {#each creneaux
        .filter((c) => c.salles.includes(salle.id))
        .sort((a, b) => `${a.date}T${a.debut}`.localeCompare(`${b.date}T${b.debut}`)) as c}
        {@const ass = assignations.find((a) => a.creneau_id === c.id && a.salle_id === salle.id)}
        {@const g = ass ? groupesParId.get(ass.groupe_id) : undefined}
        {@const resp = g ? personnesParId.get(g.responsable_id) : undefined}
        {@const impose = imposesOccupantCreneau(inscriptions, c, lieu.salles).get(salle.id)}
        <tr
          class:libre={!ass && !impose}
          class:figee={ass && estFigee(ass)}
          class:impose={!ass && impose}
          class:cible={deplacementEnCours && estCibleValide(c.id, salle.id)}
        >
          <td>{salle.nom}</td>
          <td class="mono">{c.date.slice(5).replace('-', '/')} · {c.debut}–{finInclusive(c.fin)}</td>
          <td>
            {#if g}
              {g.titre}{#if impose}
                <span class="conflit-impose" title="Conflit : « {impose.morceau} » (séance imposée) réserve aussi cette salle">⚠</span>
              {/if}
            {:else if impose}
              {impose.morceau} <span class="mention-impose">(séance imposée)</span>
            {:else}
              —
            {/if}
          </td>
          <td>{resp ? libellePersonne(resp) : g?.responsable_id ?? ''}</td>
          <td class="center">
            {#if ass}
              <button
                class="lock"
                class:on={estFigee(ass)}
                onclick={() => toggleFigee(ass)}
                title={estFigee(ass) ? 'Dégeler' : 'Figer cette répétition'}
                aria-label={estFigee(ass) ? 'Dégeler' : 'Figer'}
              ></button>
              <button
                class="move"
                class:on={deplacementEnCours && keyFigee(deplacementEnCours) === keyFigee(ass)}
                onclick={() => demarrerDeplacement(ass)}
                title="Déplacer cette répétition"
                aria-label="Déplacer"
              ></button>
            {:else if deplacementEnCours && estCibleValide(c.id, salle.id)}
              <button
                class="drop-target"
                onclick={() => appliquerDeplacement(c.id, salle.id)}
                title="Déplacer ici"
              >poser ici</button>
            {/if}
          </td>
        </tr>
      {/each}
    {/each}
  </tbody>
</table>
