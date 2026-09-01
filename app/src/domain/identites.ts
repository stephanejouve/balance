/**
 * Sujet C — détection d'alertes d'identité à l'import (intra-session).
 *
 * Contexte cadré par Stéphane 2026-09-01 :
 * - Périmètre INTRA-session uniquement. Balance ne gère pas la récurrence
 *   entre sessions (pas d'ID durable, pas de registre) — la doctrine acte
 *   l'autonomie complète de chaque session.
 * - Le sujet C sert la cohérence à l'intérieur d'une session en aidant à
 *   créer les bonnes entités **au moment d'un import**, avant que les UUID
 *   ne soient figés. Corriger après = fusion d'entités = coût nettement
 *   supérieur.
 * - Doctrine « proposé, jamais appliqué » : pas de fusion automatique, pas
 *   de distance de Levenshtein qui décide seule. L'asymétrie des coûts est
 *   nette — une proposition à confirmer coûte 30s, une fusion silencieuse
 *   coûte une session (constaté sur le prototype : trois Pierre fusionnés
 *   fabriquaient des conflits imaginaires et en masquaient de réels).
 *
 * Deux détections + un dérivé pour l'écran de relecture :
 *
 * 1. **Homonymie probable** — même nom, ≥2 instruments distincts, jamais
 *    ensemble dans le même morceau. Le second critère est essentiel :
 *    une personne polyvalente (chant + guitare sur le même morceau) n'est
 *    pas homonyme, aucune alerte.
 *
 * 2. **Doublon intra-groupe** — même nom (avec ou sans discriminant)
 *    présent plusieurs fois sur un même morceau — ex. « Pierre » et
 *    « Pierre (L) » sur la même ligne. Presque sûrement une personne
 *    saisie deux fois.
 *
 * Ce qu'on N'alerte PAS (feedback Stéphane) : les prénoms seuls portés
 * par plusieurs personnes distinctes (7 sur une feuille réelle → 6 signaux
 * inutiles). Ils sont visibles dans l'écran de relecture, pas dans les
 * alertes. **Règle : alerter sur ce qui est indécidable et rare, présenter
 * le reste sans interrompre.**
 *
 * Référence historique : `repartiteur_repetitions.html` fonctions
 * `mentions()` et `alertesIdentite()` — logique déjà corrigée du faux
 * positif polyvalent. Transposée ici, pas réinventée.
 */

/**
 * Une mention = une occurrence d'un nom brut dans un morceau importé
 * (avant résolution UUID). Structure agnostique du format source
 * (xlsx stagiaires, PDF planning, saisie manuelle…).
 */
export interface MembreMention {
  /** Prénom brut sans discriminant (ex. « Pierre »). */
  nom: string
  /**
   * Discriminant d'unicité — tag entre parenthèses attaché au nom
   * (ex. « (L) », « (SIG) »). Vide si pas de discriminant.
   */
  discriminant: string
  /** Pupitre déclaré pour cette mention (ex. « batterie »). */
  pupitre: string
  /** Titre du morceau où la personne apparaît (rôle de groupe). */
  groupe_titre: string
}

export type AlerteIdentite =
  | {
      type: 'homonymie_probable'
      /** Nom sans discriminant (identique pour toutes les occurrences). */
      nom: string
      /** Instruments distincts observés sur ce nom. */
      instruments: string[]
      /** Groupes (morceaux) où le nom apparaît. */
      groupes: string[]
    }
  | {
      type: 'doublon_intra_groupe'
      /** Nom sans discriminant. */
      nom: string
      /** Discriminants observés (`['', '(L)']`, `['', '(SIG)']`...). */
      discriminants: string[]
      /** Groupe où le doublon est observé. */
      groupe: string
    }
  | {
      type: 'rapprochement_propose'
      /** Forme courte (prénom seul, ex. « Pierre »). */
      nom_court: string
      /** Forme longue compatible (ex. « Pierre Lemoine »). */
      nom_long: string
      /**
       * Groupe où les deux formes cohabitent, ou `null` si elles vivent
       * dans des morceaux distincts (cas C — jamais sur le même morceau).
       * Un rapprochement sur MÊME morceau (cas D) est traité comme
       * doublon plutôt que rapprochement — signal plus fort.
       */
      groupe: string | null
    }

