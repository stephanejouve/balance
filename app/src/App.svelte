<script lang="ts">
  import { genererCreneaux } from './domain/grille'
  import { parseLegacyInscriptions } from './domain/legacy'
  import { migrerInscriptions } from './domain/migrate'
  import type { Inscriptions } from './domain/model'
  import { Lieu, Session, libellePersonne } from './domain/model'
  import { attribuerSalles } from './engine/allocate-rooms'
  import type { IdContrainte } from './engine/contraintes'
  import { REGISTRE_TOUT, registrePersonnalise } from './engine/contraintes'
  import { analyserInfaisabilite, diagnostiquer } from './engine/diagnostic'
  import { enrichirIndispos } from './engine/imposes'
  import { ciblesValides } from './engine/manuel'
  import { repartir } from './engine/solver'
  import type { Assignation, Probleme } from './engine/types'
  import { couverture, verifier } from './engine/verify'
  import { csvParGroupe, csvParMusicien, csvParSalle, telechargerCsv } from './io/csv'
  import { exporterClasseurExcel } from './io/excel-export'
  import { importerListeExcel } from './io/excel-io'
  import type { MappingListe } from './io/liste-adapter'
  import fixture from './fixtures/apero_mercredi.json'

  /* --- Données de démarrage --------------------------------------------- */

  const lieu = $state(
    Lieu.parse({
      id: 'musiques-festives',
      nom: 'Musiques Festives — Domaine de Meilhac',
      salles: [
        { id: 'le-garage', nom: 'Le Garage', jauge: 10, equipement: ['batterie', 'piano'] },
        { id: 'xveme', nom: 'XVème', jauge: 10, equipement: ['batterie', 'piano'] },
        { id: 'les-clapiers', nom: 'Les Clapiers', jauge: 10, equipement: ['batterie', 'piano'] },
        { id: 'l-esperance', nom: "L'Espérance", jauge: 6, equipement: ['piano'] },
        { id: 'la-chenaie', nom: 'La Chênaie', jauge: 6, equipement: ['piano'] },
      ],
    }),
  )
  const session = $state(
    Session.parse({
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
    }),
  )

  const MAPPING_DEFAUT: MappingListe = {
    colonneMorceau: 'Morceau',
    colonneAuteur: 'Auteur',
    colonneStyle: 'Style',
    colonneTona: 'Tona',
    colonneResp: 'Resp',
    colonneCherche: 'Cherche',
    colonnesPupitres: {
      chant: 'Chant',
      piano: 'Piano',
      basse: 'Basse',
      batterie: 'Batterie',
      guitare: 'Guitare',
      vents: 'Vents',
    },
  }

  function chargerDemo(): Inscriptions {
    return migrerInscriptions(parseLegacyInscriptions(fixture), session.id)
  }

  /* --- État réactif ----------------------------------------------------- */

  let inscriptions = $state<Inscriptions>(chargerDemo())
  let sourceLabel = $state<string>('démo · apero_mercredi.json')
  let warningsImport = $state<string[]>([])
  let erreurImport = $state<string>('')

  type Solution = {
    assignations: Assignation[]
    problemes: Probleme[]
    couverture: Array<{ groupe_id: string; obtenu: number; cible: number; min: number }>
    diagnostics: ReturnType<typeof diagnostiquer>
    duree_ms: number
  }
  let solution = $state<Solution | null>(null)
  let calculEnCours = $state(false)
  let vue = $state<'groupes' | 'salles' | 'musiciens' | 'carte'>('groupes')
  /** Case libre survolée dans la carte : affiche les groupes candidats. */
  let inspecteCase = $state<{ creneauId: string; salleId: string } | null>(null)
  /** Clés `groupe_id|creneau_id` des assignations à préserver lors des recalculs. */
  let figeesKeys = $state(new Set<string>())
  /** Assignation en cours de déplacement (bascule la vue Par salle en mode cibles). */
  let deplacementEnCours = $state<Assignation | null>(null)
  let contraintesActives = $state<Record<IdContrainte, boolean>>({
    'personne-unique-moment': true,
    'salle-unique-groupe': true,
    'jauge-salle': true,
    'personne-indispo': true,
    'avant-butoir': true,
    'salle-hors-creneau': true,
    'restriction-horaire-salle': true,
    'creneaux-consecutifs': true,
  })

  const LIBELLE_CONTRAINTE: Record<IdContrainte, string> = {
    'personne-unique-moment': 'Une personne à un seul endroit à la fois',
    'salle-unique-groupe': 'Une salle à un seul groupe à la fois',
    'jauge-salle': 'Effectif ≤ jauge de la salle',
    'personne-indispo': 'Respect des indisponibilités déclarées',
    'avant-butoir': 'Répétitions avant la date butoir',
    'salle-hors-creneau': 'Salle attribuée ouverte au créneau',
    'restriction-horaire-salle': 'Restrictions horaires par salle (dortoirs, autres usages)',
    'creneaux-consecutifs': 'Pas deux répétitions accolées pour un même groupe',
  }

  const creneaux = $derived.by(() => {
    try {
      return genererCreneaux(session, lieu)
    } catch {
      return []
    }
  })
  const infaisabilites = $derived.by(() => {
    try {
      return analyserInfaisabilite(session, inscriptions, creneaux)
    } catch {
      return []
    }
  })
  const groupesParId = $derived(new Map(inscriptions.groupes.map((g) => [g.id, g])))
  const personnesParId = $derived(new Map(inscriptions.personnes.map((p) => [p.id, p])))
  const creneauxParId = $derived(new Map(creneaux.map((c) => [c.id, c])))
  const sallesParId = $derived(new Map(lieu.salles.map((s) => [s.id, s])))

  /* --- Actions ---------------------------------------------------------- */

  function utiliserDemo() {
    inscriptions = chargerDemo()
    sourceLabel = 'démo · apero_mercredi.json'
    warningsImport = []
    erreurImport = ''
    solution = null
  }

  async function importerFichier(e: Event) {
    const cible = e.target as HTMLInputElement
    const file = cible.files?.[0]
    if (!file) return
    warningsImport = []
    erreurImport = ''
    try {
      const { groupes, warnings } = await importerListeExcel(file, 'Liste', MAPPING_DEFAUT)
      inscriptions = migrerInscriptions(
        { groupes, membresImposes: {}, indispos: [], identitesConnues: [] },
        session.id,
      )
      sourceLabel = `Excel · ${file.name}`
      warningsImport = warnings
      solution = null
    } catch (err) {
      erreurImport = err instanceof Error ? err.message : String(err)
    } finally {
      cible.value = ''
    }
  }

  async function lancer() {
    calculEnCours = true
    await new Promise((r) => setTimeout(r, 20))
    const t0 = performance.now()
    const ids = (Object.entries(contraintesActives) as [IdContrainte, boolean][])
      .filter(([, v]) => v)
      .map(([k]) => k)
    const registre = registrePersonnalise(ids)
    // Récupère les assignations figées depuis la solution précédente
    const figees = (solution?.assignations ?? []).filter((a) => figeesKeys.has(`${a.groupe_id}|${a.creneau_id}`))
    // Enrichit les indispos des personnes avec les séances des imposés,
    // pour que le solveur les évite automatiquement.
    const inscEnrichies = enrichirIndispos(inscriptions)
    const { placement } = repartir(session, lieu, inscEnrichies, creneaux, {
      seed: 42,
      registre,
      figees,
    })
    const assignations = attribuerSalles(placement, lieu, inscEnrichies, creneaux, { figees })
    const problemes = verifier(session, lieu, inscEnrichies, creneaux, assignations, registre)
    const cov = couverture(session, inscEnrichies, assignations)
    const diagnostics = diagnostiquer(session, inscriptions, creneaux, placement)
    solution = {
      assignations,
      problemes,
      couverture: cov,
      diagnostics,
      duree_ms: Math.round(performance.now() - t0),
    }
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
  async function exporterXlsx() {
    if (!solution) return
    await exporterClasseurExcel(
      'balance.xlsx',
      session,
      lieu,
      inscriptions,
      creneaux,
      solution.assignations,
    )
  }

  /* --- Export / Import JSON (sauvegarde de l'état complet) --------------- */

  function exporterEtat() {
    const etat = {
      version: 1,
      lieu,
      session,
      inscriptions,
      contraintesActives,
    }
    const blob = new Blob([JSON.stringify(etat, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `balance-${session.id}-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function importerEtat(e: Event) {
    const cible = e.target as HTMLInputElement
    const file = cible.files?.[0]
    if (!file) return
    erreurImport = ''
    warningsImport = []
    try {
      const texte = await file.text()
      const brut = JSON.parse(texte) as Record<string, unknown>
      let quelqueChoseLu = false

      // Format canonique : { lieu, session, inscriptions, contraintesActives }
      if (brut.lieu) {
        const parsed = Lieu.parse(brut.lieu)
        Object.assign(lieu, parsed)
        lieu.salles.splice(0, lieu.salles.length, ...parsed.salles)
        quelqueChoseLu = true
      }
      if (brut.session) {
        const parsed = Session.parse(brut.session)
        Object.assign(session, parsed)
        session.grille.splice(0, session.grille.length, ...parsed.grille)
        quelqueChoseLu = true
      }
      if (brut.inscriptions) {
        inscriptions = brut.inscriptions as Inscriptions
        quelqueChoseLu = true
      }
      if (brut.contraintesActives) {
        contraintesActives = { ...contraintesActives, ...(brut.contraintesActives as Record<IdContrainte, boolean>) }
        quelqueChoseLu = true
      }

      // Fallback : format legacy prototype à la racine (groupes / membresImposes / indispos / identitesConnues)
      // — comme `apero_mercredi.json`.
      if (!quelqueChoseLu && Array.isArray(brut.groupes)) {
        const legacy = parseLegacyInscriptions(brut)
        inscriptions = migrerInscriptions(legacy, session.id)
        warningsImport.push(
          `Format legacy détecté (${legacy.groupes.length} groupes) — migré vers le modèle canonique.`,
        )
        quelqueChoseLu = true
      }

      if (!quelqueChoseLu) {
        erreurImport = 'Fichier JSON non reconnu : aucun bloc `lieu` / `session` / `inscriptions` ni `groupes` à la racine.'
      } else {
        sourceLabel = `JSON · ${file.name}`
        solution = null
      }
    } catch (err) {
      erreurImport = err instanceof Error ? err.message : String(err)
    } finally {
      cible.value = ''
    }
  }

  /* --- Édition Lieu ------------------------------------------------------ */

  function ajouterSalle() {
    lieu.salles.push({
      id: `salle-${Date.now().toString(36)}`,
      nom: 'Nouvelle salle',
      jauge: 8,
      equipement: [],
      restrictions: [],
      actif: true,
    })
    solution = null
  }
  function supprimerSalle(i: number) {
    lieu.salles.splice(i, 1)
    solution = null
  }
  function ajouterRestriction(salleIdx: number) {
    lieu.salles[salleIdx].restrictions.push({
      jours: [],
      debut: '22:00',
      fin: '24:00',
      contrainte: 'interdit',
      motif: '',
    })
    solution = null
  }
  function supprimerRestriction(salleIdx: number, resIdx: number) {
    lieu.salles[salleIdx].restrictions.splice(resIdx, 1)
    solution = null
  }

  /* --- Édition Session --------------------------------------------------- */

  function ajouterRegle() {
    session.grille.push({
      jours: [],
      debut: '09:00',
      fin: '10:00',
      pas_minutes: 60,
      salles: [],
      bloque: false,
    })
    solution = null
  }
  function supprimerRegle(i: number) {
    session.grille.splice(i, 1)
    solution = null
  }

  /* --- Édition Inscriptions --------------------------------------------- */

  function ajouterGroupe() {
    inscriptions.groupes.push({
      id: `groupe-${Date.now().toString(36)}`,
      titre: 'Nouveau morceau',
      auteur: '',
      style: '',
      tonalite: '',
      responsable_id: '',
      membres: [],
      postes_cherches: [],
    })
    solution = null
  }
  function supprimerGroupe(i: number) {
    if (!confirm(`Supprimer « ${inscriptions.groupes[i].titre} » ?`)) return
    inscriptions.groupes.splice(i, 1)
    solution = null
  }

  /* --- Édition Imposés --------------------------------------------------- */

  function ajouterImpose() {
    inscriptions.imposes.push({
      id: `impose-${Date.now().toString(36)}`,
      morceau: 'Nouveau morceau imposé',
      membres: [],
      seances: [],
    })
    solution = null
  }
  function supprimerImpose(i: number) {
    if (!confirm(`Supprimer l'imposé « ${inscriptions.imposes[i].morceau} » ?`)) return
    inscriptions.imposes.splice(i, 1)
    solution = null
  }
  function ajouterSeance(imposeIdx: number) {
    inscriptions.imposes[imposeIdx].seances.push({
      date: session.date_debut,
      debut: '14:00',
      fin: '15:30',
    })
    solution = null
  }
  function supprimerSeance(imposeIdx: number, seanceIdx: number) {
    inscriptions.imposes[imposeIdx].seances.splice(seanceIdx, 1)
    solution = null
  }

  /* --- Ajustement manuel : figer/dégeler une répé ------------------------ */

  function keyFigee(a: Assignation): string {
    return `${a.groupe_id}|${a.creneau_id}`
  }
  function estFigee(a: Assignation): boolean {
    return figeesKeys.has(keyFigee(a))
  }
  function toggleFigee(a: Assignation) {
    const k = keyFigee(a)
    const next = new Set(figeesKeys)
    if (next.has(k)) next.delete(k)
    else next.add(k)
    figeesKeys = next
  }
  function toutDegeler() {
    figeesKeys = new Set()
  }

  /* --- Ajustement manuel : déplacer une répé ----------------------------- */

  const ciblesDeplacement = $derived.by(() => {
    if (!deplacementEnCours || !solution) return new Set<string>()
    const g = inscriptions.groupes.find((x) => x.id === deplacementEnCours!.groupe_id)
    if (!g) return new Set<string>()
    const autres = solution.assignations.filter(
      (a) => !(a.groupe_id === deplacementEnCours!.groupe_id && a.creneau_id === deplacementEnCours!.creneau_id),
    )
    const cibles = ciblesValides(deplacementEnCours!, g, lieu, inscriptions, creneaux, autres, {
      date: session.date_butoir,
      heure: session.butoir_heure,
    })
    return new Set(cibles.map((c) => `${c.creneau.id}|${c.salle_id}`))
  })

  function estCibleValide(creneauId: string, salleId: string): boolean {
    return ciblesDeplacement.has(`${creneauId}|${salleId}`)
  }

  function demarrerDeplacement(a: Assignation) {
    deplacementEnCours = deplacementEnCours && keyFigee(deplacementEnCours) === keyFigee(a) ? null : a
    if (deplacementEnCours) vue = 'salles' // bascule sur la vue qui affiche les cibles
  }

  function appliquerDeplacement(creneauId: string, salleId: string) {
    if (!deplacementEnCours || !solution) return
    if (!estCibleValide(creneauId, salleId)) return
    const orig = deplacementEnCours
    // Réassigne la solution en modifiant l'assignation correspondante
    solution.assignations = solution.assignations.map((a) =>
      a.groupe_id === orig.groupe_id && a.creneau_id === orig.creneau_id
        ? { ...a, creneau_id: creneauId, salle_id: salleId }
        : a,
    )
    // Si l'assignation était figée, met à jour la clé
    if (figeesKeys.has(keyFigee(orig))) {
      const next = new Set(figeesKeys)
      next.delete(keyFigee(orig))
      next.add(`${orig.groupe_id}|${creneauId}`)
      figeesKeys = next
    }
    // Recalcule couverture + vérification pour l'affichage post-hoc
    const problemes = verifier(
      session,
      lieu,
      enrichirIndispos(inscriptions),
      creneaux,
      solution.assignations,
      registrePersonnalise(
        (Object.entries(contraintesActives) as [IdContrainte, boolean][])
          .filter(([, v]) => v)
          .map(([k]) => k),
      ),
    )
    const cov = couverture(session, inscriptions, solution.assignations)
    solution.problemes = problemes
    solution.couverture = cov
    deplacementEnCours = null
  }

  function annulerDeplacement() {
    deplacementEnCours = null
  }

  /* --- Carte des créneaux disponibles ------------------------------------ */

  /** Pour la case libre inspectée, liste les groupes qui pourraient s'y insérer. */
  const candidatsCase = $derived.by(() => {
    if (!inspecteCase || !solution) return []
    const c = creneauxParId.get(inspecteCase.creneauId)
    if (!c) return []
    const autres = solution.assignations.filter(
      (a) => !(a.creneau_id === inspecteCase!.creneauId && a.salle_id === inspecteCase!.salleId),
    )
    const out: Array<{ groupe_id: string; titre: string }> = []
    for (const g of inscriptions.groupes) {
      // Simule un "déplacement fictif" depuis nulle part — pas d'assignation d'origine
      const fictif: Assignation = { groupe_id: g.id, creneau_id: '__none__', salle_id: '__none__' }
      const cibles = ciblesValides(fictif, g, lieu, inscriptions, creneaux, autres, {
        date: session.date_butoir,
        heure: session.butoir_heure,
      })
      if (cibles.some((x) => x.creneau.id === inspecteCase!.creneauId && x.salle_id === inspecteCase!.salleId)) {
        out.push({ groupe_id: g.id, titre: g.titre })
      }
    }
    return out
  })
</script>

<main>
  <header>
    <p class="eyebrow">Balance · V1</p>
    <h1>Qui répète <em>où</em>, et <em>quand</em></h1>
    <p class="hint">
      Répartition automatique des répétitions d'un stage de musique — équilibre entre
      musiciens, groupes et salles. {inscriptions.groupes.length} groupes,
      {inscriptions.personnes.length} musiciens, {creneaux.length} créneaux avant butoir du {session.date_butoir}.
    </p>
  </header>

  <section class="sheet">
    <p class="eyebrow">Étape 1 · Source</p>
    <h2>Inscriptions</h2>
    <p class="hint">
      Lecture directe de l'onglet <code>Liste</code> du classeur Excel de l'association,
      ou du jeu de démonstration.
    </p>
    <div class="toolbar">
      <button class="ghost" onclick={utiliserDemo}>Recharger la démo</button>
      <label class="fake-btn">
        Importer .xlsx…
        <input type="file" accept=".xlsx,.xlsm" hidden onchange={importerFichier} />
      </label>
      <label class="fake-btn">
        Charger un état .json…
        <input type="file" accept=".json" hidden onchange={importerEtat} />
      </label>
      <button class="ghost" onclick={exporterEtat}>Sauvegarder l'état .json</button>
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

  <details class="sheet">
    <summary>
      <p class="eyebrow">Étape 1b · Inscriptions</p>
      <h2>{inscriptions.groupes.length} groupes, {inscriptions.personnes.length} musiciens</h2>
      <p class="hint">
        Édition inline titre / responsable / style / tonalité. Les membres se saisissent
        via le classeur Excel importé — édition détaillée pupitre par pupitre à venir.
      </p>
    </summary>
    <div class="body">
      <table>
        <thead>
          <tr>
            <th style="width:30px">N°</th>
            <th>Titre</th>
            <th style="width:130px">Responsable</th>
            <th style="width:110px">Style</th>
            <th style="width:70px">Tona</th>
            <th style="width:65px">Effectif</th>
            <th style="width:40px"></th>
          </tr>
        </thead>
        <tbody>
          {#each inscriptions.groupes as g, i}
            {@const effectif = new Set(g.membres.map((m) => m.personne_id)).size}
            <tr>
              <td class="mono">{i + 1}</td>
              <td><input bind:value={g.titre} /></td>
              <td><input bind:value={g.responsable_id} /></td>
              <td><input bind:value={g.style} /></td>
              <td><input bind:value={g.tonalite} /></td>
              <td class="center mono">{effectif}</td>
              <td class="center"><button class="mini" onclick={() => supprimerGroupe(i)}>×</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <button class="ghost" onclick={ajouterGroupe}>+ Ajouter un groupe</button>
    </div>
  </details>

  <details class="sheet">
    <summary>
      <p class="eyebrow">Étape 1c · Morceaux imposés</p>
      <h2>{inscriptions.imposes.length} imposé(s)</h2>
      <p class="hint">
        Morceaux « obligatoires » du stage avec leurs séances de répétition déjà planifiées.
        Les membres listés seront bloqués sur ces créneaux — le solveur en tient compte
        pour les groupes volontaires qui les partagent.
      </p>
    </summary>
    <div class="body">
      {#each inscriptions.imposes as imp, i}
        <div class="impose-bloc">
          <div class="impose-titre">
            <input bind:value={imp.morceau} class="strong" />
            <span class="mono ink-soft">{imp.membres.length} membres</span>
            <button class="mini" onclick={() => supprimerImpose(i)}>×</button>
          </div>
          <div class="chips">
            {#each imp.membres as pid}
              {@const p = personnesParId.get(pid)}
              <span class="chip">{p ? libellePersonne(p) : pid}</span>
            {/each}
            {#if imp.membres.length === 0}<span class="ink-soft">aucun membre</span>{/if}
          </div>
          <table class="seances">
            <thead>
              <tr>
                <th style="width:140px">Date</th>
                <th style="width:110px">Début</th>
                <th style="width:110px">Fin</th>
                <th>Salle (info)</th>
                <th style="width:40px"></th>
              </tr>
            </thead>
            <tbody>
              {#each imp.seances as s, si}
                <tr>
                  <td><input type="date" bind:value={s.date} /></td>
                  <td><input type="time" bind:value={s.debut} /></td>
                  <td><input type="time" bind:value={s.fin} /></td>
                  <td><input bind:value={s.salle_id} placeholder="XVème, Le Garage…" /></td>
                  <td class="center">
                    <button class="mini" onclick={() => supprimerSeance(i, si)}>×</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
          <button class="ghost mini-ajout" onclick={() => ajouterSeance(i)}>+ séance</button>
        </div>
      {/each}
      <button class="ghost" onclick={ajouterImpose}>+ Ajouter un morceau imposé</button>
    </div>
  </details>

  <details class="sheet" open>
    <summary>
      <p class="eyebrow">Étape 2a · Lieu</p>
      <h2>{lieu.nom}</h2>
      <p class="hint">
        {lieu.salles.filter((s) => s.actif).length} salle(s) active(s) sur {lieu.salles.length}.
        Cliquer pour déplier / modifier.
      </p>
    </summary>
    <div class="body">
      <label class="line">
        Nom du lieu <input bind:value={lieu.nom} />
      </label>
      <table>
        <thead>
          <tr>
            <th>Salle</th>
            <th style="width:80px">Jauge</th>
            <th style="width:70px">Active</th>
            <th>Restrictions horaires</th>
            <th style="width:40px"></th>
          </tr>
        </thead>
        <tbody>
          {#each lieu.salles as salle, i}
            <tr>
              <td><input bind:value={salle.nom} /></td>
              <td><input type="number" min="1" bind:value={salle.jauge} /></td>
              <td class="center"><input type="checkbox" bind:checked={salle.actif} /></td>
              <td>
                {#each salle.restrictions as res, ri}
                  <div class="restr">
                    <input type="time" bind:value={res.debut} />
                    <span>→</span>
                    <input type="time" bind:value={res.fin} />
                    <select bind:value={res.contrainte}>
                      <option value="interdit">fermée</option>
                      <option value="acoustique_seulement">acoustique</option>
                      <option value="pas_reduit">créneaux ≤</option>
                    </select>
                    {#if res.contrainte === 'pas_reduit'}
                      <input
                        type="number"
                        min="5"
                        max="180"
                        step="5"
                        bind:value={res.pas_max_minutes}
                        placeholder="min"
                        style="width:70px"
                      />
                      <span class="mono ink-soft">min</span>
                    {/if}
                    <input
                      bind:value={res.motif}
                      placeholder="motif (dortoirs, concert vendredi…)"
                    />
                    <button class="mini" onclick={() => supprimerRestriction(i, ri)}>×</button>
                  </div>
                  <div class="restr sub">
                    <span class="ink-soft mono">jours&nbsp;:</span>
                    <input
                      value={res.jours.join(', ')}
                      oninput={(e) => {
                        const v = (e.currentTarget as HTMLInputElement).value
                        res.jours = v
                          .split(/[,;\s]+/)
                          .map((s) => s.trim())
                          .filter(Boolean)
                        solution = null
                      }}
                      placeholder="tous par défaut — ou 2026-08-28, 2026-08-27…"
                    />
                  </div>
                {/each}
                <button class="ghost mini-ajout" onclick={() => ajouterRestriction(i)}>+ restriction</button>
              </td>
              <td class="center"><button class="mini" onclick={() => supprimerSalle(i)}>×</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <button class="ghost" onclick={ajouterSalle}>+ Ajouter une salle</button>
    </div>
  </details>

  <details class="sheet" open>
    <summary>
      <p class="eyebrow">Étape 2b · Session</p>
      <h2>{session.nom}</h2>
      <p class="hint">
        {session.date_debut} → {session.date_fin}, butoir {session.date_butoir} {session.butoir_heure}.
        {session.grille.filter((r) => !r.bloque).length} règle(s) créatrice(s),
        {session.grille.filter((r) => r.bloque).length} règle(s) de blocage —
        <b>{creneaux.length}</b> créneaux générés.
      </p>
    </summary>
    <div class="body">
      <label class="line">
        Nom de session <input bind:value={session.nom} />
      </label>
      <div class="fields">
        <label>Début <input type="date" bind:value={session.date_debut} /></label>
        <label>Fin <input type="date" bind:value={session.date_fin} /></label>
        <label>Butoir <input type="date" bind:value={session.date_butoir} /></label>
        <label>Butoir heure <input type="time" bind:value={session.butoir_heure} /></label>
        <label>Répétitions visées <input type="number" min="1" max="10" bind:value={session.repetitions_visees} /></label>
        <label>Minimum acceptable <input type="number" min="1" max="10" bind:value={session.repetitions_min} /></label>
      </div>
      <h3>Grille de créneaux</h3>
      <p class="hint">
        Chaque règle génère des créneaux tous les jours de la session (sauf si on précise
        des dates ISO dans « jours »). « Bloque » retire les créneaux qui tombent dans la plage.
      </p>
      <table>
        <thead>
          <tr>
            <th style="width:110px">Début</th>
            <th style="width:110px">Fin</th>
            <th style="width:80px">Pas (min)</th>
            <th style="width:80px">Bloque</th>
            <th style="width:40px"></th>
          </tr>
        </thead>
        <tbody>
          {#each session.grille as regle, i}
            <tr>
              <td><input type="time" bind:value={regle.debut} /></td>
              <td><input type="time" bind:value={regle.fin} /></td>
              <td><input type="number" min="10" max="240" step="15" bind:value={regle.pas_minutes} /></td>
              <td class="center"><input type="checkbox" bind:checked={regle.bloque} /></td>
              <td class="center"><button class="mini" onclick={() => supprimerRegle(i)}>×</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <button class="ghost" onclick={ajouterRegle}>+ Ajouter une règle</button>
    </div>
  </details>

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
          <input type="checkbox" bind:checked={contraintesActives[id]} />
          <span>{LIBELLE_CONTRAINTE[id]}</span>
          <code>{id}</code>
        </label>
      {/each}
    </div>
  </details>

  <section class="sheet">
    <p class="eyebrow">Étape 3 · Placement</p>
    <h2>Répartition</h2>
    <p class="hint">
      Placer chaque groupe {session.repetitions_visees} fois avant l'échéance, sans jamais
      convoquer deux fois la même personne au même moment ni doubler une salle.
    </p>
    {#if infaisabilites.length > 0}
      <div class="msg warn">
        <b>Contrôle en amont : {infaisabilites.length} musicien(s) en surcharge structurelle.</b>
        <p class="mini-h">
          Chacun ci-dessous demande plus de créneaux qu'il n'en a de disponibles.
          Le solveur va échouer à les placer tous — il faut réduire leurs engagements
          ou libérer des créneaux avant.
        </p>
        <ul>
          {#each infaisabilites.slice(0, 8) as d}
            <li>
              <b>{d.nom}</b> — demande <b>{d.demande}</b> créneaux
              ({d.detail.groupes} groupes × {d.detail.repetitions_visees}
              {#if d.detail.seances_imposees > 0} + {d.detail.seances_imposees} imposés{/if})
              mais seulement <b>{d.offre}</b> lui sont ouverts
              (sur {d.detail.creneaux_total} au total).
            </li>
          {/each}
          {#if infaisabilites.length > 8}
            <li>… et {infaisabilites.length - 8} autres</li>
          {/if}
        </ul>
      </div>
    {/if}
    <button class="big" onclick={lancer} disabled={calculEnCours}>
      {calculEnCours ? 'Recherche en cours…' : solution ? 'Relancer la répartition' : 'Lancer la répartition'}
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
            {#each solution.problemes.slice(0, 8) as pb}<li>{pb.message}</li>{/each}
            {#if solution.problemes.length > 8}
              <li>… et {solution.problemes.length - 8} autres</li>
            {/if}
          </ul>
        </div>
      {:else}
        <div class="msg ok">Aucun conflit détecté par la vérification indépendante.</div>
      {/if}
      {#if solution.diagnostics.length > 0}
        <div class="msg warn">
          <b>Pourquoi ça bloque</b>
          <p class="mini-h">
            Ces groupes n'ont pas atteint la cible ({session.repetitions_visees} répétitions).
            Voici sur quoi agir.
          </p>
          {#each solution.diagnostics as d}
            <div class="diag-bloc">
              <b>{d.titre}</b> — {d.obtenu}/{d.cible} répétitions,
              seulement <b>{d.creneaux_ouverts}</b> créneaux compatibles sur {creneaux.length}.
              {#if d.partages.length > 0}
                <br /><span class="ink-soft">
                  Partage des musiciens avec :
                  {#each d.partages.slice(0, 3) as p, i}
                    {i > 0 ? ', ' : ''}<b>{p.titre}</b> ({p.communs.join(', ')})
                  {/each}
                </span>
              {/if}
              {#if d.poids_musicien}
                <br /><span class="ink-soft">
                  Piste : <b>{d.poids_musicien.nom}</b> cumule
                  {d.poids_musicien.n_groupes} groupe(s)
                  {#if d.poids_musicien.n_imposes > 0}
                    + {d.poids_musicien.n_imposes} séance(s) imposée(s)
                  {/if}. Le remplacer ici, ou accepter {d.cible - 1} répétitions, débloque la situation.
                </span>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
  </section>

  {#if solution}
    <section class="sheet impression">
      <p class="eyebrow">Étape 4 · Résultats</p>
      <h2>États imprimables</h2>
      <div class="toolbar">
        <button class:actif={vue === 'groupes'} onclick={() => (vue = 'groupes')}>Par groupe</button>
        <button class:actif={vue === 'salles'} onclick={() => (vue = 'salles')}>Par salle</button>
        <button class:actif={vue === 'musiciens'} onclick={() => (vue = 'musiciens')}>Par musicien</button>
        <button class:actif={vue === 'carte'} onclick={() => (vue = 'carte')}>Carte</button>
        <span class="grow"></span>
        {#if figeesKeys.size > 0}
          <span class="mono ink-soft">{figeesKeys.size} figée{figeesKeys.size > 1 ? 's' : ''}</span>
          <button class="ghost" onclick={toutDegeler}>Tout dégeler</button>
        {/if}
        <button class="ghost" onclick={exporterGroupes}>CSV groupes</button>
        <button class="ghost" onclick={exporterSalles}>CSV salles</button>
        <button class="ghost" onclick={exporterMusiciens}>CSV musiciens</button>
        <button class="ghost" onclick={exporterXlsx}>Classeur .xlsx</button>
        <button class="ghost" onclick={() => window.print()}>Imprimer</button>
      </div>
      {#if figeesKeys.size > 0}
        <p class="hint">
          Une répétition figée (cadenas ochre plein) sera préservée lors des relances —
          le solveur calcule autour. Clique sur le cadenas pour dégeler.
        </p>
      {/if}
      {#if deplacementEnCours}
        {@const g = inscriptions.groupes.find((x) => x.id === deplacementEnCours!.groupe_id)}
        <div class="msg warn">
          <b>Déplacement en cours :</b> {g?.titre ?? deplacementEnCours.groupe_id}.
          Sélectionne une case libre surlignée en vert dans la vue Par salle
          ({ciblesDeplacement.size} cible(s) valide(s)).
          <button class="ghost mini-ajout" onclick={annulerDeplacement}>Annuler</button>
        </div>
      {/if}

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
      {:else if vue === 'salles'}
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
            {#each lieu.salles.filter((s) => s.actif) as salle}
              {#each creneaux
                .filter((c) => c.salles.includes(salle.id))
                .sort((a, b) => `${a.date}T${a.debut}`.localeCompare(`${b.date}T${b.debut}`)) as c}
                {@const ass = solution.assignations.find((a) => a.creneau_id === c.id && a.salle_id === salle.id)}
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
      {:else if vue === 'carte'}
        {@const sallesAffichees = lieu.salles.filter((s) => s.actif)}
        {@const creneauxTries = [...creneaux].sort((a, b) =>
          `${a.date}T${a.debut}`.localeCompare(`${b.date}T${b.debut}`),
        )}
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
              {@const assCr = solution.assignations.filter((a) => a.creneau_id === c.id)}
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
                        (inspecteCase =
                          inspecteCase && inspecteCase.creneauId === c.id && inspecteCase.salleId === s.id
                            ? null
                            : { creneauId: c.id, salleId: s.id })}
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
          for (const l of m.values())
            l.sort((x, y) => `${x.c.date}T${x.c.debut}`.localeCompare(`${y.c.date}T${y.c.debut}`))
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
  button, .fake-btn {
    font-family: var(--sans);
    font-weight: 600;
    font-size: 14px;
    padding: 10px 20px;
    border-radius: 2px;
    cursor: pointer;
    border: 1px solid var(--ink);
    background: var(--ink);
    color: var(--paper);
    transition: background 0.15s;
    display: inline-block;
    line-height: 1.2;
  }
  button:hover:not(:disabled), .fake-btn:hover { background: #000; }
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
  .fake-btn { background: transparent; color: var(--ink); }
  .fake-btn:hover { background: #efede4; }
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
  .msg.warn { background: #fbf2df; border-color: var(--ochre); }
  .msg ul { margin: 6px 0 0 16px; }
  .toolbar {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
    margin: 20px 0 16px;
  }
  .grow { flex: 1; }
  .ink-soft { color: var(--ink-soft); }
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
  .chip.figee {
    background: #fbf2df;
    border-color: #e6d2a6;
    border-left-color: var(--ochre);
  }
  /* Cadenas SVG minimaliste — inline en background-image pour rester léger */
  button.lock {
    display: inline-block;
    width: 18px;
    height: 18px;
    padding: 0;
    margin-left: 6px;
    background: transparent;
    border: none;
    vertical-align: -3px;
    cursor: pointer;
    opacity: 0.4;
    transition: opacity 0.15s;
    background-repeat: no-repeat;
    background-position: center;
    background-size: 14px 14px;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235B6660' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='4' y='11' width='16' height='10' rx='2'/><path d='M8 11V7a4 4 0 0 1 8 0'/></svg>");
  }
  button.lock:hover { opacity: 0.9; }
  button.lock.on {
    opacity: 1;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23C8871F' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><rect x='4' y='11' width='16' height='10' rx='2' fill='%23FBF2DF'/><path d='M8 11V7a4 4 0 0 1 8 0v4'/></svg>");
  }
  tr.figee td { background: #fbf2df; }
  tr.cible td { background: #e3eee6; }
  /* Bouton déplacer — flèche SVG */
  button.move {
    display: inline-block;
    width: 18px;
    height: 18px;
    padding: 0;
    margin-left: 3px;
    background: transparent;
    border: none;
    vertical-align: -3px;
    cursor: pointer;
    opacity: 0.4;
    transition: opacity 0.15s;
    background-repeat: no-repeat;
    background-position: center;
    background-size: 14px 14px;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235B6660' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M5 9h14M5 15h14M13 5l6 4-6 4M11 19l-6-4 6-4'/></svg>");
  }
  button.move:hover { opacity: 0.9; }
  button.move.on {
    opacity: 1;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23C8871F' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M5 9h14M5 15h14M13 5l6 4-6 4M11 19l-6-4 6-4'/></svg>");
  }
  button.drop-target {
    padding: 3px 10px;
    font-size: 11px;
    background: var(--vert);
    border-color: var(--vert);
    color: white;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-weight: 600;
  }
  button.drop-target:hover { background: #3d6a4a; border-color: #3d6a4a; }

  /* Carte des créneaux */
  table.carte td, table.carte th { padding: 6px 8px; font-size: 12.5px; }
  table.carte td.fermee { color: #ccc; background: #f7f6f0; text-align: center; }
  table.carte td.occ {
    background: #e9ede2;
    text-align: center;
    font-weight: 500;
  }
  table.carte td.occ.figee { background: #fbf2df; }
  table.carte td.libre-cell {
    text-align: center;
    color: var(--vert);
    cursor: pointer;
    background: #f2f9f4;
    font-style: italic;
  }
  table.carte td.libre-cell:hover, table.carte td.libre-cell.inspecte {
    background: var(--vert);
    color: white;
    font-style: normal;
  }
  table.carte td.taux { text-align: right; color: var(--ink-soft); }
  table.carte td.taux.hot { color: var(--rouge); font-weight: 600; }
  .candidats {
    margin-top: 16px;
    padding: 12px 15px;
    background: #f2f9f4;
    border-left: 3px solid var(--vert);
    border-radius: 0 2px 2px 0;
  }
  .rouge { color: var(--rouge); font-style: italic; }
  .mono { font-family: var(--mono); font-size: 12px; }

  /* Éditeurs Lieu / Session */
  details.sheet > summary {
    list-style: none;
    cursor: pointer;
    padding: 0;
    margin: 0;
  }
  details.sheet > summary::-webkit-details-marker { display: none; }
  details.sheet > summary::after {
    content: '▾';
    float: right;
    font-size: 20px;
    color: var(--ink-soft);
    transform: translate(0, -12px);
    transition: transform 0.15s;
  }
  details.sheet[open] > summary::after {
    transform: translate(0, -12px) rotate(180deg);
  }
  details.sheet > summary h2 { margin-bottom: 4px; }
  details.sheet > summary .hint { margin-bottom: 0; }
  details.sheet > .body { margin-top: 20px; padding-top: 20px; border-top: 1px solid var(--paper-edge); }
  .body h3 {
    font-family: var(--serif);
    font-weight: 400;
    font-size: 20px;
    margin: 22px 0 6px;
  }
  input[type='text'], input:not([type]), input[type='date'], input[type='time'], input[type='number'] {
    padding: 6px 9px;
    border: 1px solid #cfcbbe;
    border-radius: 2px;
    background: #fff;
    font-family: var(--sans);
    font-size: 13.5px;
    color: var(--ink);
    width: 100%;
  }
  input:focus { outline: 2px solid var(--ochre); outline-offset: -1px; border-color: var(--ochre); }
  .line { display: block; margin: 0 0 12px; }
  .line input { max-width: 480px; margin-top: 4px; }
  label {
    display: block;
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--ink-soft);
    margin-bottom: 4px;
    font-weight: 600;
  }
  .fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 12px;
    margin-bottom: 8px;
  }
  .fields label { text-transform: uppercase; }
  button.mini {
    padding: 3px 8px;
    font-size: 14px;
    font-weight: 400;
    background: transparent;
    color: var(--rouge);
    border-color: transparent;
  }
  button.mini:hover { background: #f8e6e3; }
  td.center { text-align: center; }
  td input { padding: 5px 7px; font-size: 12.5px; }
  .restr {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 3px;
    flex-wrap: wrap;
  }
  .restr.sub {
    margin: 0 0 8px 8px;
    padding-left: 8px;
    border-left: 2px solid var(--paper-edge);
  }
  .restr input[type='time'] { width: 90px; }
  .restr input:not([type]), .restr input[type='text'] { flex: 1; min-width: 100px; }
  .restr select {
    padding: 5px 7px;
    font-size: 12.5px;
    border: 1px solid #cfcbbe;
    background: #fff;
    border-radius: 2px;
  }
  button.mini-ajout {
    padding: 3px 10px;
    font-size: 12px;
    margin-top: 2px;
  }
  .diag-bloc {
    padding: 10px 12px;
    margin: 8px 0 0;
    background: rgba(255, 255, 255, 0.55);
    border-radius: 2px;
    font-size: 13.5px;
    line-height: 1.5;
  }
  .mini-h {
    margin: 4px 0 8px;
    font-size: 13px;
    color: var(--ink-soft);
  }
  .impose-bloc {
    border-left: 3px solid var(--ochre);
    padding: 12px 14px;
    margin: 0 0 18px;
    background: #f7f5ec;
  }
  .impose-titre {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 8px;
  }
  .impose-titre input.strong {
    flex: 1;
    font-weight: 600;
    font-size: 15px;
    background: transparent;
    border: none;
    padding: 4px 0;
  }
  .impose-titre input.strong:focus { outline: 2px solid var(--ochre); }
  .chips { margin-bottom: 8px; }
  table.seances { margin-top: 4px; }
  label.check {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    text-transform: none;
    font-family: var(--sans);
    font-size: 14px;
    color: var(--ink);
    font-weight: 400;
    letter-spacing: 0;
    border-bottom: 1px solid var(--paper-edge);
    cursor: pointer;
  }
  label.check:last-child { border-bottom: none; }
  label.check input[type='checkbox'] { width: auto; margin: 0; }
  label.check code {
    margin-left: auto;
    font-family: var(--mono);
    font-size: 11px;
    color: var(--ink-soft);
    background: transparent;
    padding: 0;
  }

  /* Impression : conserver la seule vue résultat active, sans formulaires.
     Chaque tableau ne se coupe pas en milieu de ligne. */
  @media print {
    @page { margin: 12mm 10mm; }
    body { background: white !important; color: black; }
    main { max-width: none; padding: 0; }
    header, details.sheet, .sheet:not(.impression), .toolbar {
      display: none !important;
    }
    .sheet.impression {
      background: white;
      color: black;
      box-shadow: none;
      padding: 0;
      margin: 0;
      border-radius: 0;
    }
    .sheet.impression .eyebrow,
    .sheet.impression h2 {
      color: black;
    }
    .sheet.impression .toolbar,
    .sheet.impression .stats,
    .sheet.impression .msg,
    .sheet.impression button,
    .sheet.impression .fake-btn {
      display: none !important;
    }
    table {
      page-break-inside: auto;
      border-collapse: collapse;
    }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    .chip {
      background: white;
      border: 1px solid #999;
      color: black;
    }
    .chip em { color: #444; }
  }
</style>
