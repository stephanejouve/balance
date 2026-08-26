<script lang="ts">
  import type { Creneau } from '../domain/grille'
  import type { Groupe, Inscriptions, Lieu, Personne, Salle } from '../domain/model'
  import { libellePersonne } from '../domain/model'
  import type { Assignation } from '../engine/types'

  interface Props {
    lieu: Lieu
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
        <tr
          class:libre={!ass}
          class:figee={ass && estFigee(ass)}
          class:cible={deplacementEnCours && estCibleValide(c.id, salle.id)}
        >
          <td>{salle.nom}</td>
          <td class="mono">{c.date.slice(5).replace('-', '/')} · {c.debut}–{c.fin}</td>
          <td>{g ? g.titre : '—'}</td>
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
