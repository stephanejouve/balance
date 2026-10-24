<script lang="ts">
  /**
   * Message « Session terminée » de l'étape 3 (CD msg 6839), extrait d'App
   * pour être testé au rendu (#203).
   *
   * - Ne dit pas OÙ est le bandeau « Rejouer à cette date » : il annonçait
   *   « en tête de page », alors que le bandeau est monté après `</main>`.
   * - Ne cite ce bandeau que quand il est affiché. Il ne l'est plus dès
   *   qu'un `?maintenant=` est fixé (`propositionRejouerCourante` null) :
   *   le message envoyait alors chercher un bandeau absent.
   * - Donne aussi la sortie vers le présent : de nouvelles dates à
   *   l'étape 2b. C'est le chemin d'un organisateur qui recharge le `.json`
   *   d'un stage précédent.
   */
  interface Props {
    /** Un `?maintenant=` est fixé : la référence n'est pas aujourd'hui. */
    maintenantFixe: boolean
    /** Le bandeau « Rejouer à cette date » est affiché. */
    rejouerAffiche: boolean
  }

  let { maintenantFixe, rejouerAffiche }: Props = $props()
</script>

<div class="msg warn">
  <b>Session terminée — aucun créneau à placer {maintenantFixe ? 'à la date de référence' : "aujourd'hui"}.</b>
  <p class="mini-h">
    Les dates de cette session sont dans le passé, aucun créneau ne peut donc
    être proposé {maintenantFixe ? 'à la date de référence fixée' : 'au présent'}.
    Les règles de grille sont saines — c'est le calendrier qui écrase les
    créneaux.
    {#if rejouerAffiche}
      Pour re-simuler la session à sa date d'origine, utilisez le bandeau
      <b>« Rejouer à cette date »</b>.
    {/if}
    Pour préparer une session à venir, donnez-lui de nouvelles dates (Début,
    Fin et butoirs) à l'<b>Étape 2b · Session</b>.
  </p>
</div>
