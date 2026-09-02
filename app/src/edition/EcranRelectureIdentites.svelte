<script lang="ts">
  /**
   * Écran de relecture des identités (Sujet C PR3).
   *
   * Étape intermédiaire du flow d'import (entre extraction et
   * enregistrement) — ni modale, ni écran de menu. Design cadré par
   * Stéphane 2026-09-01 :
   *
   * - **Placement** : étape traversée par force, franchissable en un
   *   clic si aucune alerte. Le blocage vient du contenu, pas de la
   *   mécanique.
   * - **Hiérarchie visuelle** en 3 niveaux :
   *   1. Alertes qui appellent une décision (homonymie, doublon) —
   *      cartes rouges en haut, en évidence
   *   2. Signalements (rapprochements proposés) — repliés par défaut
   *   3. Liste des personnes créées — scrollable, dense mais lisible
   *
   *   Un écran de 40 lignes uniformes n'est pas lu.
   *
   * - **Garde-fou d'affichage** : ce qui s'affiche = ce que
   *   l'utilisateur a écrit. `BRUNO V.` reste `BRUNO V.`, pas
   *   `bruno v.`. Sinon corruption apparente.
   *
   * Le composant est présentation pure — la logique (tri, filtre,
   * groupement) vit dans `relecture-identites-vm.ts` pour testabilité.
   */
  import type { AnalyseIdentitesImport } from '../io/alertes-import'
  import type { AlerteIdentite } from '../domain/identites'
  import type { AlerteCoherence } from '../domain/coherence'
  import { grouperAlertesCoherence } from '../domain/coherence'
  import {
    filtrerPersonnes,
    grouperAlertes,
    organiserSignalementsCoherence,
    synthese,
    trierPersonnes,
    type TriPersonnes,
  } from './relecture-identites-vm'

  interface Props {
    analyse: AnalyseIdentitesImport
    onValider: () => void
    onAnnuler: () => void
  }
  let { analyse, onValider, onAnnuler }: Props = $props()

  let recherche = $state('')
  let tri = $state<TriPersonnes>('alpha')
  let signalementsDeplies = $state(false)
  let orphelinsDeplies = $state(false)

  const groupes = $derived(grouperAlertes(analyse.alertes_identite))
  const groupesCoherence = $derived(grouperAlertesCoherence(analyse.alertes_coherence))
  const signalementsCoherenceOrganises = $derived(
    organiserSignalementsCoherence(groupesCoherence.signalements),
  )
  const compteurs = $derived(synthese(analyse))
  const personnesAffichees = $derived(
    trierPersonnes(filtrerPersonnes(analyse.personnes_relecture, recherche), tri),
  )

  function formaterAlerte(a: AlerteIdentite): { titre: string; detail: string } {
    if (a.type === 'homonymie_probable') {
      return {
        titre: `Homonymie probable : « ${a.nom} »`,
        detail: `Instruments différents (${a.instruments.join(' / ')}) dans plusieurs morceaux (${a.groupes.join(', ')}), jamais réunis. Probablement deux personnes distinctes qui partagent ce prénom.`,
      }
    }
    if (a.type === 'doublon_intra_groupe') {
      return {
        titre: `Doublon dans « ${a.groupe} » : ${a.discriminants.join(' + ')}`,
        detail: `Deux formes du même nom apparaissent sur ce morceau. Probablement une personne saisie deux fois.`,
      }
    }
    // rapprochement_propose
    return {
      titre: `Rapprochement proposé : « ${a.nom_court} » ↔ « ${a.nom_long} »`,
      detail:
        a.groupe === null
          ? 'Deux formes probablement de la même personne (nom court + nom long ou variante accentuée). À confirmer.'
          : `Sur le morceau « ${a.groupe} ». À confirmer.`,
    }
  }

  /**
   * Formatage des alertes de cohérence entre onglets (cas I à P).
   * Le cas M (indispo percutée) est le seul qui produit une contradiction
   * insoluble par le solveur — il ouvre le titre par « À arbitrer » pour
   * signaler à l'utilisateur qu'il doit trancher avant validation.
   */
  function formaterAlerteCoherence(a: AlerteCoherence): { titre: string; detail: string } {
    switch (a.type) {
      case 'indispo_percutee':
        return {
          titre: `À arbitrer — « ${a.personne} » indisponible sur la séance « ${a.morceau} »`,
          detail: `Séance figée le ${a.date} de ${a.debut} à ${a.fin}, mais indisponibilité déclarée${a.motif_indispo ? ` (${a.motif_indispo})` : ''}. Le solveur ne peut pas déplacer une séance figée : il faut lever l'indisponibilité, retirer la personne du morceau, ou déplacer la séance manuellement avant validation.`,
        }
      case 'pupitre_contredit':
        return {
          titre: `Pupitre contredit — « ${a.personne} » citée en ${a.pupitre_cite} sur « ${a.morceau} »`,
          detail: `Instruments déclarés dans Stagiaires : ${a.pupitres_declares.join(', ')}. Le pupitre cité n'y figure pas. Corriger la déclaration Stagiaires (ajouter le pupitre) ou la Liste (changer l'instrument cité).`,
        }
      case 'responsable_non_cite':
        return {
          titre: `Responsable non cité — « ${a.personne} » responsable de « ${a.morceau} »`,
          detail: `Aucune mention de cette personne parmi les membres du morceau. Soit oubli de la citer dans un pupitre, soit responsable non-instrumentiste (chef, coach) — dans ce cas rien à faire.`,
        }
      case 'stagiaire_orphelin':
        return {
          titre: `Stagiaire orphelin — « ${a.personne} » déclaré mais jamais cité`,
          detail: `Personne déclarée dans Stagiaires sans engagement dans aucun morceau. Situation normale si intervenant du répertoire ou inscrit tardif ; à vérifier sinon.`,
        }
      case 'lateralite_non_batteur':
        return {
          titre: `Latéralité hors batterie — « ${a.personne} »`,
          detail: `Une latéralité (droitier/gaucher) a été renseignée mais aucun des instruments déclarés (${a.instruments.join(', ')}) n'est la batterie. Info inexploitée par le solveur — retirer la latéralité ou ajouter batterie aux pupitres si oubli.`,
        }
      case 'nom_cite_absent_stagiaires':
        return {
          titre: `Nom cité absent de Stagiaires — « ${a.personne} » sur « ${a.morceau} » (${a.pupitre})`,
          detail: `Cité dans la Liste mais aucune personne à ce nom dans l'onglet Stagiaires. Faute de frappe, oubli de saisir le stagiaire, ou variante non détectée par le rapprochement automatique.`,
        }
      case 'pupitre_non_declare_polyvalent':
        return {
          titre: `Polyvalence non déclarée — « ${a.personne} » joue ${a.pupitre_non_declare} sur « ${a.morceau} »`,
          detail: `Pupitres cités sur ce morceau : ${a.pupitres_cites.join(' + ')}. Pupitres déclarés en Stagiaires : ${a.pupitres_declares.join(', ')}. La polyvalence est prouvée par la présence multi-pupitre ; il manque juste d'ajouter « ${a.pupitre_non_declare} » aux instruments déclarés.`,
        }
      case 'morceau_vide':
        return {
          titre: `Morceau sans membre — « ${a.morceau} »`,
          detail: `Aucun stagiaire cité dans aucun pupitre. Postes CHERCHE éventuels ne comptent pas comme membres — un morceau sans musicien effectif ne pourra pas être placé.`,
        }
    }
  }
