<script lang="ts">
  import type { Creneau } from '../domain/grille'
  import type { Groupe, Inscriptions, Salle } from '../domain/model'
  import { formatPostesCherches, libellePersonne } from '../domain/model'
  import { suggererRenforts } from '../engine/renforts'
  import type { Assignation } from '../engine/types'

  interface Props {
    inscriptions: Inscriptions
    creneaux: Creneau[]
    assignations: Assignation[]
    sallesParId: Map<string, Salle>
    creneauxParId: Map<string, Creneau>
    estFigee: (a: Assignation) => boolean
    toggleFigee: (a: Assignation) => void
    demarrerDeplacement: (a: Assignation) => void
    deplacementEnCours: Assignation | null
    keyFigee: (a: Assignation) => string
    onAffecterRenfort: (groupe_id: string, personne_id: string, pupitre: string) => void
  }
  let {
    inscriptions,
    creneaux,
    assignations,
    sallesParId,
    creneauxParId,
    estFigee,
    toggleFigee,
    demarrerDeplacement,
    deplacementEnCours,
    keyFigee,
    onAffecterRenfort,
  }: Props = $props()

  // Garde-fou sujet C (Stéphane 2026-09-02, rappelé 2026-09-03) : la clé
  // normalisée sert au rapprochement, jamais à l'affichage. On construit un
  // index pour retrouver la personne et lui demander son libellé (« Fanny (A) »
  // au lieu de `fanny-a` dans la colonne Resp. de la feuille de route).
  const personnesParId = $derived(
    new Map(inscriptions.personnes.map((p) => [p.id, p])),
  )
</script>

<table>
  <thead>
    <tr>
      <th>Groupe</th>
      <th>Resp.</th>
      <th>Répétitions</th>
    </tr>
  </thead>
  <tbody>
    {#each inscriptions.groupes as g}
      {@const cs = assignations
        .filter((a) => a.groupe_id === g.id)
        .map((a) => ({ a, c: creneauxParId.get(a.creneau_id) }))
        .filter((x) => x.c != null)
        .sort((x, y) => `${x.c!.date}T${x.c!.debut}`.localeCompare(`${y.c!.date}T${y.c!.debut}`))}
      {@const resp = personnesParId.get(g.responsable_id)}
      <tr>
        <td><b>{g.titre}</b></td>
        <td>{resp ? libellePersonne(resp) : g.responsable_id}</td>
        <td>
          {#if g.postes_cherches.length > 0}
            {@const suggestions = suggererRenforts(g, inscriptions, creneaux, assignations)}
            <details class="renforts">
              <summary>
                <span class="badge">cherche {formatPostesCherches(g.postes_cherches)}</span>
                <span class="mono ink-soft">{suggestions.length} candidat(s)</span>
              </summary>
              {#if suggestions.length > 0}
                <div class="chips" style="margin-top:6px">
                  {#each suggestions.slice(0, 15) as s}
                    <span
                      class="chip"
                      class:libre={s.nb_engagements === 0}
                      title="{s.creneaux_compatibles}/{s.creneaux_du_groupe} créneaux compatibles · {s.nb_engagements} engagement(s) existant(s)"
                    >
                      <b>{s.nom}</b>
                      {#if s.nb_engagements === 0}
                        <em class="tag-libre">libre</em>
                      {:else}
                        <em>{s.nb_engagements} groupe(s)</em>
                      {/if}
                      <em>{s.creneaux_compatibles}/{s.creneaux_du_groupe}</em>
                      {#each s.pupitres_dispo as pup}
                        <button
                          class="ghost mini-ajout"
                          onclick={() => onAffecterRenfort(g.id, s.personne_id, pup)}
                          title="Affecter {s.nom} à ce groupe au pupitre {pup}"
                        >+ {pup}</button>
                      {/each}
                    </span>
                  {/each}
                </div>
              {:else}
                <p class="hint" style="margin:6px 0 0;font-size:12px">
                  Personne d'autre ne joue les pupitres cherchés et n'est libre sur ces créneaux.
                </p>
              {/if}
            </details>
          {/if}
          {#each cs as { a, c }}
            <span class="chip" class:figee={estFigee(a)}>
              {c!.date.slice(5).replace('-', '/')} · {c!.debut}
              <em>{sallesParId.get(a.salle_id)?.nom ?? a.salle_id}</em>
              <button
                class="lock"
                class:on={estFigee(a)}
                onclick={() => toggleFigee(a)}
                title={estFigee(a) ? 'Dégeler' : 'Figer cette répétition'}
                aria-label={estFigee(a) ? 'Dégeler' : 'Figer'}
              ></button>
              <button
                class="move"
                class:on={deplacementEnCours && keyFigee(deplacementEnCours) === keyFigee(a)}
                onclick={() => demarrerDeplacement(a)}
                title="Déplacer cette répétition"
                aria-label="Déplacer"
              ></button>
            </span>
          {/each}
          {#if cs.length === 0}
            <span class="rouge">— non placé —</span>
          {/if}
        </td>
      </tr>
    {/each}
  </tbody>
</table>
