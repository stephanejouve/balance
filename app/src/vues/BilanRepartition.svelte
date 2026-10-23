<script lang="ts">
  import { accord } from '../domain/accord'
  /**
   * Bloc de tête de l'étape 3 : les compteurs de la répartition, et
   * l'avertissement de charge par jour.
   *
   * - #175 : le compteur de problèmes porte sa gravité. Non nul, il passe en
   *   rouge et renvoie à l'encadré du Contrôle indépendant juste en dessous
   *   (`#controle-independant`) ; à 0 il reste neutre.
   * - #184 (arbitrage CD) : le dépassement du seuil de charge par jour est
   *   relayé comme avertissement DISTINCT, jamais ajouté au compteur de
   *   problèmes — c'est un seuil de confort, ni contrainte du solveur ni
   *   vérifié par `verify.ts`.
   */
  interface Props {
    groupesComplets: number
    groupesTotal: number
    repetitionsPosees: number
    dureeMs: number
    essais: number
    problemes: number
    musiciensAuDelaSeuil: number
    seuilChargeJour: number
  }
  let {
    groupesComplets,
    groupesTotal,
    repetitionsPosees,
    dureeMs,
    essais,
    problemes,
    musiciensAuDelaSeuil,
    seuilChargeJour,
  }: Props = $props()
</script>

<div class="stats">
  <div>
    <b>{groupesComplets}/{groupesTotal}</b>
    {accord(groupesTotal, 'groupe complet', 'groupes complets')}
  </div>
  <div><b>{repetitionsPosees}</b> {accord(repetitionsPosees, 'répétition posée', 'répétitions posées')}</div>
  <div>
    <b>{dureeMs} ms</b> de calcul
    <span class="ink-soft">({essais} essai{essais > 1 ? 's' : ''})</span>
  </div>
  {#if problemes > 0}
    <div class="alerte">
      <a href="#controle-independant"><b>{problemes}</b> problème(s) détecté(s) ↓</a>
    </div>
  {:else}
    <div><b>0</b> problème(s) détecté(s)</div>
  {/if}
</div>
{#if musiciensAuDelaSeuil > 0}
  <div class="msg warn charge-jour" role="status">
    ⚠ {musiciensAuDelaSeuil} musicien(s) au-delà du seuil de {seuilChargeJour} répétition{seuilChargeJour > 1 ? 's' : ''} par jour.
    Ce n'est pas compté comme problème : c'est un seuil de confort, réglable dans l'onglet « Par musicien » plus bas, où se trouve le détail.
  </div>
{/if}