</script>

<div class="ecran-relecture">
  <header class="entete">
    <h2>Relecture des identités</h2>
    <div class="compteurs" role="status" aria-live="polite">
      <span class="compte compte-decisions" class:zero={compteurs.nb_decisions === 0}>
        <strong>{compteurs.nb_decisions}</strong>
        décision{compteurs.nb_decisions > 1 ? 's' : ''}
      </span>
      <span class="compte compte-signalements">
        <strong>{compteurs.nb_signalements}</strong>
        signalement{compteurs.nb_signalements > 1 ? 's' : ''}
      </span>
      <span class="compte compte-personnes">
        <strong>{compteurs.nb_personnes}</strong>
        personne{compteurs.nb_personnes > 1 ? 's' : ''} créée{compteurs.nb_personnes > 1 ? 's' : ''}
      </span>
    </div>
  </header>

  {#if groupes.decisions.length + groupesCoherence.alertes.length > 0}
    <section class="section-decisions" aria-labelledby="titre-decisions">
      <h3 id="titre-decisions">Alertes — décision requise</h3>
      <ul class="liste-alertes">
        <!-- Cohérence en tête (cas M = contradiction insoluble prioritaire) -->
        {#each groupesCoherence.alertes as alerte}
          {@const info = formaterAlerteCoherence(alerte)}
          <li class="carte-alerte carte-decision">
            <div class="titre-alerte">{info.titre}</div>
            <div class="detail-alerte">{info.detail}</div>
          </li>
        {/each}
        {#each groupes.decisions as alerte}
          {@const info = formaterAlerte(alerte)}
          <li class="carte-alerte carte-decision">
            <div class="titre-alerte">{info.titre}</div>
            <div class="detail-alerte">{info.detail}</div>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if groupes.signalements.length + groupesCoherence.signalements.length > 0}
    {@const nbSig = groupes.signalements.length + groupesCoherence.signalements.length}
    <section class="section-signalements" aria-labelledby="titre-signalements">
      <button
        type="button"
        class="deplier-signalements"
        onclick={() => (signalementsDeplies = !signalementsDeplies)}
        aria-expanded={signalementsDeplies}
      >
        <h3 id="titre-signalements">
          {signalementsDeplies ? '▼' : '▶'}
          Signalements — {nbSig} à vérifier
        </h3>
      </button>
      {#if signalementsDeplies}
        <ul class="liste-alertes">
          {#each groupes.signalements as alerte}
            {@const info = formaterAlerte(alerte)}
            <li class="carte-alerte carte-signalement">
              <div class="titre-alerte">{info.titre}</div>
              <div class="detail-alerte">{info.detail}</div>
            </li>
          {/each}
          {#each signalementsCoherenceOrganises.autres as alerte}
            {@const info = formaterAlerteCoherence(alerte)}
            <li class="carte-alerte carte-signalement">
              <div class="titre-alerte">{info.titre}</div>
              <div class="detail-alerte">{info.detail}</div>
            </li>
          {/each}
          {#each signalementsCoherenceOrganises.orphelins_individuels as alerte}
            {@const info = formaterAlerteCoherence(alerte)}
            <li class="carte-alerte carte-signalement">
              <div class="titre-alerte">{info.titre}</div>
              <div class="detail-alerte">{info.detail}</div>
            </li>
          {/each}
          {#if signalementsCoherenceOrganises.orphelins_agreges.length > 0}
            {@const nb = signalementsCoherenceOrganises.orphelins_agreges.length}
            <li class="carte-alerte carte-signalement carte-orphelins-agrege">
              <button
                type="button"
                class="deplier-orphelins"
                onclick={() => (orphelinsDeplies = !orphelinsDeplies)}
                aria-expanded={orphelinsDeplies}
              >
                <span class="titre-alerte">
                  {orphelinsDeplies ? '▼' : '▶'}
                  {nb} stagiaires ne figurent dans aucun morceau
                </span>
              </button>
              <div class="detail-alerte">
                Situation normale pour les intervenants qui travaillent le répertoire hors morceaux nommés.
                À vérifier ponctuellement si un inscrit tardif a été oublié.
              </div>
              {#if orphelinsDeplies}
                <ul class="liste-orphelins">
                  {#each signalementsCoherenceOrganises.orphelins_agreges as o}
                    <li>« {o.personne} »</li>
                  {/each}
                </ul>
              {/if}
            </li>
          {/if}
        </ul>
      {/if}
    </section>
  {/if}

  <section class="section-personnes" aria-labelledby="titre-personnes">
    <div class="entete-personnes">
      <h3 id="titre-personnes">
        Personnes créées ({personnesAffichees.length}{personnesAffichees.length !== compteurs.nb_personnes ? ` / ${compteurs.nb_personnes}` : ''})
      </h3>
      <div class="controles-personnes">
        <label>
          Rechercher :
          <input type="search" bind:value={recherche} placeholder="nom…" />
        </label>
        <label>
          Tri :
          <select bind:value={tri}>
            <option value="alpha">Nom (A→Z)</option>
            <option value="engagements">Engagements (décroissant)</option>
          </select>
        </label>
      </div>
    </div>
    <ul class="liste-personnes">
      {#each personnesAffichees as p}
        <li class="ligne-personne" class:sans-engagement={p.sans_engagement}>
          <span class="nom">{p.nom_affichage}</span>
          <span class="instruments">{p.instruments.join(', ') || '—'}</span>
          <span class="engagements">
            {#if p.sans_engagement}
              <span class="tag-stagiaire" title="Déclaré en Stagiaires, jamais cité dans un morceau — situation normale (répertoire intervenants, inscrit tardif)">
                sans engagement
              </span>
            {:else}
              {p.nb_engagements} eng.
            {/if}
          </span>
        </li>
      {/each}
    </ul>
    {#if personnesAffichees.length === 0}
      <p class="aucun-resultat">Aucune personne ne correspond à la recherche.</p>
    {/if}
  </section>

  <footer class="actions">
    <button type="button" class="bouton-annuler" onclick={onAnnuler}>
      ← Retour extraction
    </button>
    <button type="button" class="bouton-valider" onclick={onValider}>
      Valider les identités →
    </button>
  </footer>
</div>

<style>
  /* Charte Balance : ocre sur vert foncé, papier crème sur pages.
     Variables globales (app.css) : --ink, --ink-soft, --paper,
     --paper-edge, --ochre, --rouge, --vert.
     Toutes les couleurs ci-dessous les utilisent — pas de valeur
     littérale sauf variantes hover et sections d'alerte teintées. */

  .ecran-relecture {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1rem;
    max-width: 900px;
    margin: 0 auto;
    background: var(--paper);
    color: var(--ink);
    border-radius: 4px;
  }

  .entete {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 0.5rem;
    border-bottom: 1px solid var(--paper-edge);
    padding-bottom: 0.5rem;
  }

  .entete h2 {
    margin: 0;
    font-size: 1.4rem;
    color: var(--ink);
  }

  .compteurs {
    display: flex;
    gap: 1rem;
    font-size: 0.9rem;
    color: var(--ink-soft);
  }

  .compte strong {
    font-size: 1.1rem;
  }

  .compte-decisions strong {
    color: var(--rouge);
  }
  .compte-decisions.zero strong {
    color: var(--ink-soft);
  }

  .compte-signalements strong {
    color: var(--ochre);
  }

  /* Sections d'alerte : accent teinté (rouge / ambre), texte principal
     en --ink pour lisibilité maximale sur fond papier. */
  .section-decisions {
    background: #fbeceb; /* teinte rouge très pâle harmonisée à --rouge */
    border-left: 4px solid var(--rouge);
    padding: 0.75rem 1rem;
    border-radius: 4px;
    color: var(--ink);
  }

  .section-decisions h3 {
    color: var(--rouge);
    margin: 0 0 0.5rem 0;
    font-size: 1.1rem;
  }

  .section-signalements {
    background: #fbf1de; /* teinte ambre très pâle harmonisée à --ochre */
    border-left: 4px solid var(--ochre);
    padding: 0.5rem 1rem;
    border-radius: 4px;
    color: var(--ink);
  }

  .section-signalements h3 {
    color: var(--ochre);
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
  }

  .deplier-signalements,
  .deplier-orphelins {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    width: 100%;
    font-size: inherit;
    color: inherit;
    text-transform: none;
    letter-spacing: normal;
  }

  .liste-orphelins {
    margin: 0.5rem 0 0 0;
    padding-left: 1.25rem;
    columns: 2;
    column-gap: 1.5rem;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }

  .liste-orphelins li {
    break-inside: avoid;
    margin-bottom: 0.15rem;
  }

  .liste-alertes {
    list-style: none;
    padding: 0;
    margin: 0.5rem 0 0 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .carte-alerte {
    background: var(--paper);
    border-radius: 4px;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--paper-edge);
    color: var(--ink);
  }

  .titre-alerte {
    font-weight: 600;
    margin-bottom: 0.25rem;
    color: var(--ink);
  }

  .detail-alerte {
    font-size: 0.9rem;
    color: var(--ink-soft);
  }

  .section-personnes {
    background: var(--paper);
    padding: 0.75rem 1rem;
    border-radius: 4px;
    border: 1px solid var(--paper-edge);
    color: var(--ink);
  }

  .entete-personnes {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  .entete-personnes h3 {
    margin: 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--ink);
  }

  .controles-personnes {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    font-size: 0.9rem;
    color: var(--ink);
  }

  .controles-personnes input,
  .controles-personnes select {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--paper-edge);
    border-radius: 3px;
    font-size: 0.9rem;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--sans);
  }

  .liste-personnes {
    list-style: none;
    padding: 0;
    margin: 0;
    max-height: 400px;
    overflow-y: auto;
    border: 1px solid var(--paper-edge);
    border-radius: 3px;
    background: var(--paper);
  }

  .ligne-personne {
    display: grid;
    grid-template-columns: 2fr 2fr 1fr;
    gap: 0.5rem;
    padding: 0.35rem 0.75rem;
    border-bottom: 1px solid var(--paper-edge);
    font-size: 0.9rem;
    color: var(--ink);
  }

  .ligne-personne:last-child {
    border-bottom: none;
  }

  /* Contenu principal : nom en --ink (haute lisibilité). Feedback
     Stéphane 2026-09-02 : sur 69 lignes, la colonne des noms
     s'effaçait car elle héritait de --paper (couleur du body). */
  .ligne-personne .nom {
    font-weight: 500;
    color: var(--ink);
  }

  .ligne-personne .instruments {
    color: var(--ink-soft);
    font-size: 0.85rem;
  }

  .ligne-personne .engagements {
    text-align: right;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }

  /* « sans engagement » = signalement discret. Le nom passe en
     --ink-soft (visible mais estompé) pour signaler l'exception —
     inverse de l'ancien contraste inversé que Stéphane a signalé. */
  .ligne-personne.sans-engagement .nom {
    color: var(--ink-soft);
    font-style: italic;
  }

  .tag-stagiaire {
    display: inline-block;
    font-size: 0.75rem;
    background: var(--paper-edge);
    color: var(--ink-soft);
    padding: 0.1rem 0.4rem;
    border-radius: 3px;
    font-style: italic;
  }

  .aucun-resultat {
    padding: 0.75rem;
    color: var(--ink-soft);
    text-align: center;
    font-style: italic;
  }

  .actions {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--paper-edge);
  }

  /* Boutons : reprennent la charte des `<button>` globaux d'App.svelte.
     .bouton-valider = call-to-action ocre (comme .big).
     .bouton-annuler = ghost transparent (comme .ghost). */
  .bouton-annuler,
  .bouton-valider {
    padding: 0.5rem 1rem;
    border-radius: 2px;
    cursor: pointer;
    font-size: 0.95rem;
    font-family: var(--sans);
    font-weight: 600;
    border: 1px solid var(--ink);
    line-height: 1.2;
    text-transform: none;
    letter-spacing: normal;
  }

  .bouton-annuler {
    background: transparent;
    color: var(--ink);
  }

  .bouton-annuler:hover {
    background: var(--paper-edge);
  }

  .bouton-valider {
    background: var(--ochre);
    color: #231703;
    border-color: var(--ochre);
  }

  .bouton-valider:hover {
    background: #b0741a;
  }
</style>
