<script lang="ts">
  /**
   * Input `<input type="time">` pour une borne de fin de plage saisie
   * par l'utilisateur — applique la convention Stéphane (CD msg 6798 /
   * 6832) : toute borne non finale `H:00` / `H:30` / etc. est convertie
   * silencieusement vers la dernière minute effectivement occupée
   * (`(H−1):59`, `H:29`, etc.), et l'écart est affiché sous forme de
   * mention persistante informative tant que la correction est en
   * vigueur.
   *
   * Utilisé aux 4 points de saisie de fin de plage :
   *  - `Session.svelte` : règles de grille (`regle.fin`)
   *  - `Lieu.svelte` : restrictions de salle (`restriction.fin`)
   *  - `Imposes.svelte` : séances imposées (`seance.fin`)
   *  - `Indispos.svelte` : plages d'indisponibilité (`indispo.fin`)
   *
   * Cadrage non négociable (CD 6832) :
   *  - **Registre informatif, pas alerte** : « on a interprété », pas
   *    « erreur » ni « attention ». La saisie n'est pas une faute, elle
   *    est simplement écrite autrement que ce que le modèle retient.
   *  - **Persistance** : la mention reste tant que la valeur corrigée
   *    est là. Elle disparaît quand l'utilisateur ré-édite vers un
   *    `H:59` naturel (ou vide le champ).
   *  - **Auto-apprentissage** (raison Stéphane) : voir 12:00 devenir
   *    11:59 avec l'explication apprend à l'organisateur ce que
   *    l'application entend. Une mention qui devient inutile à force
   *    d'être lue a fait son travail.
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
     * valeur canonique n'a pas été convertie (saisie déjà en `H:59` ou
     * champ vide). Persisté au même endroit que `valeur` pour survivre
     * aux imports / exports JSON.
     */
    original: string | undefined
    /** Notifie le parent qu'une valeur a changé (invalide solveur, etc.). */
    onchange: () => void
    /** Placeholder facultatif — utile pour Indispos.svelte où fin est optionnel. */
    placeholder?: string
  }

  let {
    valeur = $bindable(),
    original = $bindable(),
    onchange,
    placeholder = '',
  }: Props = $props()

  function auChangement(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value
    const r = corrigerSaisieFin(raw)
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
