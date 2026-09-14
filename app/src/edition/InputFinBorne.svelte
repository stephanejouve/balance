<script lang="ts">
  /**
   * Input `<input type="time">` pour une borne de fin de plage saisie
   * par l'utilisateur — applique la convention Stéphane (CD msgs 6798 /
   * 6832 / 6850) : une borne qui coïncide avec une frontière de créneau
   * (`totalMin % pasMinutes === 0`, donc exclusive) est convertie vers
   * la dernière minute effectivement occupée. Une borne déjà inclusive
   * (une minute avant frontière) ou hors-cycle est laissée intacte.
   *
   * Utilisé aux 4 points de saisie de fin de plage :
   *  - `Session.svelte` : règles de grille (`regle.fin`, pas = `regle.pas_minutes`)
   *  - `Lieu.svelte` : restrictions de salle (`restriction.fin`, pas = `null`)
   *  - `Imposes.svelte` : séances imposées (`seance.fin`, pas = `null`)
   *  - `Indispos.svelte` : plages d'indisponibilité (`indispo.fin`, pas = `null`)
   *
   * `pasMinutes = null` court-circuite toute correction — les contextes
   * sans pas propre (restriction, imposé, indispo) délimitent un range
   * temporel brut, pas un créneau à convertir.
   *
   * Cadrage non négociable (CD 6832) :
   *  - **Registre informatif, pas alerte**
   *  - **Persistance** : mention reste tant que la valeur corrigée est là
   *  - **Auto-apprentissage** (raison Stéphane)
   *
   * Incident PR #125 (CD 6850) : la version précédente convertissait
   * toute valeur ne finissant pas par `:59`, dégradant `18:29` (pas 30,
   * déjà inclusive) en `18:28` et dérivant à chaque ré-édition. Le
   * critère du pas résout : `18:29` reste `18:29` car
   * `1109 % 30 !== 0`.
   */
  import { corrigerSaisieFin } from '../domain/grille'

  interface Props {
    /**
     * Valeur canonique stockée dans le modèle (post-correction). `undefined`
     * quand le champ est optionnel dans le modèle (`Indispo.fin`) et vide.
     */
    valeur: string | undefined
    /**
     * Saisie utilisateur brute AVANT correction, `undefined` quand la
     * valeur canonique n'a pas été convertie (saisie déjà inclusive ou
     * champ vide). Persisté au même endroit que `valeur` pour survivre
     * aux imports / exports JSON.
     */
    original: string | undefined
    /**
     * Pas de créneau du contexte (CD 6850). `null` court-circuite toute
     * correction pour les contextes sans pas propre.
     */
    pasMinutes: number | null
    /**
     * Début de la plage (`HH:MM`), requis avec `pasMinutes` (CD 6853).
     * Le critère de conversion est
     * `(finMinutes − debutMinutes) % pasMinutes === 0` : frontière
     * relative au début, pas depuis minuit. Vide/undefined court-circuite
     * la correction (impossible sans début).
     */
    debut?: string | undefined
    /** Notifie le parent qu'une valeur a changé (invalide solveur, etc.). */
    onchange: () => void
    /** Placeholder facultatif — utile pour Indispos.svelte où fin est optionnel. */
    placeholder?: string
  }

  let {
    valeur = $bindable(),
    original = $bindable(),
    pasMinutes,
    debut,
    onchange,
    placeholder = '',
  }: Props = $props()

  function auChangement(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value
    if (pasMinutes === null || !debut) {
      // Contexte sans pas propre (ou sans début) — aucune correction,
      // valeur brute.
      valeur = raw === '' ? undefined : raw
      original = undefined
      onchange()
      return
    }
    const parts = debut.split(':')
    if (parts.length !== 2) {
      valeur = raw === '' ? undefined : raw
      original = undefined
      onchange()
      return
    }
    const debutMin = Number(parts[0]) * 60 + Number(parts[1])
    const r = corrigerSaisieFin(raw, pasMinutes, debutMin)
    // Chaîne vide → `undefined` pour aligner sur les schémas optionnels
    // (Indispo.fin). Sur les champs obligatoires (RegleCreneau.fin) le
    // parent garde un `string`, la valeur '' reste vide côté modèle mais
    // le schéma Zod refuse `HhMm.parse('')` — le formulaire est alors en
    // erreur, comportement identique à l'avant-refactor.
    valeur = r.valeur === '' ? undefined : r.valeur
    original = r.original === null ? undefined : r.original
    onchange()
  }
</script>

<input type="time" value={valeur ?? ''} onchange={auChangement} {placeholder} />
{#if original}
  <div class="mention-correction" role="status" aria-live="polite">
    On a interprété <b>{original}</b> comme <b>{valeur}</b>.
  </div>
{/if}

<style>
  .mention-correction {
    font-size: 11.5px;
    color: #6c757d;
    margin-top: 2px;
    line-height: 1.3;
  }
  .mention-correction b {
    font-weight: 600;
    color: #495057;
  }
</style>
