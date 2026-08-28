<script lang="ts">
  import type {
    Detection,
    DetectionExcel,
    DestinationOnglet,
    OngletDetecte,
    SelectionExcel,
    BilanImport,
  } from '../io/import-detection'

  /**
   * Import unique — brief « import unique pour l'étape 1 ».
   *
   * Une seule porte d'entrée qui accepte `.xlsx` et `.json`. L'application
   * lit le fichier, annonce ce qu'elle y a trouvé, l'utilisateur décoche
   * ce qu'il ne veut pas, puis confirme.
   *
   * Machine d'état à 4 écrans :
   *   1. **depart**       — zone de dépôt + bouton principal + liens discrets
   *   2. **detection**    — « Ce que contient ce fichier » + sélection
   *   3. **confirmation** — bouton « Importer la sélection » (fondu dans écran 2)
   *   4. **resultat**     — bilan chiffré + warnings
   *
   * Machine externe : `detection` prop pilote l'écran (null → depart,
   * DetectionExcel/Json → detection, bilan !== null → resultat).
   */

  interface Props {
    sourceLabel: string
    detection: Detection | null
    bilan: BilanImport | null
    erreurImport: string
    warningsImport: string[]
    /** True pendant qu'un fichier est en cours de lecture (bouton grisé). */
    chargementEnCours: boolean
    onFichier: (file: File) => void
    onImporterExcel: (sel: SelectionExcel) => void
    onImporterJson: () => void
    onAnnuler: () => void
    onUtiliserDemo: () => void
    onNouvelleSession: () => void
    onTelechargerTemplate: () => void
  }
  let {
    sourceLabel,
    detection,
    bilan,
    erreurImport,
    warningsImport,
    chargementEnCours,
    onFichier,
    onImporterExcel,
    onImporterJson,
    onAnnuler,
    onUtiliserDemo,
    onNouvelleSession,
    onTelechargerTemplate,
  }: Props = $props()

  /* --- Sélection locale (écran détection) --- */

  let ongletsCoches = $state(new Set<string>())
  let destinationsManuelles = $state(new Map<string, DestinationOnglet>())
  let dragOver = $state(false)

  // Recalcule la sélection par défaut chaque fois qu'une nouvelle détection arrive.
  $effect(() => {
    if (detection?.type === 'xlsx') {
      ongletsCoches = new Set(
        detection.onglets.filter((o) => o.actifParDefaut).map((o) => o.nom),
      )
      destinationsManuelles = new Map()
    } else {
      ongletsCoches = new Set()
      destinationsManuelles = new Map()
    }
  })

  function toggleOnglet(nom: string) {
    const next = new Set(ongletsCoches)
    if (next.has(nom)) next.delete(nom)
    else next.add(nom)
    ongletsCoches = next
  }

  function setDestinationManuelle(nom: string, dest: DestinationOnglet | '') {
    const next = new Map(destinationsManuelles)
    if (dest === '') next.delete(nom)
    else next.set(nom, dest)
    destinationsManuelles = next
  }

  function confirmer() {
    if (!detection) return
    if (detection.type === 'xlsx') {
      onImporterExcel({ ongletsCoches, destinationsManuelles })
    } else {
      onImporterJson()
    }
  }

  /* --- File input + drag-drop --- */

  function onFileInput(e: Event) {
    const cible = e.target as HTMLInputElement
    const file = cible.files?.[0]
    if (file) onFichier(file)
    cible.value = ''
  }

  function onDrop(e: DragEvent) {
    e.preventDefault()
    dragOver = false
    const file = e.dataTransfer?.files?.[0]
    if (file) onFichier(file)
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    dragOver = true
  }

  function onDragLeave() {
    dragOver = false
  }

  /* --- Helpers formatage --- */

  function formatTaille(bytes: number): string {
    if (bytes < 1024) return `${bytes} o`
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`
    return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`
  }

  const DEST_LIBELLE: Record<DestinationOnglet, string> = {
    liste: 'Morceaux',
    stagiaires: 'Stagiaires',
    proposes: 'Concert du vendredi',
  }

  const EFFET_LIBELLE: Record<'remplace' | 'complete' | 'ignore', string> = {
    remplace: 'remplace',
    complete: 'complète',
    ignore: 'ignoré',
  }

  /** Effet effectif d'un onglet vu par l'utilisateur — un onglet non
   *  reconnu peut recevoir une destination manuelle et son effet devient
   *  celui de cette destination. */
  function effetEffectif(o: OngletDetecte): 'remplace' | 'complete' | 'ignore' {
    if (o.destination) return o.effet
    const manuel = destinationsManuelles.get(o.nom)
    if (manuel) return manuel === 'stagiaires' ? 'complete' : 'remplace'
    return 'ignore'
  }

  /** Écran à afficher selon l'état. */
  const ecran = $derived(bilan !== null ? 'resultat' : detection ? 'detection' : 'depart')