export interface PersonneRelecture {
  /** Nom avec discriminant si présent (« Pierre (L) »). */
  nom_affichage: string
  /** Instruments distincts observés sur cette identité. */
  instruments: string[]
  /**
   * Nombre d'engagements RÉELS dans des morceaux — exclut la mention
   * issue de la déclaration Stagiaire (feedback Stéphane 2026-09-01 :
   * un stagiaire jamais cité ne doit pas afficher « 1 engagement » à
   * tort). Compté sur les mentions avec `groupe_titre` non vide.
   */
  nb_engagements: number
  /**
   * Vrai si la personne est déclarée dans l'onglet Stagiaires mais
   * n'apparaît dans aucun morceau. Situation normale (répertoire des
   * intervenants, inscrit tardif, spectateur) — l'UI peut la marquer
   * discrètement pour distinguer sans alerter.
   *
   * Nom choisi (Stéphane 2026-09-01) : `sans_engagement` plutôt que
   * `stagiaire_seulement` qui n'expliquait pas ce qu'il portait
   * (seulement stagiaire par opposition à quoi ?). Cohérent avec le
   * compteur `nb_engagements` du même objet.
   */
  sans_engagement: boolean
}

/**
 * Normalise un nom pour comparaison — la normalisation seule doit suffire
 * à rapprocher les variations d'écriture invisibles à l'œil (feedback
 * Stéphane cas F 2026-09-01).
 *
 * Enchaînement en 5 étapes, dans cet ordre :
 *
 * 1. **NFC (Normalization Form Canonical Composition)** — règle la
 *    différence entre « é » écrit en un seul caractère (U+00E9) et en deux
 *    (« e » U+0065 + accent combinant U+0301). Indiscernables à l'œil,
 *    différents pour une comparaison. Fréquent entre macOS et Windows.
 * 2. **Espaces insécables → espaces normaux** — U+00A0 vient souvent du
 *    copier-coller depuis tableur ou traitement de texte.
 * 3. **Trim extrémités** — le « BRUNO V. » de la feuille avait un espace
 *    final.
 * 4. **Lowercase** — « BRUNO V. » ↔ « Bruno V. ».
 * 5. **Espaces multiples réduits à un seul** — « Sofia  T. » (double
 *    espace) ↔ « Sofia T. ».
 *
 * **Ne touche PAS aux accents** — « Solène » et « Solene » restent
 * distinctes ici. Un rédacteur qui écrit sans accent le fait souvent
 * sciemment (raccourci clavier), mais le rapprochement reste possible :
 * voir `_detecterRapprochementsAccents` qui propose sans fusionner.
 *
 * **Garde-fou : la clé normalisée sert au rapprochement, jamais à
 * l'affichage** (feedback Stéphane 2026-09-01). L'utilisateur voit
 * toujours ce qu'il a écrit — sinon on lui renvoie une version corrigée
 * de sa propre saisie et il ne reconnaît plus ses données.
 */
