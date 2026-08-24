<script lang="ts">
  import { genererCreneaux } from './domain/grille'
  import { parseLegacyInscriptions } from './domain/legacy'
  import { migrerInscriptions } from './domain/migrate'
  import { Lieu, Session, libellePersonne } from './domain/model'
  import { attribuerSalles } from './engine/allocate-rooms'
  import { repartir } from './engine/solver'
  import type { Assignation, Probleme } from './engine/types'
  import { couverture, verifier } from './engine/verify'
  import { csvParGroupe, csvParMusicien, csvParSalle, telechargerCsv } from './io/csv'
  import fixture from './fixtures/apero_mercredi.json'

  const lieu = Lieu.parse({
    id: 'musiques-festives',
    nom: 'Musiques Festives — Domaine de Meilhac',
    salles: [
      { id: 'le-garage', nom: 'Le Garage', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'xveme', nom: 'XVème', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'les-clapiers', nom: 'Les Clapiers', jauge: 10, equipement: ['batterie', 'piano'] },
      { id: 'l-esperance', nom: "L'Espérance", jauge: 6, equipement: ['piano'] },
      { id: 'la-chenaie', nom: 'La Chênaie', jauge: 6, equipement: ['piano'] },
    ],
  })
  const session = Session.parse({
    id: 'session-5',
    nom: 'Session 5 — Musiques Festives',
    lieu_id: 'musiques-festives',
    date_debut: '2026-08-24',
    date_fin: '2026-08-28',
    date_butoir: '2026-08-26',
    butoir_heure: '18:30',
    grille: [
      { debut: '09:00', fin: '12:00', pas_minutes: 60 },
      { debut: '13:30', fin: '18:30', pas_minutes: 60 },
      { debut: '22:00', fin: '24:00', pas_minutes: 60 },
    ],
    repetitions_visees: 3,
  })
  const inscriptions = migrerInscriptions(parseLegacyInscriptions(fixture), session.id)
  const creneaux = genererCreneaux(session, lieu)

  type Solution = {
    assignations: Assignation[]
    problemes: Probleme[]
    couverture: Array<{ groupe_id: string; obtenu: number; cible: number; min: number }>
    duree_ms: number
  }

  let solution = $state<Solution | null>(null)
  let calculEnCours = $state(false)
  let vue = $state<'groupes' | 'salles' | 'musiciens'>('groupes')

  const groupesParId = new Map(inscriptions.groupes.map((g) => [g.id, g]))
  const personnesParId = new Map(inscriptions.personnes.map((p) => [p.id, p]))
  const creneauxParId = new Map(creneaux.map((c) => [c.id, c]))
  const sallesParId = new Map(lieu.salles.map((s) => [s.id, s]))

  async function lancer() {
    calculEnCours = true
    await new Promise((r) => setTimeout(r, 20))
    const t0 = performance.now()
    const { placement } = repartir(session, lieu, inscriptions, creneaux, { seed: 42 })
    const assignations = attribuerSalles(placement, lieu, inscriptions, creneaux)
    const problemes = verifier(session, lieu, inscriptions, creneaux, assignations)
    const cov = couverture(session, inscriptions, assignations)
    solution = { assignations, problemes, couverture: cov, duree_ms: Math.round(performance.now() - t0) }
    calculEnCours = false
  }

  function exporterGroupes() {
    if (!solution) return
    telechargerCsv(
      'balance_par_groupe.csv',
      csvParGroupe(session, lieu, inscriptions, creneaux, solution.assignations),
    )
  }
  function exporterSalles() {
    if (!solution) return
    telechargerCsv(
      'balance_par_salle.csv',
      csvParSalle(lieu, inscriptions, creneaux, solution.assignations),
    )
  }
  function exporterMusiciens() {
    if (!solution) return
    telechargerCsv(
      'balance_par_musicien.csv',
      csvParMusicien(lieu, inscriptions, creneaux, solution.assignations),
    )
  }
</script>

