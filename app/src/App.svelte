<script lang="ts">
  import { genererCreneaux } from './domain/grille'
  import { parseLegacyInscriptions } from './domain/legacy'
  import { migrerInscriptions } from './domain/migrate'
  import type { Inscriptions } from './domain/model'
  import {
    Lieu,
    Session,
    libellePersonne,
    nouvelIdGroupe,
    nouvelIdImpose,
    nouvelIdPersonne,
    nouvelIdSalle,
  } from './domain/model'
  import { attribuerSalles } from './engine/allocate-rooms'
  import { chargeParMusicien } from './engine/charge'
  import Contraintes from './edition/Contraintes.svelte'
  import ImposesEdit from './edition/Imposes.svelte'
  import IndisposEdit from './edition/Indispos.svelte'
  import InscriptionsEdit from './edition/Inscriptions.svelte'
  import LieuEdit from './edition/Lieu.svelte'
  import PersonnesEdit from './edition/Personnes.svelte'
  import SessionEdit from './edition/Session.svelte'
  import EcranRelectureIdentites from './edition/EcranRelectureIdentites.svelte'
  import ImportUnique from './edition/ImportUnique.svelte'
  import { analyserIdentitesCandidat, type AnalyseIdentitesImport } from './io/alertes-import'
  import MiseAJourBandeau from './edition/MiseAJourBandeau.svelte'
  import PiedDePage from './edition/PiedDePage.svelte'
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
  import { preparerInscriptionsPourSolveur } from './engine/fonctions-activees'
  import { enrichirIndispos } from './engine/imposes'
  import { ciblesValides } from './engine/manuel'
  import { suggererRenforts } from './engine/renforts'
  import { repartir } from './engine/solver'
  import type { Assignation, GroupeSansSalle, Probleme } from './engine/types'
  import { couverture, verifier } from './engine/verify'
  import { csvParGroupe, csvParMusicien, csvParSalle, telechargerCsv } from './io/csv'
  import { exporterClasseurExcel } from './io/excel-export'
  import { genererTemplateXlsx } from './io/excel-template'
  import {
    bilanExcel,
    construireCandidatExcel,
    construireCandidatJson,
    preparerImportExcel,
    preparerImportJson,
  } from './io/import-detection'
  import type { BilanImport, Detection, DetectionExcel, SelectionExcel } from './io/import-detection'
  import { MAPPING_LISTE_DEFAUT } from './io/liste-adapter'
  import { MAPPING_PROPOSES_DEFAUT } from './io/proposes-adapter'
  import { MAPPING_STAGIAIRES_DEFAUT } from './io/stagiaires-adapter'
  import { CONTRAINTES_ACTIVES_DEFAUT, LIBELLE_CONTRAINTE } from './stores/app-config'
  import {
    calculerConducteurMinuté,
    calculerRepartitionStyles,
    couleurStyle,
    statsConducteur,
  } from './stores/app-conducteur'
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

  function chargerDemo(): Inscriptions {
    return migrerInscriptions(parseLegacyInscriptions(fixture), session.id)
  }

  function inscriptionsVides(): Inscriptions {
    return { session_id: session.id, personnes: [], groupes: [], imposes: [] }
  }

  /**
   * Amorçage par URL : `?demo=apero` charge le jeu d'essai + active la
   * bannière permanente « prénoms fictifs ». Sans le paramètre, l'app
   * démarre vide — l'utilisateur importe son propre classeur. Le bouton
   * « Recharger la démo » de l'Étape 1 reste l'échappatoire.
   *
   * Cette lecture d'URL se fait une seule fois, à l'initialisation du
   * script — elle n'est pas réactive à un changement d'URL en cours de
   * session (l'app n'est pas SPA-router).
   */
  function initialDemo(): boolean {
    if (typeof window === 'undefined' || !window.location) return false
    return new URLSearchParams(window.location.search).get('demo') === 'apero'
  }

  /* --- État réactif ----------------------------------------------------- */

  const _demoInit = initialDemo()
  let inscriptions = $state<Inscriptions>(_demoInit ? chargerDemo() : inscriptionsVides())
  let modeDemo = $state<boolean>(_demoInit)
  let sourceLabel = $state<string>(
    _demoInit ? 'démo · apero_mercredi.json (via ?demo=apero)' : 'session vide',
  )
  let warningsImport = $state<string[]>([])
  let erreurImport = $state<string>('')
  // Import unique (brief « import unique pour l'étape 1 ») — état des
  // écrans du composant ImportUnique. `detection` bascule vers l'écran 2
  // dès qu'un fichier est lu ; `bilan` vers l'écran 4 après application.
  let detection = $state<Detection | null>(null)
  let bilan = $state<BilanImport | null>(null)
  let chargementImport = $state<boolean>(false)

  type Solution = {
    assignations: Assignation[]
    problemes: Probleme[]
    couverture: Array<{ groupe_id: string; obtenu: number; cible: number; min: number }>
    diagnostics: ReturnType<typeof diagnostiquer>
    groupesPerdus: GroupeSansSalle[]
    duree_ms: number
    arret_precoce: 'complet' | 'max-essais' | 'budget' | 'stagnation'
    essais_executes: number
  }
  /**
   * Budget wall-clock du solveur — par défaut 3000 ms (garde-fou anti-gel
   * Chrome, task #51). L'utilisateur peut l'étendre via le bouton
   * « relancer plus longtemps » qui passe à Infinity — opt-in explicite
   * qui accepte le gel possible pour un calcul plus poussé.
   */
  let budgetMsCourant = $state<number>(3000)
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
  let contraintesActives = $state<Record<IdContrainte, boolean>>({ ...CONTRAINTES_ACTIVES_DEFAUT })

  const creneaux = $derived.by(() => {
    try {
      return genererCreneaux(session, lieu, { maintenant: filtrerPasse ? new Date() : undefined })
    } catch {
      return []
    }
  })
  const infaisabilites = $derived.by(() => {
    try {
      return analyserInfaisabilite(session, preparerInscriptionsPourSolveur(inscriptions, lieu), creneaux)
    } catch {
      return []
    }
  })
  const groupesParId = $derived(new Map(inscriptions.groupes.map((g) => [g.id, g])))
  const personnesParId = $derived(new Map(inscriptions.personnes.map((p) => [p.id, p])))
  const creneauxParId = $derived(new Map(creneaux.map((c) => [c.id, c])))
  const sallesParId = $derived(new Map(lieu.salles.map((s) => [s.id, s])))

  // Repli auto quand la vue courante devient indisponible (fonction du lieu
  // désactivée). Sinon on afficherait un bouton disparu sur une vue vide.
  $effect(() => {
    if (vue === 'concert' && !lieu.fonctionsActivees.conducteur) vue = 'groupes'
    if (vue === 'quotas' && !lieu.fonctionsActivees.charge) vue = 'groupes'
  })

  /* --- Actions ---------------------------------------------------------- */

  function utiliserDemo() {
    inscriptions = chargerDemo()
    sourceLabel = 'démo · apero_mercredi.json'
    warningsImport = []
    erreurImport = ''
    solution = null
    modeDemo = true
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
    modeDemo = false
  }

  /**
   * Import unique — brief « import unique pour l'étape 1 ».
   *
   * Un seul handler `traiterFichier(file)` accepte `.xlsx` et `.json`,
   * détecte le contenu et pose une `Detection` dans le state. Le composant
   * ImportUnique affiche l'écran 2 (« Ce que contient ce fichier »)
   * automatiquement. `appliquerImportExcel/Json` fait l'application
   * effective en **une seule affectation** (défaut latent n°1 verrouillé).
   */
  async function traiterFichier(file: File) {
    warningsImport = []
    erreurImport = ''
    bilan = null
    chargementImport = true
    try {
      const nomLower = file.name.toLowerCase()
      if (nomLower.endsWith('.json')) {
        detection = await preparerImportJson(file)
      } else {
        detection = await preparerImportExcel(
          file,
          {
            liste: MAPPING_LISTE_DEFAUT,
            stagiaires: MAPPING_STAGIAIRES_DEFAUT,
            proposes: MAPPING_PROPOSES_DEFAUT,
          },
          inscriptions.personnes,
        )
      }
    } catch (err) {
      erreurImport = err instanceof Error ? err.message : String(err)
    } finally {
      chargementImport = false
    }
  }

  /**
   * État transitoire entre extraction xlsx et commit : un candidat
   * calculé + son analyse d'identités attend la validation humaine
   * dans l'écran de relecture (Sujet C PR4 wire). `null` = pas en
   * attente, flow normal.
   *
   * Doctrine « proposé, jamais appliqué » (Stéphane 2026-09-01) :
   * on ne modifie PAS `inscriptions` avant que l'humain n'ait vu
   * les alertes et confirmé. Ne pas court-circuiter cette étape même
   * si l'analyse est propre.
   */
  let importEnAttente = $state<{
    candidat: Inscriptions
    bilan: BilanImport
    sourceLabel: string
    analyse: AnalyseIdentitesImport
    detection: DetectionExcel
    sel: SelectionExcel
  } | null>(null)

  function appliquerImportExcel(sel: SelectionExcel) {
    if (detection?.type !== 'xlsx') return
    const candidat = construireCandidatExcel(detection, sel, inscriptions, session.id)
    const b = bilanExcel(detection, sel)
    // Analyse d'identités (Sujet C) : on ne commit pas encore — l'user
    // valide via EcranRelectureIdentites. Franchissable en 1 clic si
    // 0 alerte (blocage vient du contenu, pas de la mécanique).
    importEnAttente = {
      candidat,
      bilan: b,
      sourceLabel: `${detection.nomFichier} — ${b.onglets_appliques.length} onglet(s) appliqué(s)`,
      analyse: analyserIdentitesCandidat(candidat),
      detection,
      sel,
    }
  }

  function validerRelectureIdentites() {
    if (!importEnAttente) return
    const { candidat, bilan: b, sourceLabel: sl, detection: det, sel } = importEnAttente
    // Auto-activation Proposés (brief 4b) — même logique qu'avant
    // wire, calculée ici au moment du commit
    const aAppliqueProposes = [...sel.ongletsCoches].some((nom) => {
      const o = det.onglets.find((x) => x.nom === nom)
      return o?.destination === 'proposes' && o.statut === 'ok'
    })
    if (aAppliqueProposes && !lieu.fonctionsActivees.proposes) {
      lieu.fonctionsActivees.proposes = true
    }
    inscriptions = candidat
    bilan = b
    warningsImport = b.warnings
    sourceLabel = sl
    solution = null
    modeDemo = false
    detection = null
    importEnAttente = null
  }

  function annulerRelectureIdentites() {
    // Retour à l'écran de sélection — le detection reste, l'user peut
    // ajuster sa sélection ou changer de fichier.
    importEnAttente = null
  }

  function appliquerImportJson() {
    if (detection?.type !== 'json') return
    const patch = construireCandidatJson(detection, session.id)
    if (patch.lieu) {
      const parsed = Lieu.parse(patch.lieu)
      Object.assign(lieu, parsed)
      lieu.salles.splice(0, lieu.salles.length, ...parsed.salles)
    }
    if (patch.session) {
      const parsed = Session.parse(patch.session)
      Object.assign(session, parsed)
      session.grille.splice(0, session.grille.length, ...parsed.grille)
    }
    if (patch.inscriptions) inscriptions = patch.inscriptions
    if (patch.contraintesActives) {
      contraintesActives = {
        ...contraintesActives,
        ...(patch.contraintesActives as Record<IdContrainte, boolean>),
      }
    }
    sourceLabel = `JSON · ${detection.nomFichier}`
    warningsImport = detection.warningsGlobaux
    // Bilan simplifié pour JSON — pas de sélection, tout ou rien
    bilan = {
      onglets_appliques: [],
      onglets_ignores: [],
      warnings: detection.warningsGlobaux,
    }
    solution = null
    modeDemo = false
    detection = null
  }

  function annulerImport() {
    detection = null
    bilan = null
    erreurImport = ''
    warningsImport = []
  }

  async function telechargerTemplate() {
    erreurImport = ''
    try {
      await genererTemplateXlsx({
        liste: MAPPING_LISTE_DEFAUT,
        stagiaires: MAPPING_STAGIAIRES_DEFAUT,
        proposes: MAPPING_PROPOSES_DEFAUT,
      })
    } catch (err) {
      erreurImport = err instanceof Error ? err.message : String(err)
    }
  }

  function reordonnerAuto() {
    const r = ordonnerConcert(inscriptions.groupes)
    ordreConducteur = r.etapes
  }

  // Minutage + répartition styles : logique pure extraite dans `stores/app-conducteur.ts`
  // (audit Leader — dérivés critiques inline dans App.svelte).
  const conducteurMinuté = $derived(
    calculerConducteurMinuté(
      ordreConducteur,
      { debut: cdDebut, dureeMorceau: cdDureeMorceau, dureeChange: cdDureeChange, dureeKit: cdDureeKit },
      groupesParId,
      personnesParId,
    ),
  )
  const repartitionStyles = $derived(calculerRepartitionStyles(ordreConducteur))

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
    // Cascade fonctions activées → solveur : quand `lieu.fonctionsActivees.proposes`
    // est décoché, les imposés sont retirés avant `enrichirIndispos` (sinon le
    // solveur poserait des contraintes invisibles côté UI, cf. brief §
    // « décoché doit signifier n'entre pas dans le calcul »).
    // Puis on enrichit les indispos des personnes avec les séances des
    // imposés restants, pour que le solveur les évite automatiquement.
    const inscFiltrees = preparerInscriptionsPourSolveur(inscriptions, lieu)
    const inscEnrichies = enrichirIndispos(inscFiltrees)
    const resRepartir = repartir(session, lieu, inscEnrichies, creneaux, {
      seed: 42,
      registre,
      figees,
      budgetMs: budgetMsCourant,
    })
    const { placement } = resRepartir
    const { assignations, groupesPerdus } = attribuerSalles(
      placement,
      lieu,
      inscEnrichies,
      creneaux,
      { figees, registre },
    )
    const problemes = verifier(session, lieu, inscEnrichies, creneaux, assignations, registre)
    const cov = couverture(session, inscEnrichies, assignations)
    const diagnostics = diagnostiquer(session, inscFiltrees, creneaux, placement)
    solution = {
      assignations,
      problemes,
      couverture: cov,
      diagnostics,
      groupesPerdus,
      duree_ms: Math.round(performance.now() - t0),
      arret_precoce: resRepartir.arret_precoce,
      essais_executes: resRepartir.essais_executes,
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


  /* --- Édition Lieu ------------------------------------------------------ */

  function ajouterSalle() {
    lieu.salles.push({
      id: nouvelIdSalle(),
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
      id: nouvelIdGroupe(),
      titre: 'Nouveau morceau',
      auteur: '',
      style: '',
      tonalite: '',
      responsable_id: '',
      membres: [],
      postes_cherches: [],
      repetitions_deja_faites: 0,
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
      id: nouvelIdPersonne(),
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
    p.instruments.push({ pupitre: 'chant', lourd: false })
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
      id: nouvelIdImpose(),
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
    const cibles = ciblesValides(
      deplacementEnCours!,
      g,
      lieu,
      preparerInscriptionsPourSolveur(inscriptions, lieu),
      creneaux,
      autres,
      { date: session.date_butoir, heure: session.butoir_heure },
    )
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
    // (même cascade fonctionsActivees que dans `lancer()`).
    const problemes = verifier(
      session,
      lieu,
      enrichirIndispos(preparerInscriptionsPourSolveur(inscriptions, lieu)),
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
      const cibles = ciblesValides(
        fictif,
        g,
        lieu,
        preparerInscriptionsPourSolveur(inscriptions, lieu),
        creneaux,
        autres,
        { date: session.date_butoir, heure: session.butoir_heure },
      )
      if (cibles.some((x) => x.creneau.id === inspecteCase!.creneauId && x.salle_id === inspecteCase!.salleId)) {
        out.push({ groupe_id: g.id, titre: g.titre })
      }
    }
    return out
  })

  /**
   * Ajoute manuellement une séance depuis la vue Carte (msg Stéphane 5593).
   * L'user clique sur une case libre → panneau candidats → clic sur un
   * groupe = crée une nouvelle assignation figée sur cette case.
   *
   * La séance est figée automatiquement (`figeesKeys.add`) pour que le
   * prochain `lancer()` du solveur ne la déplace pas — c'est un choix
   * délibéré de l'user, pas une suggestion d'optimisation.
   *
   * Recalcule ensuite verifier + couverture pour rafraîchir l'affichage
   * (nouvelle séance = potentiels nouveaux problèmes / couverture élargie).
   */
  function ajouterSeanceDepuisCarte(groupe_id: string, creneau_id: string, salle_id: string) {
    if (!solution) return
    // Idempotence : si l'assignation existe déjà (case déjà occupée par ce
    // groupe), on ne l'ajoute pas 2 fois — la fige juste si pas déjà figée.
    const cle = `${groupe_id}|${creneau_id}`
    const existe = solution.assignations.some(
      (a) => a.groupe_id === groupe_id && a.creneau_id === creneau_id && a.salle_id === salle_id,
    )
    if (!existe) {
      solution.assignations = [
        ...solution.assignations,
        { groupe_id, creneau_id, salle_id },
      ]
    }
    if (!figeesKeys.has(cle)) {
      const next = new Set(figeesKeys)
      next.add(cle)
      figeesKeys = next
    }
    const problemes = verifier(
      session,
      lieu,
      enrichirIndispos(preparerInscriptionsPourSolveur(inscriptions, lieu)),
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
    inspecteCase = null // ferme le panneau candidats après affectation
  }
</script>

<main>
  {#if modeDemo}
    <div class="banniere-demo" role="status">
      <strong>Jeu d'essai chargé</strong> — les prénoms sont fictifs, la structure est
      celle d'une vraie session (polyvalences, homonymes, indispos par rôle). Utilisez
      « Nouvelle session (garde le lieu) » pour repartir de zéro avec votre vrai groupe.
    </div>
  {/if}
  <header>
    <p class="eyebrow">Balance · V1</p>
    <h1>Qui répète <em>où</em>, et <em>quand</em></h1>
    <p class="hint">
      Répartition automatique des répétitions d'un stage de musique — équilibre entre
      musiciens, groupes et salles. {inscriptions.groupes.length} groupes,
      {inscriptions.personnes.length} musiciens, {creneaux.length} créneaux avant butoir du {session.date_butoir}.
    </p>
  </header>

  {#if importEnAttente}
    <!-- Étape intermédiaire Sujet C : relecture des identités avant
         commit. Franchissable en 1 clic si 0 alerte (blocage vient
         du contenu, pas de la mécanique). -->
    <EcranRelectureIdentites
      analyse={importEnAttente.analyse}
      onValider={validerRelectureIdentites}
      onAnnuler={annulerRelectureIdentites}
    />
  {:else}
    <ImportUnique
      {sourceLabel}
      {detection}
      {bilan}
      {erreurImport}
      {warningsImport}
      chargementEnCours={chargementImport}
      onFichier={traiterFichier}
      onImporterExcel={appliquerImportExcel}
      onImporterJson={appliquerImportJson}
      onAnnuler={annulerImport}
      onUtiliserDemo={utiliserDemo}
      onNouvelleSession={nouvelleSessionVide}
      onTelechargerTemplate={telechargerTemplate}
    />
  {/if}

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
    nbProposesEnMemoire={inscriptions.imposes.length}
    nbPersonnesDeclarees={inscriptions.personnes.length}
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
      {@const manquantsTotal = infaisabilites.reduce((s, d) => s + Math.max(0, d.demande - d.offre), 0)}
      <div class="msg warn">
        <b>Contrôle en amont : {infaisabilites.length} musicien(s) en surcharge structurelle.</b>
        <p class="mini-h">
          Chacun ci-dessous demande plus de créneaux qu'il n'en a de disponibles
          ({manquantsTotal} créneau{manquantsTotal > 1 ? 'x' : ''} manquant{manquantsTotal > 1 ? 's' : ''}
          au total sur l'ensemble des musiciens signalés).
          <strong>Lancer maintenant produira un placement partiel — c'est prévu, pas un bug.</strong>
          Réduire leurs engagements ou libérer des créneaux avant permet d'atteindre
          un placement complet.
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
        <div>
          <b>{solution.duree_ms} ms</b> de calcul
          <span class="ink-soft">({solution.essais_executes} essai{solution.essais_executes > 1 ? 's' : ''})</span>
        </div>
        <div><b>{solution.problemes.length}</b> problème(s) détecté(s)</div>
      </div>
      {#if solution.arret_precoce !== 'complet'}
        {@const nComplets = solution.couverture.filter((c) => c.obtenu >= c.cible).length}
        {@const nTotal = inscriptions.groupes.length}
        {@const nManquants = nTotal - nComplets}
        <div class="msg warn">
          {#if solution.arret_precoce === 'budget'}
            <b>Calcul interrompu à {Math.round(budgetMsCourant / 1000)} s pour ne pas geler l'écran.</b>
            {nComplets}/{nTotal} groupes complets après {solution.essais_executes}
            essai{solution.essais_executes > 1 ? 's' : ''}. Le solveur n'a pas exploré
            toutes les combinaisons.
            <button
              class="ghost mini-ajout"
              onclick={() => { budgetMsCourant = Infinity; lancer() }}
              disabled={calculEnCours}
            >
              Relancer sans limite de temps
            </button>
          {:else if solution.arret_precoce === 'stagnation'}
            <b>{nManquants > 0 ? `${nManquants} groupe${nManquants > 1 ? 's non placés' : ' non placé'}` : 'Optimum atteint'}
              après {solution.essais_executes} essais sans progrès.</b>
            {#if nManquants > 0}
              Le solveur a plafonné à {nComplets}/{nTotal} — probablement un ou
              plusieurs groupes structurellement infaisables (voir « Pourquoi ça
              bloque » ci-dessous et le contrôle en amont).
            {:else}
              Solution complète trouvée, essais supplémentaires jugés inutiles.
            {/if}
          {:else if solution.arret_precoce === 'max-essais'}
            <b>{nManquants} groupe{nManquants > 1 ? 's non placés' : ' non placé'}
              après épuisement des {solution.essais_executes} essais.</b>
            Le solveur a plafonné à {nComplets}/{nTotal} — voir le diagnostic
            « Pourquoi ça bloque » ci-dessous pour identifier ce qui bloque.
          {/if}
        </div>
      {/if}
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
      {#if solution.groupesPerdus && solution.groupesPerdus.length > 0}
        <div class="msg warn">
          <b>Groupes non logés :</b> {solution.groupesPerdus.length} groupe(s) placé(s) horairement
          mais l'attribution des salles n'a pas trouvé de place — jauge ou concurrence.
          <ul>
            {#each solution.groupesPerdus.slice(0, 8) as gp}<li>{gp.raison}</li>{/each}
            {#if solution.groupesPerdus.length > 8}
              <li>… et {solution.groupesPerdus.length - 8} autres</li>
            {/if}
          </ul>
        </div>
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
        {#if lieu.fonctionsActivees.conducteur}
          <button class:actif={vue === 'concert'} onclick={() => (vue = 'concert')}>Concert</button>
        {/if}
        {#if lieu.fonctionsActivees.charge}
          <button class:actif={vue === 'quotas'} onclick={() => (vue = 'quotas')}>Quotas</button>
        {/if}
        <span class="grow"></span>
        {#if figeesKeys.size > 0}
          <span class="mono ink-soft">{figeesKeys.size} figée{figeesKeys.size > 1 ? 's' : ''}</span>
          <button class="ghost" onclick={toutDegeler}>Tout dégeler</button>
        {/if}
        <button class="ghost" onclick={exporterGroupes}>CSV groupes</button>
        <button class="ghost" onclick={exporterSalles}>CSV salles</button>
        <button class="ghost" onclick={exporterMusiciens}>CSV musiciens</button>
        <button class="ghost" onclick={exporterXlsx}>Classeur .xlsx</button>
        <button class="ghost" onclick={exporterEtat}>Sauvegarder l'état .json</button>
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
          stats={statsConducteur(ordreConducteur, groupesParId)}
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
          onAffecterSeance={ajouterSeanceDepuisCarte}
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

<MiseAJourBandeau />

<PiedDePage />

<style>
  /* Styles UI globaux extraits dans src/app.css (importé par main.ts).
     Ce bloc reste vide pour éviter le scoping Svelte qui empêche les
     composants enfants (vues/*, edition/*) d'hériter des styles partagés. */
</style>