export function normaliserNom(nom: string): string {
  return nom
    .normalize('NFC')
    .replace(/\u00A0/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
}

/**
 * Comme `normaliserNom` mais SANS les accents — pour proposer un
 * rapprochement `Solène` ↔ `Solene`. À utiliser uniquement pour le
 * matching de rapprochement, pas pour le regroupement direct.
 */
export function normaliserSansAccents(nom: string): string {
  return normaliserNom(nom)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
}

/**
 * Détecte les alertes d'identité à partir des mentions brutes.
 * Ordre stable (tri alpha nom, puis groupe) pour reporting déterministe.
 */
export function detecterAlertesIdentite(
  mentions: readonly MembreMention[],
): AlerteIdentite[] {
  const alertes: AlerteIdentite[] = []
  alertes.push(..._detecterHomonymies(mentions))
  alertes.push(..._detecterDoublons(mentions))
  alertes.push(..._detecterRapprochements(mentions))
  return alertes
}

/**
 * Homonymie : même nom (sans discriminant), ≥2 instruments **cités dans
 * les morceaux**, qui ne coexistent dans aucun morceau (aucune personne
 * polyvalente).
 *
 * Un discriminant explicite disqualifie l'alerte — « Pierre (L) » et
 * « Pierre (SIG) » sont volontairement distingués par le rédacteur du
 * planning. Seule l'ambiguïté SUR LE PRÉNOM SEUL est alertable.
 *
 * **Séparation identité vs cohérence** (feedback Stéphane 2026-09-01,
 * post-mesure) : la détection d'homonymie ignore le pupitre déclaré
 * dans l'onglet Stagiaires (`groupe_titre = ''`). Sinon on obtient un
 * faux positif sur les cas de « pupitre contredit » (task #47) :
 * Clara V. déclarée Piano et citée à la Batterie sur un morceau était
 * remontée comme « 2 personnes portent peut-être le même nom » alors
 * qu'il n'y en a qu'une avec une déclaration incohérente. Le libellé
 * envoyait l'utilisateur chercher un homonyme, mais il fallait corriger
 * une déclaration.
 *
 * Chacun sa source, plus de recouvrement :
 * - identité (ici) → regarde ce qui est CITÉ dans les morceaux
 * - cohérence (task #47) → comparera déclaré vs cité
 *
 * Vérif cas B (Pierre-Yves L. chant + guitare cités SUR LE MÊME
 * morceau) : les 2 instruments sont dans la même case
 * `instrParGroupe['Vent Debout']` → polyvalent, aucune alerte. La
 * règle du « jamais ensemble » reste intacte, elle joue sur les
 * mentions morceau qui restent.
 */
function _detecterHomonymies(
  mentions: readonly MembreMention[],
): AlerteIdentite[] {
  // Groupement par nom normalisé (prénom seul, sans discriminant)
  const parNom = new Map<
    string,
    {
      nom_affichage: string  // forme brute de la première mention (garde-fou affichage)
      instruments: Set<string>
      groupes: Set<string>
      instrParGroupe: Map<string, Set<string>>
      discriminants: Set<string>
    }
  >()
  for (const m of mentions) {
    const cle = normaliserNom(m.nom)
    let bucket = parNom.get(cle)
    if (!bucket) {
      bucket = {
        nom_affichage: m.nom,  // on garde la forme brute pour l'affichage
        instruments: new Set(),
        groupes: new Set(),
        instrParGroupe: new Map(),
        discriminants: new Set(),
      }
      parNom.set(cle, bucket)
    }
    // Discriminants suivis peu importe la source (mention stagiaire ou
    // morceau) — le tag est un attribut de la personne, pas de son
    // engagement. Sert au filtre « discriminant explicite = pas d'alerte ».
    bucket.discriminants.add(m.discriminant)

    // `instrParGroupe` inclut AUSSI la déclaration stagiaire
    // (`groupe_titre = ''` fait office de pseudo-groupe). Motivation :
    // un stagiaire déclaré polyvalent (Vincent K. Guitare + Chant en
    // additionnel) doit disqualifier l'alerte homonymie même si ses
    // 2 pupitres sont cités sur 2 morceaux distincts. Le pseudo-groupe
    // stagiaire couvre alors tous les instruments cités → polyvalent
    // légitime. Sans ça, Vincent K. serait faux-positif.
    let insGrp = bucket.instrParGroupe.get(m.groupe_titre)
    if (!insGrp) {
      insGrp = new Set()
      bucket.instrParGroupe.set(m.groupe_titre, insGrp)
    }
    insGrp.add(m.pupitre)

    // `instruments` + `groupes` : SEULEMENT les mentions morceau. Le
    // pupitre stagiaire ne compte pas comme « instrument observé »
    // pour le critère « ≥2 instruments distincts » (sinon Clara V.
    // déclarée Piano + citée Batterie remonte à tort, cf. docstring).
    if (m.groupe_titre === '') continue
    bucket.instruments.add(m.pupitre)
    bucket.groupes.add(m.groupe_titre)
  }

  const alertes: AlerteIdentite[] = []
  const nomsTries = [...parNom.keys()].sort()
  for (const cle of nomsTries) {
    const b = parNom.get(cle)!
    // Un discriminant explicite (`(L)`, `(SIG)`…) disqualifie — la
    // désambiguïsation est volontaire.
    const discriminantsExplicites = [...b.discriminants].filter((d) => d !== '')
    if (discriminantsExplicites.length > 0) continue
    if (b.instruments.size < 2) continue
    // Second critère : au moins un groupe contient TOUS les instruments
    // vus sur ce nom → polyvalent, pas homonyme.
    let polyvalent = false
    for (const insGrp of b.instrParGroupe.values()) {
      if (insGrp.size === b.instruments.size) {
        polyvalent = true
        break
      }
    }
    if (polyvalent) continue
    alertes.push({
      type: 'homonymie_probable',
      nom: b.nom_affichage,  // forme brute, pas la clé normalisée
      instruments: [...b.instruments].sort(),
      groupes: [...b.groupes].sort(),
    })
  }
  return alertes
}

/**
 * Doublon intra-groupe : même nom, présent plusieurs fois dans un même
 * morceau, dans une configuration qui suggère fortement une erreur de
 * saisie plutôt qu'une polyvalence légitime.
 *
 * Deux motifs déclenchent l'alerte :
 * 1. **Discriminants distincts** — « Pierre » + « Pierre (L) » sur la
 *    même ligne. Presque sûrement une personne saisie sous deux formes.
 * 2. **Pupitre répété avec même discriminant** — « Pierre » à batterie
 *    x2 dans le même morceau. Redondance sur le même rôle.
 *
 * Ne déclenche PAS l'alerte : polyvalence légitime (même discriminant,
 * pupitres tous distincts). Ex. « Pierre-Yves » chant + guitare dans
 * « Marée Basse » — une seule personne qui joue deux rôles simultanés
 * sur le même morceau, courant en pratique.
 */
function _detecterDoublons(
  mentions: readonly MembreMention[],
): AlerteIdentite[] {
  const alertes: AlerteIdentite[] = []
  const dejaSignales = new Set<string>()

  // 1. Groupement par (nom normalisé, groupe normalisé) — cas où le
  //    même nom apparaît plusieurs fois sur le même morceau
  //    (« Pierre (L) » + « Pierre (SIG) » ou pupitre répété).
  const parCouple = new Map<string, MembreMention[]>()
  // Ignore les mentions du pseudo-groupe stagiaires (`groupe_titre = ''`)
  // — un stagiaire n'a pas d'engagement sur ce « morceau vide ».
  const mentionsMorceaux = mentions.filter((m) => normaliserNom(m.groupe_titre) !== '')
  for (const m of mentionsMorceaux) {
    const cle = `${normaliserNom(m.nom)}|${normaliserNom(m.groupe_titre)}`
    let liste = parCouple.get(cle)
    if (!liste) {
      liste = []
      parCouple.set(cle, liste)
    }
    liste.push(m)
  }

  const clesTriees = [...parCouple.keys()].sort()
  for (const cle of clesTriees) {
    const occurrences = parCouple.get(cle)!
    if (occurrences.length < 2) continue
    const discriminants = [...new Set(occurrences.map((o) => o.discriminant))].sort()
    const pupitres = occurrences.map((o) => o.pupitre)
    const pupitresUniques = new Set(pupitres)
    // Motif polyvalent légitime : un seul discriminant + tous pupitres
    // distincts → une personne qui joue plusieurs rôles simultanés.
    const polyvalentLegitime =
      discriminants.length === 1 && pupitresUniques.size === pupitres.length
    if (polyvalentLegitime) continue
    const marqueur = `${cle}|self`
    dejaSignales.add(marqueur)
    alertes.push({
      type: 'doublon_intra_groupe',
      nom: occurrences[0].nom,  // forme brute (garde-fou affichage)
      discriminants,
      groupe: occurrences[0].groupe_titre,
    })
  }

  // 2. Détection préfixe sur MÊME morceau : « Pierre » + « Pierre
  //    Lemoine » sur « Sables Mouvants ». Cas D du corrigé Stéphane —
  //    presque sûrement une personne saisie deux fois sous deux formes
  //    (prénom seul + nom complet). Signal plus fort que le simple
  //    rapprochement cross-morceaux (cas C).
  const parGroupe = new Map<string, MembreMention[]>()
  for (const m of mentionsMorceaux) {
    const g = normaliserNom(m.groupe_titre)
    let liste = parGroupe.get(g)
    if (!liste) {
      liste = []
      parGroupe.set(g, liste)
    }
    liste.push(m)
  }
  for (const grp of [...parGroupe.keys()].sort()) {
    const mentionsGrp = parGroupe.get(grp)!
    const nomsGrp = [...new Set(mentionsGrp.map((m) => normaliserNom(m.nom)))]
    for (const nomA of nomsGrp) {
      for (const nomB of nomsGrp) {
        if (nomA === nomB) continue
        if (nomB.startsWith(nomA + ' ')) {
          // nomA = préfixe court, nomB = forme longue. Ordre lexico :
          // signaler une seule fois par paire.
          const cleRappr = [nomA, nomB].sort().join('|')
          const marqueur = `${cleRappr}|${grp}|prefix`
          if (dejaSignales.has(marqueur)) continue
          dejaSignales.add(marqueur)
          const mentionA = mentionsGrp.find((m) => normaliserNom(m.nom) === nomA)!
          const mentionB = mentionsGrp.find((m) => normaliserNom(m.nom) === nomB)!
          alertes.push({
            type: 'doublon_intra_groupe',
            nom: mentionA.nom,  // forme la plus courte pour affichage
            discriminants: [mentionA.nom, mentionB.nom].sort(),
            groupe: mentionA.groupe_titre,
          })
        }
      }
    }
  }
  return alertes
}

/**
 * Détecte les rapprochements proposés : un nom court (`Pierre`) et un
 * nom long (`Pierre Lemoine`) où le court est le préfixe du long. OU
 * deux variantes accentuées (`Solène` ↔ `Solene`, cas G).
 *
 * **Doctrine « proposé, jamais appliqué »** (Stéphane 2026-09-01) : le
 * module signale, l'humain confirme. Un rapprochement erroné ne produit
 * aucune erreur visible — juste un planning faux que personne ne remarque
 * (constaté sur prototype : 3 Pierre fusionnés → conflits imaginaires +
 * réels masqués).
 *
 * **Coexistence rapprochement + doublon (cas C+D combinés)** : le
 * rapprochement porte sur la PAIRE globale de noms (« ces 2 formes
 * désignent probablement la même personne »), le doublon porte sur un
 * MORCEAU spécifique (« sur ce morceau, la même personne apparaît
 * deux fois »). Les deux alertes coexistent quand les 2 formes se
 * rencontrent à la fois sur des morceaux distincts (cas C) ET sur un
 * morceau commun (cas D). Attendu par le corrigé Stéphane 2026-09-01
 * (1 rapprochement + 1 doublon pour Pierre/Pierre Lemoine).
 *
 * **Pas de propagation en chaîne (cas H)** : les paires sont testées
 * indépendamment. `Renée B.` ↔ `Renee B.` ne rapproche pas `Renée B.`
 * de `Renee C.` par transitivité — chaque comparaison utilise le nom
 * COMPLET (avec initiale/nom de famille), pas le prénom seul désaccentué.
 * Sinon on finirait par relier des noms qui n'ont rien à voir.
 */
function _detecterRapprochements(
  mentions: readonly MembreMention[],
): AlerteIdentite[] {
  // Ensemble des noms uniques observés (forme brute, ordre d'apparition)
  const nomsUniques: string[] = []
  const vus = new Set<string>()
  for (const m of mentions) {
    const cle = normaliserNom(m.nom)
    if (!vus.has(cle)) {
      vus.add(cle)
      nomsUniques.push(m.nom)
    }
  }

  const alertes: AlerteIdentite[] = []
  const dejaProposes = new Set<string>()

  // Sous-fonction : ajoute un rapprochement si pas encore proposé
  const ajouter = (nomCourt: string, nomLong: string, groupe: string | null) => {
    const cleRappr = [normaliserNom(nomCourt), normaliserNom(nomLong)].sort().join('|')
    if (dejaProposes.has(cleRappr)) return
    dejaProposes.add(cleRappr)
    alertes.push({
      type: 'rapprochement_propose',
      nom_court: nomCourt,
      nom_long: nomLong,
      groupe,
    })
  }

  // 1. Rapprochement par préfixe (« Pierre » préfixe de « Pierre Lemoine »)
  for (let i = 0; i < nomsUniques.length; i++) {
    for (let j = 0; j < nomsUniques.length; j++) {
      if (i === j) continue
      const a = normaliserNom(nomsUniques[i])
      const b = normaliserNom(nomsUniques[j])
      // a est-il un préfixe de b (mot entier) ? Ex. « pierre » préfixe de « pierre lemoine »
      if (a === b) continue
      if (b.startsWith(a + ' ')) {
        // Rapprochement toujours proposé — même si la paire coexiste
        // aussi sur un morceau commun (le doublon local sera émis en
        // plus par _detecterDoublons, cf. cas C+D combinés du corrigé
        // Stéphane 2026-09-01).
        ajouter(nomsUniques[i], nomsUniques[j], null)
      }
    }
  }

  // 2. Rapprochement par accents (« Solène » ↔ « Solene »)
  for (let i = 0; i < nomsUniques.length; i++) {
    for (let j = i + 1; j < nomsUniques.length; j++) {
      const a = normaliserNom(nomsUniques[i])
      const b = normaliserNom(nomsUniques[j])
      if (a === b) continue
      // Match sans accents mais différentes avec accents ?
      if (
        normaliserSansAccents(nomsUniques[i]) === normaliserSansAccents(nomsUniques[j])
      ) {
        ajouter(nomsUniques[i], nomsUniques[j], null)
      }
    }
  }

  return alertes
}

/**
 * Vue à plat des personnes créées (nom_affichage, instruments, nb
 * engagements) — support pour l'écran de relecture.
 *
 * Contrairement aux alertes qui ciblent l'ambigu, cette vue montre
 * TOUT — c'est là que l'humain repère « trois Pierre à la batterie »
 * en trois secondes, là où aucune heuristique ne trancherait jamais.
 *
 * Une identité = (nom + discriminant). Les instruments listés sont
 * l'union des pupitres vus sur toutes les mentions. Ordre : tri alpha
 * du nom d'affichage pour reporting déterministe.
 */
export function personnesPourRelecture(
  mentions: readonly MembreMention[],
): PersonneRelecture[] {
  const parIdentite = new Map<
    string,
    {
      nom_affichage: string
      instruments: Set<string>
      morceaux: Set<string>       // morceaux DISTINCTS où la personne apparaît
    }
  >()
  for (const m of mentions) {
    const nomAffichage = m.discriminant
      ? `${m.nom} ${m.discriminant}`
      : m.nom
    // Clé normalisée (garde-fou : sert au regroupement, jamais à
    // l'affichage — feedback Stéphane 2026-09-01)
    const cle = normaliserNom(nomAffichage)
    let bucket = parIdentite.get(cle)
    if (!bucket) {
      bucket = {
        nom_affichage: nomAffichage,
        instruments: new Set(),
        morceaux: new Set(),
      }
      parIdentite.set(cle, bucket)
    }
    // L'instrument est enregistré peu importe la source (stagiaire ou
    // morceau) — c'est un attribut de la personne.
    if (m.pupitre) bucket.instruments.add(m.pupitre)
    // ⚠  Sémantique cruciale (Stéphane 2026-09-01, bug +1 né dans cette
    // confusion — documenter noir sur blanc à l'endroit du calcul) :
    //
    //     On compte des PRÉSENCES dans un morceau, pas des pupitres.
    //     Une personne citée à 5 pupitres du même morceau vaut 1 :
    //     elle ne peut être qu'à un endroit à la fois. C'est ce qui
    //     intéresse le solveur (contrainte de temps).
    //
    // Cette règle ne se propage PAS partout : la feuille de route d'un
    // groupe DOIT afficher les 5 pupitres (là on parle d'instrumentation,
    // pas de présence). Deux compteurs pour deux besoins — ne pas fusionner.
    //
    // Implémentation : `Set<groupe_titre_normalisé>` dédoublonne
    // naturellement les multi-pupitres. La mention stagiaire seule
    // (`groupe_titre = ''`) n'est jamais ajoutée → un stagiaire non
    // cité affiche 0 (pas 1).
    if (m.groupe_titre !== '') {
      bucket.morceaux.add(normaliserNom(m.groupe_titre))
    }
  }
  return [...parIdentite.values()]
    .map((b) => ({
      nom_affichage: b.nom_affichage,
      instruments: [...b.instruments].sort(),
      nb_engagements: b.morceaux.size,
      sans_engagement: b.morceaux.size === 0,
    }))
    .sort((a, b) =>
      normaliserNom(a.nom_affichage).localeCompare(normaliserNom(b.nom_affichage)),
    )
}
