<script lang="ts">
  import { genererCreneaux } from './domain/grille'
  import { parseLegacyInscriptions } from './domain/legacy'
  import { migrerInscriptions } from './domain/migrate'
  import type { Inscriptions } from './domain/model'
  import { Lieu, Session, libellePersonne } from './domain/model'
  import { attribuerSalles } from './engine/allocate-rooms'
  import { chargeParMusicien } from './engine/charge'
  import Contraintes from './edition/Contraintes.svelte'
  import ImposesEdit from './edition/Imposes.svelte'
  import IndisposEdit from './edition/Indispos.svelte'
  import InscriptionsEdit from './edition/Inscriptions.svelte'
  import LieuEdit from './edition/Lieu.svelte'
  import PersonnesEdit from './edition/Personnes.svelte'
  import SessionEdit from './edition/Session.svelte'
  import Source from './edition/Source.svelte'
  import Carte from './vues/Carte.svelte'
  import Concert from './vues/Concert.svelte'
  import ParGroupe from './vues/ParGroupe.svelte'
  import ParMusicien from './vues/ParMusicien.svelte'
  import ParSalle from './vues/ParSalle.svelte'
  import Quotas from './vues/Quotas.svelte'
  import { ordonnerConcert } from './engine/concert'
  import type { EtapeConcert } from './engine/concert'
  import type { IdContrainte } from './engine/contraintes'
  import { REGISTRE_TOUT, registrePersonnalise } from './engine/contraintes'
  import { analyserInfaisabilite, diagnostiquer } from './engine/diagnostic'
  import { enrichirIndispos } from './engine/imposes'
  import { ciblesValides } from './engine/manuel'
  import { suggererRenforts } from './engine/renforts'
  import { repartir } from './engine/solver'
  import type { Assignation, Probleme } from './engine/types'
  import { couverture, verifier } from './engine/verify'
  import { csvParGroupe, csvParMusicien, csvParSalle, telechargerCsv } from './io/csv'
  import { exporterClasseurExcel } from './io/excel-export'
  import { importerListeExcel, importerStagiairesExcel } from './io/excel-io'
  import type { MappingListe } from './io/liste-adapter'
  import type { MappingStagiaires } from './io/stagiaires-adapter'
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
  const MAPPING_STAGIAIRES: MappingStagiaires = {
    colonneNom: 'Nom',
    colonnePupitrePrincipal: 'Pupitre',
    colonnePupitresAdditionnels: 'Pupitres additionnels',
    colonneInstrument: 'Instrument',
    colonneLateralite: 'Latéralité',
    colonneIndispos: 'Indispos',
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
  let vue = $state<'groupes' | 'salles' | 'musiciens' | 'carte' | 'concert' | 'quotas'>('groupes')
  /** Deltas d'exploration par pupitre (dans la vue Quotas). */
  let deltasQuotas = $state<Record<string, number>>({})
  /** Ordre du conducteur, éditable par drag-drop. Recalculé quand solution change. */
  let ordreConducteur = $state<EtapeConcert[]>([])
  let dragIdx = $state<number | null>(null)
  /** Minutage du conducteur du spectacle. */
  let cdDebut = $state('18:30')
  let cdDureeMorceau = $state(6)
  let cdDureeChange = $state(3)
  let cdDureeKit = $state(7)
  /** Case libre survolée dans la carte : affiche les groupes candidats. */
  let inspecteCase = $state<{ creneauId: string; salleId: string } | null>(null)
  /** Seuil de charge par musicien et par jour au-delà duquel on alerte. */
  let seuilChargeJour = $state(4)
  /** Si vrai, la grille écarte les créneaux dont l'heure de début est passée. */
  let filtrerPasse = $state(false)
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
    'preference-espacement-12h': true,
    'preference-repos-musicien-12h': true,
    'preference-equilibre-tardif': true,
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
    'preference-espacement-12h': '≥ 12 h entre deux répétitions d\'un même morceau (prioritaire)',
    'preference-repos-musicien-12h': '≥ 12 h de repos entre deux engagements d\'un même musicien (secondaire)',
    'preference-equilibre-tardif': 'Éviter qu\'un musicien ait toutes ses répés en soirée',
    'preference-salle-stable-lourd': 'Regrouper les répés d\'un musicien à instrument lourd (contrebasse…) dans la même salle',
  }

  const creneaux = $derived.by(() => {
    try {
      return genererCreneaux(session, lieu, { maintenant: filtrerPasse ? new Date() : undefined })
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
  function nouvelleSessionVide() {
    if (
      !confirm(
        "Nouvelle session dans ce lieu ? Le lieu et ses salles sont préservés. La session (dates + grille) et toutes les inscriptions actuelles seront remplacés par un modèle vierge.",
      )
    )
      return
    // Lieu inchangé (salles, restrictions, pupitres, équipements).
    // Session : cette semaine, grille type minimale
    const today = new Date()
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const dansXjours = (n: number) => {
      const d = new Date(today)
      d.setDate(d.getDate() + n)
      return iso(d)
    }
    Object.assign(session, {
      id: 'nouvelle-session',
      nom: 'Nouvelle session',
      date_debut: iso(today),
      date_fin: dansXjours(6),
      date_butoir: dansXjours(6),
      butoir_heure: '23:59',
      repetitions_visees: 3,
      repetitions_min: 2,
      plafond_morceaux: 13,
    })
    session.grille.splice(
      0,
      session.grille.length,
      { jours: [], debut: '09:00', fin: '12:00', pas_minutes: 60, salles: [], bloque: false },
      { jours: [], debut: '14:00', fin: '18:00', pas_minutes: 60, salles: [], bloque: false },
    )
    // Inscriptions vides (personnes + groupes + imposés)
    inscriptions = { session_id: 'nouvelle-session', personnes: [], groupes: [], imposes: [] }
    sourceLabel = `nouvelle session dans « ${lieu.nom} »`
    warningsImport = []
    erreurImport = ''
    solution = null
    figeesKeys = new Set()
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

  async function importerStagiaires(e: Event) {
    const cible = e.target as HTMLInputElement
    const file = cible.files?.[0]
    if (!file) return
    warningsImport = []
    erreurImport = ''
    try {
      const { personnes, warnings } = await importerStagiairesExcel(file, 'Stagiaires', MAPPING_STAGIAIRES)
      // Fusion : ajoute les nouveaux stagiaires sans écraser les existants
      // (même id = doublon signalé).
      const existants = new Set(inscriptions.personnes.map((p) => p.id))
      const nouveaux = personnes.filter((p) => !existants.has(p.id))
      const doublons = personnes.length - nouveaux.length
      inscriptions.personnes.push(...nouveaux)
      sourceLabel = `Stagiaires · ${file.name} (+${nouveaux.length})`
      warningsImport = [
        ...warnings,
        ...(doublons > 0 ? [`${doublons} personne(s) déjà présente(s), ignorée(s)`] : []),
      ]
      solution = null
    } catch (err) {
      erreurImport = err instanceof Error ? err.message : String(err)
    } finally {
      cible.value = ''
    }
  }

  /** Recalcule les stats d'un ordre du conducteur (mouvements) à partir des groupes. */
  function statsConducteur(ordre: EtapeConcert[]): { mouvements: number } {
    let mouvements = 0
    let precedents = new Set<string>()
    for (const e of ordre) {
      const g = groupesParId.get(e.groupe_id)
      const m = g ? new Set(g.membres.map((mm) => mm.personne_id)) : new Set<string>()
      const montent = [...m].filter((x) => !precedents.has(x)).length
      const descendent = [...precedents].filter((x) => !m.has(x)).length
      mouvements += montent + descendent
      precedents = m
    }
    return { mouvements }
  }

  function reordonnerAuto() {
    const r = ordonnerConcert(inscriptions.groupes)
    ordreConducteur = r.etapes
  }

  /**
   * Identifie le batteur d'un groupe et retourne sa latéralité (si connue).
   * Renvoie `null` si pas de batteur ou latéralité inconnue.
   */
  function lateraliteBatteur(groupe_id: string): 'droitier' | 'gaucher' | null {
    const g = groupesParId.get(groupe_id)
    if (!g) return null
    const batteur = g.membres.find((m) => m.pupitre === 'batterie')
    if (!batteur) return null
    const p = personnesParId.get(batteur.personne_id)
    return p?.lateralite ?? null
  }

  /** Minutage : heure de chaque étape, inversions de kit, durée totale. */
  interface EtapeMinutee extends EtapeConcert {
    heure_debut: string
    heure_fin: string
    duree_min: number
    /** Temps ajouté avant cette étape pour changement plateau et/ou inversion kit. */
    change_min: number
    /** True si une inversion de kit doit se faire pendant le changement précédent. */
    inversion_kit: boolean
    lateralite?: 'droitier' | 'gaucher'
  }
  const conducteurMinuté = $derived.by<{
    etapes: EtapeMinutee[]
    duree_totale_min: number
    heure_fin: string
    nb_inversions: number
  }>(() => {
    const [dh, dm] = cdDebut.split(':').map(Number)
    let t = dh * 60 + dm
    const debut = t
    const hhmm = (m: number): string =>
      `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
    const etapes: EtapeMinutee[] = []
    let dernierBatteur: { latéralité: 'droitier' | 'gaucher'; index: number } | null = null
    let nbInversions = 0
    ordreConducteur.forEach((e, i) => {
      const lat = lateraliteBatteur(e.groupe_id)
      let changeMin = 0
      let inversion = false
      if (i > 0) {
        changeMin = cdDureeChange
        if (lat && dernierBatteur && lat !== dernierBatteur.latéralité) {
          inversion = true
          nbInversions++
          changeMin = Math.max(changeMin, cdDureeKit)
        }
      }
      t += changeMin
      const heure_debut = hhmm(t)
      t += cdDureeMorceau
      etapes.push({
        ...e,
        heure_debut,
        heure_fin: hhmm(t),
        duree_min: cdDureeMorceau,
        change_min: changeMin,
        inversion_kit: inversion,
        lateralite: lat ?? undefined,
      })
      if (lat) dernierBatteur = { latéralité: lat, index: i }
    })
    return {
      etapes,
      duree_totale_min: t - debut,
      heure_fin: hhmm(t),
      nb_inversions: nbInversions,
    }
  })

  /** Palette dérivée du nom du style (hash → HSL) pour un rendu stable. */
  function couleurStyle(style: string): string {
    if (!style) return '#e8e5da'
    let h = 0
    for (let i = 0; i < style.length; i++) h = (h * 31 + style.charCodeAt(i)) % 360
    return `hsl(${h}, 55%, 78%)`
  }

  /** Répartition des styles dans l'ordre conducteur, avec runs (séquences consécutives). */
  const repartitionStyles = $derived.by(() => {
    const compte = new Map<string, number>()
    for (const e of ordreConducteur) {
      const k = e.style || '(sans style)'
      compte.set(k, (compte.get(k) ?? 0) + 1)
    }
    const total = ordreConducteur.length
    const parts = [...compte.entries()]
      .map(([style, n]) => ({ style, n, pct: total > 0 ? Math.round((n / total) * 100) : 0 }))
      .sort((a, b) => b.n - a.n)
    // Runs de même style ≥ 3
    const runs: Array<{ style: string; debut: number; fin: number }> = []
    let i = 0
    while (i < ordreConducteur.length) {
      let j = i
      while (
        j + 1 < ordreConducteur.length &&
        ordreConducteur[j + 1].style === ordreConducteur[i].style &&
        ordreConducteur[i].style
      )
        j++
      if (j - i + 1 >= 3) runs.push({ style: ordreConducteur[i].style, debut: i, fin: j })
      i = j + 1
    }
    return { parts, runs }
  })

  function dropOrdre(idxCible: number) {
    if (dragIdx == null || dragIdx === idxCible) return
    const cp = [...ordreConducteur]
    const [item] = cp.splice(dragIdx, 1)
    cp.splice(idxCible, 0, item)
    ordreConducteur = cp
    dragIdx = null
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
    const assignations = attribuerSalles(placement, lieu, inscEnrichies, creneaux, { figees, registre })
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
    ordreConducteur = ordonnerConcert(inscriptions.groupes).etapes
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
  /** Affecte un renfort à un groupe : ajoute aux membres, retire du postes_cherches. */
  function affecterRenfort(groupe_id: string, personne_id: string, pupitre: string) {
    const g = inscriptions.groupes.find((x) => x.id === groupe_id)
    if (!g) return
    g.membres.push({ personne_id, pupitre })
    const idx = g.postes_cherches.indexOf(pupitre)
    if (idx >= 0) g.postes_cherches.splice(idx, 1)
    solution = null
  }
  /** Retire un membre d'un groupe. Si le pupitre n'est plus tenu, l'ajoute à `postes_cherches`. */
  function retirerMembre(groupe_id: string, membreIdx: number) {
    const g = inscriptions.groupes.find((x) => x.id === groupe_id)
    if (!g) return
    const m = g.membres[membreIdx]
    if (!m) return
    const p = personnesParId.get(m.personne_id)
    const libelle = p ? libellePersonne(p) : m.personne_id
    if (!confirm(`Retirer ${libelle} (${m.pupitre}) de « ${g.titre} » ?`)) return
    g.membres.splice(membreIdx, 1)
    // Auto : si personne d'autre ne tient ce pupitre, on le passe en cherche.
    const encore = g.membres.some((mm) => mm.pupitre === m.pupitre)
    if (!encore && !g.postes_cherches.includes(m.pupitre)) {
      g.postes_cherches.push(m.pupitre)
    }
    solution = null
  }

  /* --- Édition Personnes ------------------------------------------------- */

  function ajouterPersonne() {
    inscriptions.personnes.push({
      id: `personne-${Date.now().toString(36)}`,
      nom: 'Nouveau stagiaire',
      discriminant: '',
      instruments: [],
      role: 'musicien',
      indispos: [],
    })
    solution = null
  }
  function supprimerPersonne(pid: string) {
    const p = inscriptions.personnes.find((x) => x.id === pid)
    if (!p) return
    // Vérifier qu'elle n'est plus dans aucun groupe / imposé
    const engagements = inscriptions.groupes.filter((g) =>
      g.membres.some((m) => m.personne_id === pid),
    ).length
    if (engagements > 0) {
      if (!confirm(`${libellePersonne(p)} est encore dans ${engagements} groupe(s). Supprimer quand même ?`))
        return
      // Retire des groupes
      for (const g of inscriptions.groupes) {
        g.membres = g.membres.filter((m) => m.personne_id !== pid)
      }
    }
    inscriptions.personnes = inscriptions.personnes.filter((x) => x.id !== pid)
    solution = null
  }
  function ajouterInstrument(pid: string) {
    const p = inscriptions.personnes.find((x) => x.id === pid)
    if (!p) return
    p.instruments.push({ pupitre: 'chant' })
    solution = null
  }
  function supprimerInstrument(pid: string, i: number) {
    const p = inscriptions.personnes.find((x) => x.id === pid)
    if (!p) return
    p.instruments.splice(i, 1)
    solution = null
  }

  /* --- Édition Indispos personnes ---------------------------------------- */

  function ajouterIndispo(pid: string) {
    const p = inscriptions.personnes.find((x) => x.id === pid)
    if (!p) return
    p.indispos.push({
      jours: [],
      debut: '09:00',
      fin: undefined,
      roles: [],
      motif: '',
    })
    solution = null
  }
  function supprimerIndispo(pid: string, i: number) {
    const p = inscriptions.personnes.find((x) => x.id === pid)
    if (!p) return
    p.indispos.splice(i, 1)
    solution = null
  }
  const nbIndispoTotal = $derived(
    inscriptions.personnes.reduce((s, p) => s + p.indispos.length, 0),
  )
  const nbPersonnesLibres = $derived(
    inscriptions.personnes.filter(
      (p) => !inscriptions.groupes.some((g) => g.membres.some((m) => m.personne_id === p.id)),
    ).length,
  )
  const personnesAvecIndispo = $derived(inscriptions.personnes.filter((p) => p.indispos.length > 0))
  const personnesSansIndispo = $derived(
    inscriptions.personnes.filter((p) => p.indispos.length === 0),
  )

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

  <Source
    {sourceLabel}
    {erreurImport}
    {warningsImport}
    onNouvelleSession={nouvelleSessionVide}
    onUtiliserDemo={utiliserDemo}
    onImporterXlsx={importerFichier}
    onImporterStagiaires={importerStagiaires}
    onImporterJson={importerEtat}
    onExporterJson={exporterEtat}
  />

  <PersonnesEdit
    {inscriptions}
    {lieu}
    {nbPersonnesLibres}
    onAjouterPersonne={ajouterPersonne}
    onSupprimerPersonne={supprimerPersonne}
    onAjouterInstrument={ajouterInstrument}
    onSupprimerInstrument={supprimerInstrument}
    onInvalider={() => (solution = null)}
  />

  <InscriptionsEdit
    {inscriptions}
    {session}
    {personnesParId}
    onAjouterGroupe={ajouterGroupe}
    onSupprimerGroupe={supprimerGroupe}
    onRetirerMembre={retirerMembre}
    onInvalider={() => (solution = null)}
  />

  <IndisposEdit
    {personnesAvecIndispo}
    {personnesSansIndispo}
    {nbIndispoTotal}
    onAjouterIndispo={ajouterIndispo}
    onSupprimerIndispo={supprimerIndispo}
    onInvalider={() => (solution = null)}
  />

  <ImposesEdit
    {inscriptions}
    {personnesParId}
    onAjouterImpose={ajouterImpose}
    onSupprimerImpose={supprimerImpose}
    onAjouterSeance={ajouterSeance}
    onSupprimerSeance={supprimerSeance}
    onInvalider={() => (solution = null)}
  />

  <LieuEdit
    {lieu}
    onAjouterSalle={ajouterSalle}
    onSupprimerSalle={supprimerSalle}
    onAjouterRestriction={ajouterRestriction}
    onSupprimerRestriction={supprimerRestriction}
    onInvalider={() => (solution = null)}
  />

  <SessionEdit
    {session}
    nbCreneaux={creneaux.length}
    onAjouterRegle={ajouterRegle}
    onSupprimerRegle={supprimerRegle}
    onInvalider={() => (solution = null)}
  />

  <Contraintes
    {contraintesActives}
    libelles={LIBELLE_CONTRAINTE}
    onToggle={(id, actif) => (contraintesActives = { ...contraintesActives, [id]: actif })}
    onReplace={(nouv) => {
      contraintesActives = nouv
      solution = null
    }}
  />

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
    <label class="check" style="max-width:none;border:none;margin:8px 0 12px">
      <input type="checkbox" bind:checked={filtrerPasse} />
      <span>Ne pas placer de répétitions dans le passé (recalcul en cours de session)</span>
    </label>
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
              <b>{d.titre}</b> — {d.obtenu}/{d.cible} répétitions restantes,
              seulement <b>{d.creneaux_ouverts}</b> créneaux compatibles sur {creneaux.length}.
              {#if d.repetitions_deja_faites > 0}
                <span class="badge" style="margin-left:6px">{d.repetitions_deja_faites} déjà fait(es)</span>
              {/if}
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
                  {/if}. Le remplacer ici, ou accepter {Math.max(0, d.cible - 1)} répétitions supplémentaires, débloque la situation.
                </span>
              {:else if d.repetitions_deja_faites > 0}
                <br /><span class="ink-soft">
                  Ce groupe a déjà commencé ses répétitions — modifier sa composition
                  n'est plus une option. Leviers possibles : accepter que les {d.cible} répétitions
                  restantes ne soient pas toutes placées (voir le minimum acceptable), libérer
                  des créneaux ailleurs (dégeler des figées, retirer un imposé), ou insérer un
                  nouveau créneau dans la grille.
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
        <button class:actif={vue === 'concert'} onclick={() => (vue = 'concert')}>Concert</button>
        <button class:actif={vue === 'quotas'} onclick={() => (vue = 'quotas')}>Quotas</button>
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
        <ParGroupe
          {inscriptions}
          {creneaux}
          assignations={solution.assignations}
          {sallesParId}
          {creneauxParId}
          {estFigee}
          {toggleFigee}
          {demarrerDeplacement}
          {deplacementEnCours}
          {keyFigee}
          onAffecterRenfort={affecterRenfort}
        />
      {:else if vue === 'salles'}
        <ParSalle
          {lieu}
          {creneaux}
          assignations={solution.assignations}
          {groupesParId}
          {personnesParId}
          {estFigee}
          {toggleFigee}
          {deplacementEnCours}
          {demarrerDeplacement}
          {estCibleValide}
          {appliquerDeplacement}
          {keyFigee}
        />
      {:else if vue === 'quotas'}
        <Quotas
          {session}
          {inscriptions}
          {creneaux}
          deltas={deltasQuotas}
          onDelta={(pup, val) => (deltasQuotas = { ...deltasQuotas, [pup]: val })}
        />
      {:else if vue === 'concert'}
        <Concert
          ordre={ordreConducteur}
          {conducteurMinuté}
          {repartitionStyles}
          stats={statsConducteur(ordreConducteur)}
          {cdDebut}
          {cdDureeMorceau}
          {cdDureeChange}
          {cdDureeKit}
          onDebut={(v) => (cdDebut = v)}
          onDureeMorceau={(v) => (cdDureeMorceau = v)}
          onDureeChange={(v) => (cdDureeChange = v)}
          onDureeKit={(v) => (cdDureeKit = v)}
          onReordonnerAuto={reordonnerAuto}
          onDragStart={(i) => (dragIdx = i)}
          onDrop={dropOrdre}
          {dragIdx}
          {couleurStyle}
        />
      {:else if vue === 'carte'}
        <Carte
          {session}
          {lieu}
          {inscriptions}
          {creneaux}
          assignations={solution.assignations}
          {groupesParId}
          {sallesParId}
          {creneauxParId}
          {estFigee}
          {inspecteCase}
          onInspect={(v) => (inspecteCase = v)}
        />
      {:else}
        <ParMusicien
          {inscriptions}
          {creneaux}
          assignations={solution.assignations}
          {groupesParId}
          {sallesParId}
          {creneauxParId}
          {seuilChargeJour}
          onSeuilChange={(v) => (seuilChargeJour = v)}
        />
      {/if}
    </section>
  {/if}
</main>

<style>
  /* Styles UI globaux extraits dans src/app.css (importé par main.ts).
     Ce bloc reste vide pour éviter le scoping Svelte qui empêche les
     composants enfants (vues/*, edition/*) d'hériter des styles partagés. */
</style>
