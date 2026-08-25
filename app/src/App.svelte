<script lang="ts">
  import { genererCreneaux } from './domain/grille'
  import { parseLegacyInscriptions } from './domain/legacy'
  import { migrerInscriptions } from './domain/migrate'
  import type { Inscriptions } from './domain/model'
  import { Lieu, Session, libellePersonne } from './domain/model'
  import { attribuerSalles } from './engine/allocate-rooms'
  import { chargeParMusicien } from './engine/charge'
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
  let vue = $state<'groupes' | 'salles' | 'musiciens' | 'carte' | 'concert'>('groupes')
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

  <section class="sheet">
    <p class="eyebrow">Étape 1 · Source</p>
    <h2>Inscriptions</h2>
    <p class="hint">
      Lecture directe de l'onglet <code>Liste</code> du classeur Excel de l'association,
      ou du jeu de démonstration.
    </p>
    <div class="toolbar">
      <button class="ghost" onclick={nouvelleSessionVide}>Nouvelle session (garde le lieu)</button>
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
      <p class="eyebrow">Étape 1a · Personnes</p>
      <h2>{inscriptions.personnes.length} personne(s) — dont {nbPersonnesLibres} sans engagement</h2>
      <p class="hint">
        Musiciens et chanteurs du stage. Un stagiaire sans groupe reste utilisable
        comme renfort quand un groupe cherche son pupitre.
      </p>
    </summary>
    <div class="body">
      <table>
        <thead>
          <tr>
            <th style="width:180px">Nom</th>
            <th style="width:100px">Discriminant</th>
            <th>Instruments</th>
            <th style="width:110px">Rôle</th>
            <th style="width:70px">Groupes</th>
            <th style="width:40px"></th>
          </tr>
        </thead>
        <tbody>
          {#each inscriptions.personnes as p}
            {@const nGroupes = inscriptions.groupes.filter((g) => g.membres.some((m) => m.personne_id === p.id)).length}
            <tr>
              <td><input bind:value={p.nom} /></td>
              <td><input bind:value={p.discriminant} placeholder="(B), R., L…" /></td>
              <td>
                {#each p.instruments as ins, ii}
                  <span class="chip">
                    <select bind:value={ins.pupitre} style="border:none;background:transparent;font-size:12.5px">
                      {#each lieu.pupitres as pup}
                        <option value={pup}>{pup}</option>
                      {/each}
                    </select>
                    <input bind:value={ins.precision} placeholder="précision" style="width:100px;font-size:11px" />
                    <button class="mini" onclick={() => supprimerInstrument(p.id, ii)}>×</button>
                  </span>
                {/each}
                <button class="ghost mini-ajout" onclick={() => ajouterInstrument(p.id)}>+ instrument</button>
              </td>
              <td>
                <select bind:value={p.role}>
                  <option value="musicien">musicien</option>
                  <option value="chanteur">chanteur</option>
                  <option value="intervenant">intervenant</option>
                </select>
                {#if p.instruments.some((i) => i.pupitre === 'batterie')}
                  <select
                    value={p.lateralite ?? ''}
                    onchange={(e) => {
                      const v = (e.currentTarget as HTMLSelectElement).value
                      p.lateralite = v === '' ? undefined : (v as 'droitier' | 'gaucher')
                      solution = null
                    }}
                    style="margin-top:4px;font-size:11px"
                    title="Latéralité (batteurs) — détermine les inversions de kit au concert"
                  >
                    <option value="">latéralité ?</option>
                    <option value="droitier">droitier</option>
                    <option value="gaucher">gaucher</option>
                  </select>
                {/if}
              </td>
              <td class="center mono">
                {nGroupes}
                {#if nGroupes === 0}<span class="tag-libre">libre</span>{/if}
              </td>
              <td class="center"><button class="mini" onclick={() => supprimerPersonne(p.id)}>×</button></td>
            </tr>
          {/each}
        </tbody>
      </table>
      <button class="ghost" onclick={ajouterPersonne}>+ Ajouter une personne</button>
    </div>
  </details>

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
            <th style="width:200px">Titre</th>
            <th style="width:110px">Resp.</th>
            <th style="width:90px">Style</th>
            <th style="width:55px">Tona</th>
            <th>Membres</th>
            <th style="width:65px" title="Répétitions déjà effectuées">Déjà fait</th>
            <th style="width:40px"></th>
          </tr>
        </thead>
        <tbody>
          {#each inscriptions.groupes as g, i}
            <tr>
              <td class="mono">{i + 1}</td>
              <td><input bind:value={g.titre} /></td>
              <td><input bind:value={g.responsable_id} /></td>
              <td><input bind:value={g.style} /></td>
              <td><input bind:value={g.tonalite} /></td>
              <td>
                {#each g.membres as m, mi}
                  {@const p = personnesParId.get(m.personne_id)}
                  <span class="chip">
                    {p ? libellePersonne(p) : m.personne_id}
                    <em>{m.pupitre}{m.precision ? ` · ${m.precision}` : ''}</em>
                    <button
                      class="mini"
                      onclick={() => retirerMembre(g.id, mi)}
                      title="Retirer ce membre du groupe"
                    >×</button>
                  </span>
                {/each}
                {#if g.postes_cherches.length > 0}
                  {#each g.postes_cherches as pup}
                    <span class="badge">cherche {pup}</span>
                  {/each}
                {/if}
              </td>
              <td class="center"><input type="number" min="0" max={session.repetitions_visees} bind:value={g.repetitions_deja_faites} style="width:60px" /></td>
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
      <p class="eyebrow">Étape 1d · Indisponibilités déclarées</p>
      <h2>{nbIndispoTotal} règle(s) d'indisponibilité</h2>
      <p class="hint">
        Créneaux où une personne ne peut pas être placée. Un rôle (chant, piano…)
        restreint la règle à ce pupitre uniquement — utile pour un chanteur qui suit
        un atelier de chant à 9h mais reste disponible pour son autre instrument.
      </p>
    </summary>
    <div class="body">
      {#each personnesAvecIndispo as p}
        <div class="impose-bloc">
          <div class="impose-titre">
            <span class="strong">{libellePersonne(p)}</span>
            <span class="mono ink-soft">{p.indispos.length} règle(s)</span>
            <button class="ghost mini-ajout" onclick={() => ajouterIndispo(p.id)}>+ règle</button>
          </div>
          {#each p.indispos as ind, i}
            <div class="restr">
              <input
                value={ind.jours.join(', ')}
                oninput={(e) => {
                  ind.jours = (e.currentTarget as HTMLInputElement).value
                    .split(/[,;\s]+/)
                    .map((s) => s.trim())
                    .filter(Boolean)
                  solution = null
                }}
                placeholder="jours ISO (vide = tous)"
                style="flex:1;min-width:150px"
              />
              <input type="time" bind:value={ind.debut} placeholder="début" />
              <span>→</span>
              <input
                type="time"
                value={ind.fin ?? ''}
                oninput={(e) => {
                  const v = (e.currentTarget as HTMLInputElement).value
                  ind.fin = v || undefined
                  solution = null
                }}
                placeholder="fin (vide = match exact)"
              />
              <input
                value={ind.roles.join(', ')}
                oninput={(e) => {
                  ind.roles = (e.currentTarget as HTMLInputElement).value
                    .split(/[,;\s]+/)
                    .map((s) => s.trim().toLowerCase())
                    .filter(Boolean)
                  solution = null
                }}
                placeholder="rôles (chant, piano… vide = tous)"
                style="flex:1;min-width:120px"
              />
              <input bind:value={ind.motif} placeholder="motif" style="flex:1;min-width:120px" />
              <button class="mini" onclick={() => supprimerIndispo(p.id, i)}>×</button>
            </div>
          {/each}
        </div>
      {/each}
      {#if personnesSansIndispo.length > 0}
        <details class="renforts" style="margin-top:14px">
          <summary>
            <span class="mono ink-soft">Ajouter une indispo à une personne sans règle ({personnesSansIndispo.length})</span>
          </summary>
          <div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">
            {#each personnesSansIndispo as p}
              <button class="ghost mini-ajout" onclick={() => ajouterIndispo(p.id)}>
                {libellePersonne(p)}
              </button>
            {/each}
          </div>
        </details>
      {/if}
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
        <label>
          Marge d'occupation ({session.marge_pct}%)
          <input type="range" min="0" max="50" step="5" bind:value={session.marge_pct} />
        </label>
      </div>
      <p class="hint" style="margin:6px 0 0;font-size:12.5px">
        <b>Marge {session.marge_pct}%</b> — le solveur ne remplira pas plus de
        {100 - session.marge_pct}% des salles disponibles à chaque créneau. À 0%,
        il peut saturer à 100% (moins de tolérance aux imprévus).
      </p>
      <h3>Grille de créneaux</h3>
      <p class="hint">
        Chaque règle génère des créneaux sur les jours ciblés (colonne <b>Jours</b> —
        vide = tous les jours de la session). Accepte des dates ISO (<code>2026-08-26</code>)
        ou des noms de jour FR (<code>mercredi</code>, <code>lundi</code>…).
        « Bloque » retire les créneaux qui tombent dans la plage. Pour minuit, saisis
        <code>24:00</code> plutôt que <code>00:00</code> (mieux compris par le solveur).
      </p>
      <table>
        <thead>
          <tr>
            <th>Jours (ISO, CSV)</th>
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
              <td>
                <input
                  value={regle.jours.join(', ')}
                  oninput={(e) => {
                    regle.jours = (e.currentTarget as HTMLInputElement).value
                      .split(/[,;\s]+/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                    solution = null
                  }}
                  placeholder="tous les jours"
                />
              </td>
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
                  {#if g.postes_cherches.length > 0}
                    {@const suggestions = suggererRenforts(g, inscriptions, creneaux, solution.assignations)}
                    <details class="renforts">
                      <summary>
                        <span class="badge">cherche {g.postes_cherches.join(', ')}</span>
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
                                  onclick={() => affecterRenfort(g.id, s.personne_id, pup)}
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
      {:else if vue === 'concert'}
        {@const stats = statsConducteur(ordreConducteur)}
        <div class="toolbar" style="margin-bottom:14px">
          <button class="ghost" onclick={reordonnerAuto}>Recalculer l'ordre optimal</button>
          <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;font-size:12.5px;letter-spacing:0;font-weight:400">
            <span>Début</span>
            <input type="time" bind:value={cdDebut} style="width:100px" />
          </label>
          <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;font-size:12.5px;letter-spacing:0;font-weight:400">
            <span>Durée / morceau</span>
            <input type="number" min="1" max="30" bind:value={cdDureeMorceau} style="width:60px" />
            <span class="mono">min</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;font-size:12.5px;letter-spacing:0;font-weight:400">
            <span>Changement plateau</span>
            <input type="number" min="0" max="15" bind:value={cdDureeChange} style="width:60px" />
            <span class="mono">min</span>
          </label>
          <label style="display:flex;align-items:center;gap:6px;margin:0;text-transform:none;font-size:12.5px;letter-spacing:0;font-weight:400">
            <span>Inversion kit</span>
            <input type="number" min="0" max="30" bind:value={cdDureeKit} style="width:60px" />
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
          Glisse-dépose les lignes pour réordonner à la main. Chaque étape affiche son
          heure de début. Les changements de plateau sont intercalés automatiquement.
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
              ondragstart={() => (dragIdx = i)}
              ondragover={(e) => e.preventDefault()}
              ondrop={(e) => { e.preventDefault(); dropOrdre(i) }}
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
        {@const chargeMap = chargeParMusicien(inscriptions, creneaux, solution.assignations)}
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
        {@const surcharges = [...chargeMap.values()].filter((c) => c.max_jour > seuilChargeJour)}
        <div class="toolbar" style="margin-bottom:12px">
          <label class="line" style="margin:0;display:flex;align-items:center;gap:8px">
            <span>Seuil charge / jour</span>
            <input type="number" min="1" max="12" bind:value={seuilChargeJour} style="width:70px" />
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
            {#each [...inscriptions.personnes].sort((a, b) => libellePersonne(a).localeCompare(libellePersonne(b), 'fr')) as p}
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
  .chip.libre {
    background: #e8f1ea;
    border-color: #bbd5c3;
    border-left-color: var(--vert);
  }
  .tag-libre {
    background: var(--vert);
    color: white;
    padding: 1px 6px;
    border-radius: 2px;
    font-size: 10px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-weight: 600;
    font-style: normal;
    font-family: var(--mono);
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
  tr.surcharge td { background: #f8e6e3; }
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
  details.renforts {
    display: inline-block;
    margin: 0 0 8px;
    padding: 4px 8px;
    background: rgba(200, 135, 31, 0.08);
    border-radius: 3px;
  }
  details.renforts summary {
    list-style: none;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 12.5px;
  }
  details.renforts summary::-webkit-details-marker { display: none; }
  .badge {
    display: inline-block;
    font-family: var(--mono);
    font-size: 10.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    padding: 2px 8px;
    background: #f8eeda;
    color: #8a5c11;
    border: 1px solid #e6d2a6;
    border-radius: 2px;
    font-weight: 600;
  }
  /* Conducteur du concert */
  ol.conducteur {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  ol.conducteur li {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 14px;
    margin: 0 0 4px;
    background: #f7f5ec;
    border-left: 3px solid var(--ochre);
    border-radius: 0 2px 2px 0;
    cursor: grab;
    user-select: none;
  }
  ol.conducteur li:active { cursor: grabbing; }
  ol.conducteur li.dragging { opacity: 0.4; }
  ol.conducteur li:hover { background: #f0eddf; }
  ol.conducteur li.marker {
    background: transparent;
    border-left: none;
    padding: 4px 20px;
    cursor: default;
    justify-content: center;
  }
  ol.conducteur li.marker:hover { background: transparent; }
  .repart-styles {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin: 8px 0 4px;
  }
  .chip-style {
    display: inline-block;
    padding: 2px 10px;
    border-radius: 12px;
    font-size: 12px;
    font-weight: 600;
    color: #1a211d;
    line-height: 1.5;
  }
  .chip-style em {
    font-style: normal;
    font-weight: 400;
    font-family: var(--mono);
    font-size: 11px;
    color: rgba(26, 33, 29, 0.7);
    margin-left: 6px;
  }
  ol.conducteur .num {
    font-family: var(--serif);
    font-size: 24px;
    color: var(--ochre);
    width: 30px;
    text-align: center;
  }
  ol.conducteur .heure {
    font-size: 14px;
    font-weight: 600;
    color: var(--ink);
    min-width: 55px;
    padding: 2px 6px;
    background: white;
    border-radius: 2px;
  }
  ol.conducteur .corps { flex: 1; display: flex; align-items: center; gap: 10px; }
  ol.conducteur .mouvements { font-size: 12px; white-space: nowrap; }
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
