<script lang="ts">
  /**
   * Input pour saisir la durée d'une plage (Indispo / RestrictionHoraire /
   * Seance) — cap durée (CD 6876+6885+6892).
   *
   * L'utilisateur saisit la **durée en minutes** directement (une durée n'a
   * pas de convention, contrairement à la fin qui peut être inclusive ou
   * exclusive). Le composant affiche à côté un label dérivé « jusqu'à
   * HH:MM » avec la borne **inclusive** (dernière minute occupée) —
   * cohérent avec l'affichage des créneaux post-PR 2b.
   *
   * Écriture bind côté modèle :
   *  - `duree_minutes` (canonique post-cap)
   *  - `fin` (borne EXCLUSIVE dérivée = `debut + duree_minutes`, conservée
   *    pour rétro-compat avec les consommateurs qui n'ont pas encore migré
   *    et pour la sérialisation JSON qui reste cohérente)
   *
   * Le composant est **inerte** si `debut` est absent : il affiche le champ
   * durée mais pas de label dérivé (impossible sans début).
   *
   * Utilisé aux 3 points de saisie post rollback InputFinBorne (PR #132) :
   *  - `Indispos.svelte` (`ind.debut`/`ind.duree_minutes`/`ind.fin`)
   *  - `Imposes.svelte` (`s.debut`/`s.duree_minutes`/`s.fin`)
   *  - `Lieu.svelte` (`res.debut`/`res.duree_minutes`/`res.fin`)
   */

  interface Props {
    /** Début de la plage — nécessaire pour dériver la fin. */
    debut: string | undefined
    /** Durée en minutes (canonique post-cap). */
    duree_minutes: number | undefined
    /**
     * Fin en borne exclusive (dérivée). Le composant l'écrit à chaque
     * changement de durée pour maintenir la cohérence avec les JSON
     * legacy et les consommateurs qui utilisent encore `fin` directement.
     */
    fin: string | undefined
    onchange: () => void
    /** Placeholder facultatif — utile pour Indispos où duree est optionnel. */
    placeholder?: string
  }

  let {
    debut,
    duree_minutes = $bindable(),
    fin = $bindable(),
    onchange,
    placeholder = 'durée (min)',
  }: Props = $props()

  /** `HH:MM` → total minutes, ou `null` si invalide. */
  function toMin(t: string | undefined): number | null {
    if (!t) return null
    const parts = t.split(':')
    if (parts.length !== 2) return null
    const h = Number(parts[0])
    const m = Number(parts[1])
    if (!Number.isFinite(h) || !Number.isFinite(m)) return null
    return h * 60 + m
  }

  /** minutes → `HH:MM` (0 padded, wrap 24h). */
  function fromMin(n: number): string {
    const nn = ((n % (24 * 60)) + 24 * 60) % (24 * 60)
    const h = Math.floor(nn / 60)
    const m = nn % 60
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
  }

  const labelFinInclusive = $derived.by(() => {
    const debutMin = toMin(debut)
    if (debutMin === null || duree_minutes === undefined || duree_minutes <= 0) {
      return null
    }
    // Convention Stéphane (CD 6892) : la borne affichée est la DERNIÈRE
    // minute occupée. Pour une durée de N minutes à partir de `debut`,
    // la dernière minute occupée est `debut + duree − 1`.
    return `jusqu'à ${fromMin(debutMin + duree_minutes - 1)}`
  })

  /**
   * Fin stale — CD msg 6936 : quand l'utilisateur saisit une durée
   * puis modifie le début, la `fin` écrite en stockage restait à sa
   * valeur d'origine. Rien ne la lisait (les consommateurs passent par
   * `finMinutesDe` qui prend `duree_minutes` en priorité), MAIS la
   * valeur partait dans les exports et les états JSON — quelqu'un qui
   * reprendrait un état verrait une fin incohérente. « Une donnée qui
   * ment en attendant que quelqu'un s'en serve. »
   *
   * `$effect` recalcule `fin` à chaque changement de `debut` ou de
   * `duree_minutes`. Idempotent : si les 2 termes n'ont pas bougé,
   * l'écriture est un no-op (même valeur).
   */
  $effect(() => {
    if (duree_minutes === undefined) return
    const debutMin = toMin(debut)
    if (debutMin === null) return
    const finDerivee = fromMin(debutMin + duree_minutes)
    if (fin !== finDerivee) fin = finDerivee
  })

  function auChangement(e: Event) {
    const raw = (e.currentTarget as HTMLInputElement).value
    if (raw === '') {
      // Effacement de la durée : on repasse en « durée non renseignée ».
      // `fin` est laissé tel quel — c'est un champ required dans certains
      // schémas (Seance, RestrictionHoraire) et le vider casserait Zod.
      // L'utilisateur qui vide le champ durée retombe sur la sémantique
      // « fin seule », comportement pré-cap.
      duree_minutes = undefined
      onchange()
      return
    }
    const n = Number(raw)
    if (!Number.isFinite(n) || n < 0) {
      // Entrée invalide — on ignore (le champ HTML type=number filtre déjà).
      onchange()
      return
    }
    duree_minutes = Math.floor(n)
    // Dérive `fin` en borne EXCLUSIVE (`debut + duree`). Convention
    // conservée pour rétro-compat consommateurs (`indispoBloque`,
    // `salleRestreinte` utilisent `finMinutesDe` qui prend `duree` en
    // priorité, mais le JSON exporté garde les deux cohérents).
    const debutMin = toMin(debut)
    if (debutMin !== null) {
      fin = fromMin(debutMin + duree_minutes)
    }
    // Si `debut` absent, on ne peut pas dériver `fin` — on laisse tel
    // quel. L'invariant Zod required est préservé côté schémas concernés.
    onchange()
  }
</script>

<input
  type="number"
  min="0"
  max="1440"
  step="15"
  value={duree_minutes ?? ''}
  oninput={auChangement}
  {placeholder}
  style="width:90px"
/>
{#if labelFinInclusive}
  <span class="fin-derivee">{labelFinInclusive}</span>
{/if}

<style>
  .fin-derivee {
    font-size: 12px;
    color: #6c757d;
    font-variant-numeric: tabular-nums;
    margin-left: 4px;
  }
</style>