</script>

<section class="sheet">
  <p class="eyebrow">Étape 1 · Source</p>

  {#if ecran === 'depart'}
    <h2>Charger un fichier</h2>
    <p class="hint">
      Dépose un classeur Excel <span class="mono">.xlsx</span> ou une sauvegarde
      <span class="mono">.json</span>. L'application lit le fichier, annonce ce
      qu'elle y a trouvé et te laisse décocher ce que tu ne veux pas.
    </p>

    <div
      class="dropzone"
      class:hover={dragOver}
      role="region"
      aria-label="Zone de dépôt de fichier"
      ondrop={onDrop}
      ondragover={onDragOver}
      ondragleave={onDragLeave}
    >
      <label class="fake-btn primaire">
        Importer un fichier…
        <input
          type="file"
          accept=".xlsx,.xlsm,.json"
          hidden
          disabled={chargementEnCours}
          onchange={onFileInput}
        />
      </label>
      <span class="drop-hint">ou glisse-dépose ici</span>
    </div>

    <div class="liens-discrets">
      <button class="lien" type="button" onclick={onUtiliserDemo}>
        Charger le jeu de démonstration
      </button>
      <span class="sep">·</span>
      <button class="lien" type="button" onclick={onNouvelleSession}>
        Nouvelle session
      </button>
      <span class="sep">·</span>
      <button class="lien" type="button" onclick={onTelechargerTemplate}>
        Télécharger le template .xlsx
      </button>
    </div>

    <p class="chargeline">
      <span class="ink-soft">Chargé&nbsp;:</span> <span class="mono">{sourceLabel}</span>
    </p>

    {#if erreurImport}
      <div class="msg err">
        <b>Import échoué&nbsp;:</b> {erreurImport}
        {#if erreurImport.toLowerCase().includes('aucun onglet reconnu')}
          <div class="hint" style="margin-top:6px">
            Le classeur ne contient pas d'onglet nommé <span class="mono">Liste</span>,
            <span class="mono">Stagiaires</span> ou <span class="mono">Proposés</span> (casse et
            accents tolérés). Tu peux
            <button class="lien" type="button" onclick={onTelechargerTemplate}>
              télécharger le template .xlsx
            </button>
            pour partir de la bonne structure.
          </div>
        {/if}
      </div>
    {/if}
  {:else if ecran === 'detection' && detection}
    <h2>Ce que contient ce fichier</h2>
    <p class="hint">
      <span class="mono">{detection.nomFichier}</span>
      <span class="ink-soft">— {formatTaille(detection.taille)}</span>
    </p>

    {#if detection.type === 'json'}
      <div class="msg info">
        <b>Reprise de session</b> — un fichier <span class="mono">.json</span> remplace
        l'état complet (lieu, session, inscriptions, contraintes). Rien n'est fusionné :
        c'est une reprise, pas un apport.
      </div>
      <div class="actions">
        <button class="ghost" type="button" onclick={onAnnuler}>Annuler</button>
        <button class="primaire" type="button" onclick={confirmer}>Reprendre cette session</button>
      </div>
    {:else}
      {@const excel = detection as DetectionExcel}
      {#if excel.warningsGlobaux.length > 0}
        <div class="msg warn">
          {#each excel.warningsGlobaux as w}<div>{w}</div>{/each}
        </div>
      {/if}
      <ul class="onglets">
        {#each excel.onglets as o}
          {@const effet = effetEffectif(o)}
          <li class="onglet" class:non-reconnu={!o.destination} class:echec={o.statut === 'echec'}>
            <input
              type="checkbox"
              disabled={o.statut === 'echec' || (!o.destination && !destinationsManuelles.has(o.nom))}
              checked={ongletsCoches.has(o.nom)}
              onchange={() => toggleOnglet(o.nom)}
            />
            <span class="mono nom">{o.nom}</span>
            <span class="resume">{o.resume}</span>
            {#if o.destination}
              <span class="destination">→ {DEST_LIBELLE[o.destination]}</span>
            {:else}
              <select
                aria-label="Associer manuellement l'onglet {o.nom}"
                value={destinationsManuelles.get(o.nom) ?? ''}
                onchange={(e) => setDestinationManuelle(o.nom, (e.currentTarget as HTMLSelectElement).value as DestinationOnglet | '')}
              >
                <option value="">— ignorer —</option>
                <option value="liste">Morceaux (remplace)</option>
                <option value="stagiaires">Stagiaires (complète)</option>
                <option value="proposes">Concert du vendredi (remplace)</option>
              </select>
            {/if}
            <span class="pastille" data-effet={effet}>{EFFET_LIBELLE[effet]}</span>
          </li>
          {#if o.warnings.length > 0}
            <li class="warnings-onglet">
              <ul>
                {#each o.warnings as w}<li>{w}</li>{/each}
              </ul>
            </li>
          {/if}
        {/each}
      </ul>
      <div class="actions">
        <button class="ghost" type="button" onclick={onAnnuler}>Annuler</button>
        <button
          class="primaire"
          type="button"
          onclick={confirmer}
          disabled={ongletsCoches.size === 0}
        >
          Importer la sélection ({ongletsCoches.size})
        </button>
      </div>
    {/if}
  {:else if ecran === 'resultat' && bilan}
    <h2>Import appliqué</h2>
    <p class="hint">
      {bilan.onglets_appliques.length} onglet(s) appliqué(s), {bilan.onglets_ignores.length}
      ignoré(s).
    </p>
    {#if bilan.onglets_appliques.length > 0}
      <ul class="bilan-liste">
        {#each bilan.onglets_appliques as a}
          <li>
            <span class="mono">{a.nom}</span> → {DEST_LIBELLE[a.destination]}
            <span class="pastille" data-effet={a.effet}>{EFFET_LIBELLE[a.effet]}</span>
            <span class="ink-soft">— {a.resume}</span>
          </li>
        {/each}
      </ul>
    {/if}
    {#if bilan.onglets_ignores.length > 0}
      <p class="ink-soft">Ignorés&nbsp;:
        {#each bilan.onglets_ignores as ig, i}<span>
          <span class="mono">{ig.nom}</span> <span class="ink-soft">({ig.motif})</span>{#if i < bilan.onglets_ignores.length - 1}, {/if}
        </span>{/each}
      </p>
    {/if}
    {#if bilan.warnings.length > 0}
      <details class="warnings-bilan">
        <summary>{bilan.warnings.length} avertissement(s)</summary>
        <ul>
          {#each bilan.warnings as w}<li>{w}</li>{/each}
        </ul>
      </details>
    {/if}
    <div class="actions">
      <button class="ghost" type="button" onclick={onAnnuler}>Importer un autre fichier</button>
    </div>
  {/if}
</section>

<style>
  /* Fix bug de cascade CSS révélé par la revue : la règle générique
     `label { text-transform: uppercase; letter-spacing: .1em; display: block }`
     de app.css:457 s'appliquait à `.fake-btn` (qui est un <label>) et faisait
     que certains boutons apparaissaient en capitales espacées. On neutralise
     explicitement les 3 propriétés à l'intérieur de ce composant. */
  .fake-btn {
    display: inline-flex;
    align-items: center;
    text-transform: none;
    letter-spacing: normal;
    padding: 8px 16px;
    background: var(--paper, #FAF9F4);
    border: 1px solid var(--paper-edge, #E8E5DA);
    border-radius: 6px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
  }
  .fake-btn:hover {
    background: var(--paper-edge, #E8E5DA);
  }
  .fake-btn.primaire {
    background: var(--ochre, #C8871F);
    color: white;
    border-color: var(--ochre, #C8871F);
  }
  .fake-btn.primaire:hover {
    background: #b47517;
  }

  .dropzone {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 32px 20px;
    margin: 20px 0 16px;
    border: 2px dashed var(--paper-edge, #E8E5DA);
    border-radius: 10px;
    transition: background 0.15s, border-color 0.15s;
  }
  .dropzone.hover {
    background: rgba(200, 135, 31, 0.06);
    border-color: var(--ochre, #C8871F);
  }
  .drop-hint {
    color: var(--ink-soft, #5B6660);
    font-size: 14px;
  }

  .liens-discrets {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    font-size: 13px;
    margin-bottom: 12px;
  }
  .lien {
    background: none;
    border: none;
    padding: 0;
    color: var(--ochre, #C8871F);
    text-decoration: underline;
    cursor: pointer;
    font-size: inherit;
    font-family: inherit;
    text-transform: none;
    letter-spacing: normal;
  }
  .lien:hover {
    color: #a47017;
  }
  .sep {
    color: var(--ink-soft, #5B6660);
  }

  .chargeline {
    font-size: 13px;
    margin: 12px 0 0;
  }

  .onglets {
    list-style: none;
    padding: 0;
    margin: 16px 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .onglet {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.02);
    border-radius: 6px;
    font-size: 14px;
  }
  .onglet.non-reconnu {
    opacity: 0.75;
  }
  .onglet.echec {
    opacity: 0.6;
    background: rgba(168, 59, 46, 0.05);
  }
  .onglet .nom {
    font-weight: 600;
    min-width: 100px;
  }
  .onglet .resume {
    flex: 1;
    color: var(--ink-soft, #5B6660);
  }
  .onglet .destination {
    font-size: 13px;
    color: var(--ink, #1A211D);
  }
  .onglet select {
    font-size: 13px;
    padding: 2px 6px;
  }
  .pastille {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .pastille[data-effet='remplace'] {
    background: rgba(200, 135, 31, 0.18);
    color: #7a5013;
  }
  .pastille[data-effet='complete'] {
    background: rgba(74, 124, 89, 0.18);
    color: #2f5238;
  }
  .pastille[data-effet='ignore'] {
    background: rgba(0, 0, 0, 0.08);
    color: var(--ink-soft, #5B6660);
  }

  .warnings-onglet {
    list-style: none;
    padding: 0 0 0 30px;
    margin: 0;
  }
  .warnings-onglet ul {
    margin: 0;
    padding: 4px 12px;
    font-size: 12px;
    color: var(--ink-soft, #5B6660);
    background: rgba(255, 240, 200, 0.4);
    border-left: 2px solid var(--ochre, #C8871F);
  }

  .actions {
    display: flex;
    gap: 12px;
    margin-top: 16px;
  }
  .primaire {
    padding: 8px 18px;
    background: var(--ochre, #C8871F);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    text-transform: none;
    letter-spacing: normal;
  }
  .primaire:hover:not(:disabled) {
    background: #b47517;
  }
  .primaire:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .bilan-liste {
    list-style: none;
    padding: 0;
    margin: 12px 0;
  }
  .bilan-liste li {
    padding: 6px 0;
    border-bottom: 1px solid var(--paper-edge, #E8E5DA);
    font-size: 14px;
  }
  .warnings-bilan {
    margin-top: 12px;
  }
  .warnings-bilan summary {
    cursor: pointer;
    font-size: 13px;
    color: var(--ochre, #C8871F);
  }
  .warnings-bilan ul {
    margin: 8px 0 0;
    padding-left: 20px;
    font-size: 12px;
    color: var(--ink-soft, #5B6660);
  }

  .msg.info {
    padding: 10px 14px;
    background: rgba(159, 198, 216, 0.15);
    border-left: 3px solid var(--craie, #9FC6D8);
    border-radius: 4px;
    font-size: 14px;
    margin: 12px 0;
  }
</style>