<main>
  <header>
    <p class="eyebrow">Balance · V1</p>
    <h1>Qui répète <em>où</em>, et <em>quand</em></h1>
    <p class="hint">
      Chargement du jeu réel <code>apero_mercredi.json</code> — 13 groupes, {inscriptions.personnes.length}
      musiciens, {creneaux.length} créneaux sur {lieu.salles.length} salles avant butoir du {session.date_butoir}.
    </p>
  </header>

  <section class="sheet">
    <p class="eyebrow">Étape 1 · Placement</p>
    <h2>Répartition</h2>
    <p class="hint">
      Le solveur cherche à placer chaque groupe {session.repetitions_visees} fois avant l'échéance,
      sans jamais convoquer deux fois la même personne au même moment ni doubler une salle.
    </p>
    <button class="big" onclick={lancer} disabled={calculEnCours}>
      {calculEnCours ? 'Recherche en cours…' : (solution ? 'Relancer la répartition' : 'Lancer la répartition')}
    </button>
    {#if solution}
      <div class="stats">
        <div>
          <b>{solution.couverture.filter((c) => c.obtenu >= c.cible).length}/{inscriptions.groupes.length}</b>
          groupes complets
        </div>
        <div><b>{solution.assignations.length}</b> répétitions posées</div>
        <div><b>{solution.duree_ms} ms</b> de calcul</div>
        <div><b>{solution.problemes.length}</b> problème(s) détecté(s)</div>
      </div>
      {#if solution.problemes.length > 0}
        <div class="msg err">
          <b>Contrôle indépendant :</b>
          <ul>
            {#each solution.problemes.slice(0, 8) as pb}
              <li>{pb.message}</li>
            {/each}
            {#if solution.problemes.length > 8}
              <li>… et {solution.problemes.length - 8} autres</li>
            {/if}
          </ul>
        </div>
      {:else}
        <div class="msg ok">Aucun conflit détecté par la vérification indépendante.</div>
      {/if}
    {/if}
  </section>

  {#if solution}
    <section class="sheet">
      <p class="eyebrow">Étape 2 · Résultats</p>
      <h2>États imprimables</h2>
      <div class="toolbar">
        <button class:actif={vue === 'groupes'} onclick={() => (vue = 'groupes')}>Par groupe</button>
        <button class:actif={vue === 'salles'} onclick={() => (vue = 'salles')}>Par salle</button>
        <button class:actif={vue === 'musiciens'} onclick={() => (vue = 'musiciens')}>Par musicien</button>
        <span class="grow"></span>
        <button class="ghost" onclick={exporterGroupes}>CSV groupes</button>
        <button class="ghost" onclick={exporterSalles}>CSV salles</button>
        <button class="ghost" onclick={exporterMusiciens}>CSV musiciens</button>
      </div>

      {#if vue === 'groupes'}
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
              {@const cs = solution.assignations
                .filter((a) => a.groupe_id === g.id)
                .map((a) => ({ a, c: creneauxParId.get(a.creneau_id) }))
                .filter((x) => x.c != null)
                .sort((x, y) => `${x.c!.date}T${x.c!.debut}`.localeCompare(`${y.c!.date}T${y.c!.debut}`))}
              <tr>
                <td><b>{g.titre}</b></td>
                <td>{g.responsable_id}</td>
                <td>
                  {#each cs as { a, c }}
                    <span class="chip">
                      {c!.date.slice(5).replace('-', '/')} · {c!.debut}
                      <em>{sallesParId.get(a.salle_id)?.nom ?? a.salle_id}</em>
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
      {:else if vue === 'salles'}
        <table>
          <thead>
            <tr>
              <th>Salle</th>
              <th>Créneau</th>
              <th>Groupe</th>
              <th>Responsable</th>
            </tr>
          </thead>
          <tbody>
            {#each lieu.salles.filter((s) => s.actif) as salle}
              {#each creneaux
                .filter((c) => c.salles.includes(salle.id))
                .sort((a, b) => `${a.date}T${a.debut}`.localeCompare(`${b.date}T${b.debut}`)) as c}
                {@const ass = solution.assignations.find((a) => a.creneau_id === c.id && a.salle_id === salle.id)}
                {@const g = ass ? groupesParId.get(ass.groupe_id) : undefined}
                {@const resp = g ? personnesParId.get(g.responsable_id) : undefined}
                <tr class:libre={!ass}>
                  <td>{salle.nom}</td>
                  <td class="mono">{c.date.slice(5).replace('-', '/')} · {c.debut}–{c.fin}</td>
                  <td>{g ? g.titre : '—'}</td>
                  <td>{resp ? libellePersonne(resp) : g?.responsable_id ?? ''}</td>
                </tr>
              {/each}
            {/each}
          </tbody>
        </table>
      {:else}
        {@const parPersonne = (() => {
          const m = new Map<string, Array<{ a: Assignation; c: (typeof creneaux)[number] }>>()
          for (const a of solution.assignations) {
            const c = creneauxParId.get(a.creneau_id)
            const g = groupesParId.get(a.groupe_id)
            if (!c || !g) continue
            const membres = new Set(g.membres.map((m) => m.personne_id))
            for (const pid of membres) {
              if (!m.has(pid)) m.set(pid, [])
              m.get(pid)!.push({ a, c })
            }
          }
          for (const l of m.values()) l.sort((x, y) => `${x.c.date}T${x.c.debut}`.localeCompare(`${y.c.date}T${y.c.debut}`))
          return m
        })()}
        <table>
          <thead>
            <tr>
              <th>Musicien</th>
              <th>Nb</th>
              <th>Planning chronologique</th>
            </tr>
          </thead>
          <tbody>
            {#each [...inscriptions.personnes].sort((a, b) => libellePersonne(a).localeCompare(libellePersonne(b), 'fr')) as p}
              {@const items = parPersonne.get(p.id) ?? []}
              {#if items.length > 0}
                <tr>
                  <td><b>{libellePersonne(p)}</b></td>
                  <td class="mono">{items.length}</td>
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
      {/if}
    </section>
  {/if}
</main>

<style>
  main {
    max-width: 1180px;
    margin: 0 auto;
    padding: 36px 20px 80px;
  }
  h1 {
    font-family: var(--serif);
    font-size: clamp(34px, 5vw, 54px);
    line-height: 1.02;
    margin: 0 0 8px;
    font-weight: 400;
    letter-spacing: -0.01em;
    color: var(--paper);
  }
  h1 em {
    font-style: italic;
    color: var(--ochre);
  }
  h2 {
    font-family: var(--serif);
    font-weight: 400;
    font-size: 27px;
    margin: 0 0 4px;
  }
  .hint {
    color: rgba(250, 249, 244, 0.7);
    max-width: 68ch;
    margin: 0 0 20px;
  }
  .eyebrow {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--ochre);
    margin: 0 0 6px;
    font-weight: 600;
  }
  .sheet {
    background: var(--paper);
    color: var(--ink);
    border-radius: 2px;
    padding: 26px 28px 30px;
    margin: 0 0 30px;
    box-shadow: 0 14px 34px rgba(0, 0, 0, 0.34);
  }
  .sheet .hint {
    color: var(--ink-soft);
  }
  button {
    font-family: var(--sans);
    font-weight: 600;
    font-size: 14px;
    padding: 10px 20px;
    border-radius: 2px;
    cursor: pointer;
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--paper);
    transition: transform 0.08s, background 0.15s;
  }
  button:hover:not(:disabled) { background: #000; }
  button:disabled { opacity: 0.5; cursor: wait; }
  button.big {
    font-size: 16px;
    padding: 15px 34px;
    background: var(--ochre);
    border-color: var(--ochre);
    color: #231703;
  }
  button.big:hover:not(:disabled) { background: #b0741a; }
  button.ghost { background: transparent; color: var(--ink); }
  button.ghost:hover { background: #efede4; }
  button.actif { background: var(--ochre); border-color: var(--ochre); color: #231703; }
  .stats {
    display: flex;
    flex-wrap: wrap;
    gap: 26px;
    margin-top: 20px;
    font-family: var(--mono);
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.09em;
    color: var(--ink-soft);
  }
  .stats b {
    display: block;
    font-family: var(--serif);
    font-size: 27px;
    letter-spacing: 0;
    color: var(--ink);
    text-transform: none;
    font-weight: 400;
  }
  .msg {
    padding: 12px 15px;
    border-left: 3px solid;
    margin: 14px 0 0;
    font-size: 14px;
    border-radius: 0 2px 2px 0;
  }
  .msg.ok { background: #e8f1ea; border-color: var(--vert); }
  .msg.err { background: #f8e6e3; border-color: var(--rouge); }
  .msg ul { margin: 6px 0 0 16px; }
  .toolbar {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
    margin: 20px 0 16px;
  }
  .grow { flex: 1; }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 13.5px;
    margin-top: 10px;
  }
  th {
    text-align: left;
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--ink-soft);
    font-weight: 600;
    padding: 8px 9px;
    border-bottom: 1.5px solid var(--ink);
  }
  td {
    padding: 9px;
    border-bottom: 1px solid var(--paper-edge);
    vertical-align: top;
  }
  tr.libre td { color: var(--ink-soft); }
  .chip {
    display: inline-block;
    background: #edf3f6;
    border: 1px solid #c9dce5;
    border-left: 3px solid var(--craie);
    padding: 3px 8px;
    margin: 2px 4px 2px 0;
    border-radius: 0 2px 2px 0;
    font-size: 12.5px;
    line-height: 1.4;
  }
  .chip em {
    font-style: normal;
    color: var(--ink-soft);
    font-family: var(--mono);
    font-size: 11px;
    margin-left: 6px;
  }
  .rouge { color: var(--rouge); font-style: italic; }
  .mono { font-family: var(--mono); font-size: 12px; }
</style>
