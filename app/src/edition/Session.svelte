<script lang="ts">
  import type { DiagnosticGrille } from '../domain/grille'
  import type { Session } from '../domain/model'
  import InputFinBorne from './InputFinBorne.svelte'

  interface Props {
    session: Session
    nbCreneaux: number
    /**
     * Diagnostic pré-génération (issues #110 + #111). Quand `nbCreneaux === 0`
     * alors qu'au moins une règle créatrice est définie, ce diagnostic
     * détaille chaque règle pathologique (jours-invalides, plage-vide,
     * pas-trop-grand, tout-bloqué) et les défauts globaux (session-sans-jour,
     * aucune-regle-creatrice). L'affichage ci-dessous consomme ces catégories
     * pour composer la phrase à l'utilisateur — la fonction pure ne produit
     * aucune phrase préfabriquée.
     * `null` = calcul de secours ou erreur silencieuse — ne pas afficher.
     * Prop optionnelle : les tests unitaires du composant (session-props-
     * ownership) peuvent monter sans, l'affichage tombe alors à vide.
     */
    diagnostic?: DiagnosticGrille | null
    onAjouterRegle: () => void
    onSupprimerRegle: (i: number) => void
    onInvalider: () => void
  }
  // `session` est mutée par les inputs (`bind:value={session.X}` sur nom,
  // dates, marge, grille, etc.). Svelte 5 exige `$bindable()` sur toute prop
  // mutée depuis l'enfant, faute de quoi on récolte des warnings
  // `ownership_invalid_mutation` (156 occurrences smoke Stéphane 2026-09-03)
  // et des comportements de bind imprévisibles. Le parent passe la prop en
  // `bind:session={session}`.
  let {
    session = $bindable(),
    nbCreneaux,
    diagnostic = null,
    onAjouterRegle,
    onSupprimerRegle,
    onInvalider,
  }: Props = $props()

  /**
   * Libellé de règle affichable — utilise l'index humain (1-based) et la
   * plage horaire brute pour rester compréhensible même quand la règle est
   * défaillante (aucune traduction Zod sur `jours` ne dépendant de la
   * catégorie). Format : « Règle #N (HH:MM-HH:MM) ».
   */
  function libelleRegle(regleIndex: number, debut: string, fin: string): string {
    return `Règle #${regleIndex + 1} (${debut}–${fin})`
  }

  /**
   * Traduit une catégorie de défaut de règle en phrase — la fonction pure
   * ne produit pas de traduction (elle reste testable sans i18n). Chaque
   * catégorie ci-dessous est nommée pour aider l'organisateur à situer la
   * correction à faire.
   */
  function raisonRegle(categorie: string): string {
    switch (categorie) {
      case 'jours-invalides':
        return "aucun jour valide (les jours listés ne correspondent à aucun jour de la session)"
      case 'plage-vide':
        return 'plage horaire vide (fin ≤ début)'
      case 'pas-trop-grand':
        return 'pas trop grand pour la plage (aucun tour possible)'
      case 'tout-bloqué':
        return 'tous les créneaux sont bloqués par une règle de blocage ou tombent au-delà du butoir'
      default:
        return categorie
    }
  }

  function raisonGlobale(categorie: string): string {
    switch (categorie) {
      case 'session-sans-jour':
        return "la session n'a aucun jour (intervalle date de début → date de fin invalide ou vide)"
      case 'aucune-regle-creatrice':
        return 'aucune règle créatrice définie (seules des règles de blocage sont présentes)'
      default:
        return categorie
    }
  }
</script>

<details class="sheet" open>
  <summary>
    <p class="eyebrow">Étape 2b · Session</p>
    <h2>{session.nom}</h2>
    <p class="hint">
      {session.date_debut} → {session.date_fin}, butoirs apéro {session.butoir_apero_date} {session.butoir_apero_heure} / vendredi {session.butoir_vendredi_date} {session.butoir_vendredi_heure}.
      {session.grille.filter((r) => !r.bloque).length} règle(s) créatrice(s),
      {session.grille.filter((r) => r.bloque).length} règle(s) de blocage —
      <b>{nbCreneaux}</b> créneaux générés.
    </p>
    <!--
      Issue #110 : quand la génération ne produit rien alors que des règles
      créatrices sont définies, nommer explicitement ce qui cloche plutôt
      que laisser le compteur muet (« 3 règles → 0 créneaux » sans expliquer).
      Le diagnostic vient du parent (App.svelte::diagnosticGrille), qui
      appelle la fonction pure `diagnostiquerGrille(session, lieu)`.
    -->
    {#if diagnostic && !diagnostic.configurable && (diagnostic.defauts_regles.length > 0 || diagnostic.defauts_globaux.length > 0)}
      <div class="msg warn" style="margin-top:8px">
        <b>Session non configurable — aucun créneau généré.</b>
        <ul style="margin:6px 0 0 0">
          {#each diagnostic.defauts_globaux as cat}
            <li>{raisonGlobale(cat)}</li>
          {/each}
          {#each diagnostic.defauts_regles as d}
            <li>
              <b>{libelleRegle(d.regleIndex, d.debut, d.fin)}</b> — {raisonRegle(d.categorie)}.
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </summary>
  <div class="body">
    <label class="line">
      Nom de session <input bind:value={session.nom} onchange={onInvalider} />
    </label>
    <div class="fields">
      <label>Début <input type="date" bind:value={session.date_debut} onchange={onInvalider} /></label>
      <label>Fin <input type="date" bind:value={session.date_fin} onchange={onInvalider} /></label>
      <label>Butoir apéro <input type="date" bind:value={session.butoir_apero_date} onchange={onInvalider} /></label>
      <label>Heure <input type="time" bind:value={session.butoir_apero_heure} onchange={onInvalider} /></label>
      <label>Butoir vendredi <input type="date" bind:value={session.butoir_vendredi_date} onchange={onInvalider} /></label>
      <label>Heure <input type="time" bind:value={session.butoir_vendredi_heure} onchange={onInvalider} /></label>
      <label>Répétitions visées <input type="number" min="1" max="10" bind:value={session.repetitions_visees} onchange={onInvalider} /></label>
      <label>Minimum acceptable <input type="number" min="1" max="10" bind:value={session.repetitions_min} onchange={onInvalider} /></label>
      <label>
        Marge d'occupation ({session.marge_pct}%)
        <input type="range" min="0" max="50" step="5" bind:value={session.marge_pct} onchange={onInvalider} />
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
      « Bloque » retire les créneaux qui tombent dans la plage. Pour aller jusqu'à
      minuit, saisis <code>23:59</code> comme fin (dernière minute du jour).
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
                  onInvalider()
                }}
                placeholder="tous les jours"
              />
            </td>
            <td><input type="time" bind:value={regle.debut} onchange={onInvalider} /></td>
            <td>
              <InputFinBorne
                bind:valeur={regle.fin}
                bind:original={regle.fin_saisie_original}
                onchange={onInvalider}
              />
            </td>
            <td><input type="number" min="10" max="240" step="15" bind:value={regle.pas_minutes} onchange={onInvalider} /></td>
            <td class="center"><input type="checkbox" bind:checked={regle.bloque} onchange={onInvalider} /></td>
            <td class="center"><button class="mini" onclick={() => onSupprimerRegle(i)}>×</button></td>
          </tr>
        {/each}
      </tbody>
    </table>
    <button class="ghost" onclick={onAjouterRegle}>+ Ajouter une règle</button>
  </div>
</details>
