# Balance — cahier des charges

**Nom du produit : Balance.** C'est le terme du métier pour le réglage qui précède un
concert, et il dit ce que fait l'outil : équilibrer les musiciens entre les groupes, les
groupes entre les salles. Fichier livrable : `balance.html`. Nom à valider — vérifier
qu'aucun logiciel du milieu ne le porte déjà.

Refonte d'un prototype existant (`repartiteur_repetitions.html`, ~80 Ko, HTML/CSS/JS
autonome) en outil réutilisable et entièrement paramétrable.

Le prototype fonctionne et a été validé sur des données réelles. Il est **codé en dur**
pour une session précise : salles, dates, créneaux, contraintes. Tout cela doit devenir
de la donnée.

---

## 0. Périmètre — à lire avant tout le reste

Ce document est long parce qu'il consigne tout ce qui a été appris. **Il ne décrit pas un
produit à construire d'un bloc.** La version 1 tient en peu de choses :

### À faire en v1

- Lire le classeur existant de l'association (onglet `Liste`, structure déjà validée)
- Salles, dates et créneaux **saisissables**, rien en dur
- Quatre contraintes seulement : une personne à un seul endroit à la fois, une salle à un
  seul groupe, indisponibilités déclarées, tout avant la date butoir
- Le moteur existant, qui fonctionne
- Deux états : feuille de route par groupe, occupation par salle — imprimables et en CSV

C'est tout. Ça remplace le calcul manuel, ne change aucune habitude, et se teste sur la
prochaine session.

### À ne pas faire en v1

Ordre de passage du concert, conducteur minuté, temps de trajet entre salles, couplage à
un logiciel de gestion, CP-SAT, planning individuel, simulation de quotas, profils de
lieux multiples.

Tout cela est décrit plus loin parce que ça a été étudié et que ça peut resservir. **Rien
ne doit être développé sans qu'un besoin réel se soit manifesté.** Les sections 11 à 14
sont exploratoires, pas prescriptives.

### La seule exigence structurante

Garder le **modèle de contraintes séparé du moteur** et les règles **activables une par
une**. C'est ce qui permettra d'ajouter le reste plus tard sans tout reprendre — et
c'est la leçon de la mise au point : les règles ont changé une dizaine de fois en une
journée.

---

## 1. Le problème à résoudre

Un stage de musique. Des stagiaires forment des groupes autour de morceaux qu'ils veulent
jouer lors d'un concert. Chaque groupe a besoin de **N répétitions** avant la date du
concert. Il faut leur attribuer des créneaux horaires et des salles.

Ce qui rend le problème difficile : **un musicien joue souvent dans plusieurs groupes**.
Deux groupes qui partagent ne serait-ce qu'une personne ne peuvent jamais répéter en même
temps. Avec 39 musiciens et 13 morceaux, un placement à la main ne converge pas — mesuré :
tous les groupes se retrouvaient en conflit.

---

## 2. Ce qui doit devenir paramétrable

Tout ce qui suit est aujourd'hui en dur dans le code.

### Personnes
- Nom, instrument(s) — une personne peut en tenir plusieurs
- **Latéralité** pour les batteurs (droitier / gaucher) — impose une reconfiguration du kit
- Indisponibilités : par personne, par plage horaire, par jour
- Rôle : musicien, chanteur, intervenant

### Salles — voir aussi §11, profil de lieu réutilisable
- Nom
- **Capacité** (jauge) — nombre de musiciens maximum
- **Équipement** : batterie montée, piano, amplis, sonorisation
- **Restrictions horaires** : ex. « acoustique seulement après 23:00 » pour les salles
  proches des dortoirs
- Disponible ou non pour les répétitions (certaines salles sont réservées à autre chose)

### Calendrier
- Dates de début et de fin
- Créneaux par jour, avec **durée variable** — le prototype gère 30 min, 1 h, et des
  plages longues à subdiviser (ex. 16:30–20:30 = 4 tours d'une heure)
- Créneaux bloqués par un planning externe (repas, ateliers, concerts)
- **Date butoir** : les répétitions doivent toutes tomber avant

### Groupes / morceaux
- Titre, auteur, style, tonalité, responsable
- Membres par pupitre (chant, piano, basse, batterie, guitare, vents… liste extensible)
- Postes non pourvus (« cherche »)
- Nombre de répétitions visé, **minimum acceptable** (ex. viser 3, accepter 2)

### Plafonds
- Nombre maximum de morceaux au programme du concert
- Nombre maximum de groupes

---

## 3. Les contraintes

Chacune doit être **activable / désactivable** et, pour les préférences, **pondérable**
depuis l'interface. C'est le point le plus important du cahier des charges : les règles
ont changé une dizaine de fois pendant la mise au point, et à chaque fois il a fallu
retoucher le code.

### Contraintes dures (jamais violables)
1. Une personne ne peut pas être à deux endroits au même moment
2. Une salle ne peut accueillir qu'un groupe à la fois
3. Un groupe ne peut pas dépasser la jauge de la salle
4. Une personne indisponible sur un créneau n'y est pas placée
5. Les répétitions tombent avant la date butoir
6. Pas deux répétitions **consécutives** pour un même groupe (deux heures d'affilée
   avantagent ce groupe au détriment des autres)

### Préférences (pondérées)
7. Étaler les répétitions d'un groupe sur des jours différents
8. Privilégier certains jours ou créneaux (ex. lundi et mardi avant mercredi ;
   l'après-midi avant le matin le dernier jour)
9. Grands groupes dans les grandes salles ; ne pas gâcher une grande salle pour un trio
10. Un groupe ne répète pas deux fois dans la même salle *(sauf s'il enchaîne deux
    créneaux accolés — dans ce cas il reste sur place)*
11. Répartir la charge entre les musiciens

---

## 4. Le moteur

### Ajustement manuel

Le calcul propose, l'organisateur dispose. Prévoir de **déplacer une répétition à la main**
depuis la carte des créneaux, avec validation immédiate : l'outil accepte, ou refuse en
disant qui serait en conflit. Et de **figer** une répétition pour que le moteur ne la
touche plus lors des recalculs suivants — indispensable dès qu'une séance a déjà eu lieu
ou qu'un accord a été passé avec un groupe.

### Placement
Recherche par redémarrages aléatoires : ordre des groupes rebattu à chaque essai,
attribution par **tours de table** (chaque groupe obtient sa 1ʳᵉ répétition, puis la 2ᵉ,
puis la 3ᵉ) plutôt que groupe par groupe — sans ça, les premiers groupes accaparent les
meilleurs créneaux. Phase de **réparation par échange** pour les groupes restés
incomplets. Environ 2 500 essais, moins d'une seconde.

Ce n'est pas un solveur exact, et ça suffit : sur un cas de test, une recherche
exhaustive a confirmé que l'heuristique trouvait l'optimum.

### Choix du solveur — décision d'architecture à prendre d'emblée

Le problème traité est un **timetabling** classique, très étudié : mêmes contraintes que
l'emploi du temps scolaire, avec « musicien » à la place de « professeur ». Il existe des
solveurs génériques bien plus solides que l'heuristique du prototype. Trois voies :

| Voie | Avantages | Coût |
|---|---|---|
| **A. Heuristique maison** (prototype actuel) | fichier autonome, léger, aucune dépendance ; suffisant sur les cas testés | pas de preuve d'optimalité ni d'infaisabilité |
| **B. OR-Tools CP-SAT compilé en WebAssembly** | vrai solveur dans le navigateur, sans serveur ; prouve l'optimalité et démontre l'infaisabilité | binaire à embarquer — mesurer son poids, il compromet peut-être le fichier unique |
| **C. Solveur côté serveur** (OR-Tools Python, Timefold) | le plus puissant, outillage mature | exige une infrastructure : contraire à l'usage sur place, sans réseau fiable |

**Recommandation.** Garder A par défaut — c'est l'autonomie du fichier qui a permis de
l'utiliser sur le terrain. Mais **écrire le modèle de contraintes de façon déclarative**,
séparé du moteur, pour que B puisse se brancher sans réécrire la logique métier.

C'est sur le diagnostic que B apporterait le plus : là où l'heuristique dit « je n'ai pas
trouvé », CP-SAT sait démontrer qu'aucune solution n'existe et désigner le sous-ensemble
de contraintes responsable. Sur la session testée, il aurait pointé Gaël immédiatement.

Vérifier aussi ce que font les logiciels du métier — ALGEM (libre, écoles de musique),
Orfeo, Viviarto. Ils gèrent la réservation de salles et signalent les conflits, mais ne
calculent pas de répartition. Le manque est réel : rien entre l'agenda qui ne résout rien
et le solveur générique qu'il faut savoir programmer.

### Vérification indépendante — à conserver absolument
Après chaque calcul, une fonction **recontrôle la solution** par un chemin de code
distinct et affiche toute anomalie. C'est ce qui a permis de détecter plusieurs bugs
réels pendant la mise au point. Ne pas fusionner avec le moteur.

### Attribution des salles
**Étape séparée**, après le placement horaire. C'est un problème d'affectation :
énumérer les permutations (5 salles au plus) et minimiser un coût combinant jauge,
équipement, non-répétition de salle et enchaînement sur place.

### Diagnostic
Quand un groupe ne peut pas être placé, expliquer **pourquoi** plutôt que d'échouer en
silence : combien de créneaux lui restent ouverts, avec quels groupes il partage des
musiciens, quelle personne est la plus encombrante. Proposer des leviers.

Un contrôle d'infaisabilité en amont vaut de l'or : *une personne engagée sur 6 morceaux
× 3 répétitions = 18 créneaux nécessaires, or il n'en existe que 17.* Ce calcul trivial
explique instantanément un échec que le solveur mettrait longtemps à démontrer.

---

## 5. Les sorties

Trois entrées dans la même donnée, pour trois questions différentes. C'est un besoin
constaté sur le terrain : présenté la grille par morceau, un musicien l'a parcourue
chronologiquement en cherchant ce qui le concernait ensuite. Aucune des vues existantes
ne répondait à sa question.

### Les trois vues
- **Par groupe** — « quand répète-t-on ? » Pour chaque morceau : responsable, tonalité,
  effectif, et ses répétitions (jour, horaire, salle). Destinée aux responsables.
- **Par salle** — « qu'est-ce qui se passe ici ? » Une feuille par salle, chronologique,
  créneaux libres compris, à afficher sur la porte.
- **Par musicien** — « où dois-je être ? » L'agenda personnel de chacun, dans l'ordre
  du temps : horaire, salle, morceau. Quelqu'un engagé sur trois morceaux ne devrait pas
  avoir à reconstituer sa journée en balayant toute la grille. C'est aussi la vue qui rend
  visibles les enchaînements serrés et les temps de trajet (§12).

Les trois doivent être **imprimables séparément** (sans les formulaires) et **exportables
en CSV** (séparateur `;`, BOM UTF-8 pour Excel) — `balance_par_groupe.csv`,
`balance_par_salle.csv`, `balance_par_musicien.csv`.

### Carte des créneaux disponibles

Une grille **créneaux × salles** montrant d'un coup d'œil ce qui est pris et ce qui reste.
C'est l'outil de la souplesse : savoir où insérer une répétition supplémentaire, où
déplacer un groupe qui a un empêchement, ou quelles salles rendre à d'autres usages.

À faire apparaître : le taux d'occupation par créneau et par jour, les créneaux
entièrement libres (récupérables), et pour chaque case libre **quels groupes pourraient
l'occuper** sans créer de conflit — c'est ce qui transforme un tableau de cases vides en
outil de décision.

Prévoir aussi un réglage **« garder de la marge »** : demander au moteur de ne pas
saturer, en laissant un pourcentage de créneaux libres pour les imprévus. Un planning
optimal à 100 % est un planning qui casse au premier contretemps.

### Un troisième état : le planning individuel

Constaté en présentation : devant la grille par morceau, un musicien l'a parcourue
**à la verticale, par heure**, pour savoir ce qu'il faisait ensuite. Il cherchait une
information que ni la feuille de route par groupe ni l'occupation par salle ne donnent
directement — *sa* journée à lui.

Trois lectures, trois publics :

| État | Répond à | Pour qui |
|---|---|---|
| Feuille de route par groupe | *quand et où répète mon morceau ?* | les responsables |
| Occupation par salle | *qui occupe cette salle, et quand se libère-t-elle ?* | l'organisation, affichage sur les portes |
| **Planning individuel** | *qu'est-ce que je fais, et où, dans l'ordre ?* | chaque participant |

Le planning individuel : une page par personne, chronologique, avec pour chaque ligne
l'heure, le morceau, la salle — et le temps libre entre deux engagements. C'est aussi la
vue qui révèle le mieux les surcharges : celui qui enchaîne cinq répétitions le lundi
le voit immédiatement.

À exporter et imprimer comme les deux autres, et à générer en lot (un fichier par
personne, ou une page par personne dans un même document).

### Visualiser ce qui reste libre

Une fois la répartition faite, il reste de la marge — dans la session testée, une bonne
moitié des places. Elle n'est visible nulle part, alors que c'est elle qui permet de
réagir : un groupe formé en retard, une répétition supplémentaire pour un morceau
fragile, un déplacement de dernière minute.

Prévoir une **grille créneaux × salles** montrant d'un coup d'œil l'occupé et le libre,
avec un filtre « n'afficher que les disponibilités ». Et, à partir de là, deux questions
que l'outil sait déjà traiter :

- **Où puis-je encore caser ce groupe ?** — les créneaux libres compatibles avec ses
  membres, c'est le même calcul que pour les suggestions de renforts
- **Quels groupes pourraient prendre une répétition de plus ?** — utile pour ceux qui
  n'en ont obtenu que deux

C'est le pendant du diagnostic : celui-ci explique ce qui bloque, celle-là montre ce qui
reste possible.

### Ne pas recréer l'encombrement

Le prototype avait fini par empiler neuf blocs de résultats, au point de devoir en
désactiver sept. Les états supplémentaires doivent être **choisis, pas empilés** :
onglets ou sélection, avec deux vues actives par défaut et les autres à la demande.

### Fonctions optionnelles, à débrayer facilement
Développées et validées dans le prototype, désactivées aujourd'hui. Elles doivent être
réactivables par simple réglage :

- **Ordre de passage du concert** — minimise les mouvements de plateau (mesuré : 63
  mouvements contre 88 dans l'ordre d'inscription), regroupe les batteurs de même
  latéralité, rapproche les groupes partageant des musiciens (celui qui est déjà en
  place ne redescend pas), alterne les styles, jamais plus de 3 morceaux d'affilée
  pour la même personne
- **Conducteur du spectacle** — minutage avec durées réglables, changements de plateau,
  inversions de kit ; un groupe sans batterie placé entre deux batteurs de mains
  opposées couvre le changement
- **Programmation par style** — répartition des morceaux par genre pour bâtir le programme
- **Arbitrage du plafond** — quand le nombre de morceaux dépasse la capacité du concert,
  désigne les groupes à réduire (le choix du titre appartient au groupe, pas à l'outil)
- **Charge par musicien** — total de répétitions, alerte au-delà d'un seuil
- **Suggestions de renforts** — pour un groupe cherchant un musicien, qui est libre sur
  ses créneaux
- **Inversions de kit en répétition** — secondaire, il y a du temps entre deux séances

---

## 6. Ergonomie de saisie

Le tableau de saisie doit **reproduire la feuille papier** utilisée sur place : une ligne
par morceau, une colonne par pupitre. C'est le modèle mental des utilisateurs.

Conventions à conserver, elles viennent du terrain :
- Plusieurs noms dans une case, séparés par des virgules
- `CHERCHE` = poste à pourvoir
- `NON` = pas ce pupitre
- Instrument précisé entre parenthèses : `Colette (contrebasse)`

Édition directe dans le tableau, cellule par cellule. Un éditeur JSON en repli pour les
manipulations lourdes, avec **validation avant application** — ne jamais écraser les
données sur une saisie invalide, et indiquer la ligne fautive.

Import / export JSON pour reprendre le travail.

---

## 7. Pièges rencontrés — à couvrir par des tests

Ce sont des bugs réels, trouvés sur données réelles après avoir passé des jeux
synthétiques. À reprendre comme tests de non-régression.

| Piège | Ce qui s'est passé | Attendu |
|---|---|---|
| **Parenthèses ambiguës** | `Pierre (SIG)` interprété comme « instrument SIG », fusionnant tous les Pierre | Liste d'instruments reconnus ; sinon la parenthèse fait partie du nom |
| **Polyvalence** | Une personne au chant *et* à la guitare dans le même groupe comptée comme deux personnes en conflit | Dédoublonner les membres par personne, partout |
| **Homonymes** | Sept personnes désignées par un prénom seul | Alerter, sans bloquer ; distinguer par une initiale |
| **Fausse alerte homonyme** | Toute personne polyvalente signalée comme homonyme probable | Pas d'alerte si les deux instruments coexistent dans un même groupe |
| **Charge mal comptée** | Un musicien à deux pupitres comptait double | Dédoublonner avant de sommer |
| **Salles attribuées par ordre de liste** | La dernière salle n'était jamais utilisée | Attribution par coût, pas par index |
| **Déménagement absurde** | Un groupe changeait de salle entre deux créneaux accolés | Rester sur place quand les créneaux s'enchaînent |
| **Blocs qui s'écrasent** | Deux blocs de données superposés dans une feuille de calcul | Espacer largement |

---

## 8. Contraintes techniques

- **Fichier autonome** ouvrable par double-clic, sans installation ni réseau — c'est ce
  qui a permis de l'utiliser sur place. À conserver si possible.
- **Pas de `localStorage`** : indisponible dans certains contextes d'exécution. État en
  mémoire + export explicite. Prévenir clairement que rien n'est sauvegardé
  automatiquement — c'est le principal risque d'usage.
- **iOS / iPadOS** : un `.html` ouvert depuis l'app Fichiers passe par Quick Look, qui
  **n'exécute pas JavaScript**. La page s'affiche parfaitement et ne réagit à rien, sans
  message d'erreur. Prévoir un indicateur visible que le script tourne, ou documenter le
  contournement (navigateur tiers, ou service HTTP local).
- **Impression** : chaque état imprimable seul, sans les formulaires, sans coupure de
  tableau entre deux pages.

---

## 9. Jeux d'essai fournis

- `apero_mercredi.json` — données réelles : 13 morceaux, 39 musiciens, cas difficile
  (une personne sur 6 morceaux rend le problème infaisable)
- `demo_session5.json` — cas nominal, 5 groupes
- `demo_session5_sature.json` — 8 groupes, 16 morceaux pour un plafond de 13 : déclenche
  l'arbitrage

Un générateur de jeux synthétiques paramétrable serait utile pour les tests de charge :
il a permis de mesurer les seuils de rupture (ex. en dessous de 4 batteurs pour 12
morceaux imposés, le planning devient infaisable — falaise nette, pas dégradation
progressive).

---

## 10. Ce qu'il faut garder du prototype

- La logique métier, validée sur données réelles
- La vérification indépendante après calcul
- Le diagnostic explicatif en cas d'échec
- Les conventions de saisie issues du terrain
- Le parti pris d'un fichier unique, sans dépendance

Le reste — structure du code, interface, persistance — est à reprendre.

---

## 11. S'intégrer à l'existant — ce qu'on sait, ce qu'on suppose

### Ce qui a été observé, et qui est certain

L'organisation actuelle du stage repose sur :

- **Un dossier Google Drive partagé** (« 2026 Session 5 / Programme ») contenant un PDF
  par journée, produits par l'organisation
- **Des feuilles A4 imprimées et scotchées au tableau** sur place, corrigées à la main
  quand le planning bouge — un « niveau I » manuscrit, un nom barré et remplacé
- **Un classeur Excel** dont les onglets disent tout de la méthode : `Liste`,
  `Résa salles`, `Setlist mercredi`, plus deux feuilles de travail
- Des conventions de saisie stables : `CHERCHE`, `NON`, plusieurs noms par cellule,
  l'instrument entre parenthèses

Autrement dit : **tableur, Drive, papier.** Le tout maîtrisé, avec des habitudes solides.
L'onglet `Résa salles` montre qu'ils font déjà de la réservation de salles à la main.

### Ce que le site de l'association confirme

Association Musiques Festives, active depuis 1994 — 32 ans —, licence de spectacle et
code NAF 9001Z : le recours à des intermittents est établi. **Six sessions par an**, ce
qui correspond à ce qu'indique le commanditaire.

Quatre éléments ont un effet direct sur la conception :

**Le lieu est stable, mais pas définitif.** Toutes les sessions se tiennent actuellement
en Corrèze, au Domaine de Meilhac. La mention du Gard sur le site est un reste d'une
implantation passée : en 32 ans le stage a déménagé plusieurs fois.

Conséquence pour le §12 : la portabilité reste nécessaire — ne rien coder en dur — mais
ce n'est **pas** un besoin de reconfiguration fréquente. On décrit le lieu une fois, on y
revient tous les quelques années. Deux effets :

- Le profil de lieu peut être **soigné plutôt que rapide** : jauges réelles, équipement
  salle par salle, contraintes de voisinage. Ces données seront réutilisées des dizaines
  de fois, l'effort de saisie est vite amorti.
- Le changement de lieu n'est **pas un argument de démonstration** — voir §14, à ajuster.

**Le format des sessions varie.** La journée type publiée — préparation par instrument le
matin, répétitions générales et combos l'après-midi, jams et concerts le soir — correspond
exactement à la structure déduite du planning. Mais certaines sessions sont thématiques et
consacrent aussi les matinées au jeu en groupe. La grille de créneaux doit donc être
**décrite, jamais supposée**.

**La liste des instruments est large** : chant, guitare, piano, batterie, basse
électrique, contrebasse, saxophones, clarinette, flûte, trompette, trombone, cuivres et
bois, violon, alto, violoncelle et cordes, percussions, accordéon, harmonica, DJing et
instruments électroniques. Les pupitres doivent être librement éditables, sans liste
figée.

**Les places sont contingentées par instrument** — le site annonce « il reste deux places
batterie en S5 ». L'association pilote donc déjà le recrutement pupitre par pupitre.

### Une piste à forte valeur pour l'organisateur

Ce dernier point rejoint la découverte la plus utile de la mise au point : **le nombre de
batteurs détermine le nombre de groupes réalisables**. Sur la session testée, trois
batteurs pour treize morceaux rendaient le planning infaisable ; les simulations montrent
une rupture nette entre trois et quatre batteurs, pas une dégradation progressive.

Balance peut donc servir en amont, à l'inscription : *avec tant de batteurs, de bassistes
et de pianistes inscrits, combien de groupes pourra-t-on servir ?* C'est une aide à la
politique de quotas, et probablement l'argument qui parlera le plus à un organisateur —
davantage que le confort de planification.

### Ce qu'on ignore

Rien n'indique l'usage d'un logiciel de gestion d'école de musique. Le site public est un
site classique, sans espace adhérent ni planning en ligne. L'association emploie des
intermittents, elle a donc forcément un outil de paie et d'administration — mais il n'a
pas été observé et ne communique pas avec le planning.

**À vérifier avant toute décision d'architecture**, en une conversation avec
l'organisateur : quel outil pour les adhérents et la paie, qui produit les PDF du
planning, avec quoi, et faut-il que Balance s'y raccorde ou reste autonome.

### Scénario le plus probable, à privilégier par défaut

Se greffer sur ce qui existe plutôt que d'imposer un système :

- **Entrée** : lire directement leur classeur — l'onglet `Liste` a déjà la bonne structure,
  il a été converti sans difficulté pendant la mise au point
- **Sortie** : produire les états au format qu'ils diffusent — un onglet `Résa salles`
  rempli, et des PDF par journée déposables sur le Drive
- **Aucun changement d'habitude** : ils continuent avec le tableur et le Drive, Balance
  ne fait que remplacer le calcul manuel

C'est le scénario le moins coûteux et le plus susceptible d'être adopté. Un outil qui
produit exactement les documents qu'ils impriment déjà ne demande aucune conversion.

### Scénario alternatif, si un logiciel de gestion existe ou est envisagé

Si l'association utilise — ou envisage — un logiciel de type ALGEM (libre, Java,
PostgreSQL, AGPL, conçu pour les écoles de musique et les salles de répétition), le
couplage devient intéressant : il gère déjà adhérents, salles, intervenants, heures et
exports comptables, et dispose d'une interface web où chacun consulte son planning — ce
qui couvrirait gratuitement le besoin de « planning individuel ».

Balance n'apporterait alors que ce qui manque partout : **la composition des groupes par
pupitre et le solveur**.

#### Interfaces d'échange d'ALGEM — état des lieux

Recherche faite : **aucune API REST publique documentée.** Trois points d'entrée :

1. **La base PostgreSQL partagée — mécanisme assumé par le projet.** L'extension web
   d'ALGEM est une application Spring distincte qui fonctionne conjointement au logiciel
   à condition que la base leur soit commune. Un troisième programme qui s'y branche suit
   donc le schéma d'intégration prévu, ce n'est pas un détournement.
2. **Un mécanisme d'extension par jar** : une classe compilée placée dans le classpath
   dote l'organisation d'exports de données personnalisés.
3. **Des exports comptables** au format paramétrable, via la configuration.

Encourageant pour notre cas : le code comporte déjà un paquet `group` modélisant des
groupes de musiciens, ainsi que `room`, `planning` et `edition`. Les concepts existent.

Ce qui reste à établir, et qui demande un accès réel ou un contact avec l'éditeur :
**le schéma de la base n'est pas documenté publiquement**. Il faudra l'inspecter.

#### Précautions

Écrire dans la base d'un logiciel tiers reste risqué (schéma mouvant — lire directement,
écrire en mode simulation d'abord) ; la licence AGPL mérite un examen selon que Balance
reste un programme séparé ou du code intégré ; et il vaut mieux prendre contact avec
l'équipe du projet avant de développer un greffon.

**Vérifier aussi la vitalité du projet** : le dépôt public paraît peu actif (peu
d'étoiles, dernières contributions surtout automatiques). Le développement et le support
semblent passer par l'éditeur plutôt que par GitHub — à confirmer avant de miser dessus.

**Ne pas engager ce chantier sans confirmation.** Introduire un logiciel de gestion dans
une organisation qui fonctionne au tableur depuis trente ans est un projet en soi,
beaucoup plus lourd que Balance.

### Sur le solveur, selon le scénario

Le choix entre heuristique embarquée et CP-SAT dépend directement de là :

- **Fichier autonome, usage sur place** → heuristique, ou OR-Tools compilé en WebAssembly
- **Serveur associatif disponible** → CP-SAT en Python, avec preuve d'optimalité et
  démonstration d'infaisabilité

D'où la recommandation du §4 : modèle de contraintes déclaratif, séparé du moteur, pour
que la décision reste ouverte.

---

## 12. Portabilité : changer de lieu, changer de session

**Exigence du commanditaire.** L'outil doit servir aux sessions suivantes, y compris dans
un autre lieu. Aucune donnée de lieu, de date ou de calendrier ne doit subsister dans le
code — c'est le principal défaut du prototype.

### Trois jeux de données indépendants

Séparer nettement, chacun exportable et réimportable **séparément** :

1. **Profil de lieu** — les salles : nom, jauge, équipement, restrictions horaires.
   Écrit une fois par lieu, réutilisé à chaque session qui s'y tient.
2. **Profil de session** — dates, grille de créneaux, date butoir, plafond de morceaux,
   nombre de répétitions visé et minimum acceptable.
3. **Inscriptions** — personnes et groupes. Propre à chaque session.

Un lieu déjà connu se recharge en un clic ; seules les inscriptions sont à ressaisir.

### Définir une grille de créneaux sans les énumérer

La session actuelle compte 26 créneaux. Les saisir un par un serait rédhibitoire. Il faut
les décrire **par règles**, l'outil les déploie :

- « tous les jours, 09:00–10:00 » ; « tous les jours, 13:30–14:30 »
- « lundi, 16:30–20:30, découpé en tours d'une heure »
- « du lundi au mercredi, 22:00–24:00, tours d'une heure »
- « le dernier jour, tours de 30 minutes seulement »
- exceptions ponctuelles : un jour retiré, une plage bloquée par une réunion

Avec, pour chaque règle, les salles concernées — toutes, ou une sélection.

### Assistant de première configuration

Au premier lancement, sans données : demander le lieu et ses salles, les dates, la grille
de créneaux, puis proposer d'importer les inscriptions. Trois écrans, pas davantage.

Prévoir aussi **la duplication d'une session précédente** comme point de départ : c'est le
cas d'usage le plus fréquent, une session ressemble beaucoup à la précédente.

### Vocabulaire paramétrable

Les pupitres (chant, piano, basse, batterie, guitare, vents) sont ceux de ce stage. Un
autre lieu, un autre répertoire, et la liste change. Elle doit être éditable, et l'ordre
des colonnes du tableau de saisie doit suivre.

De même pour ce qui est aujourd'hui figé : le seuil de « grand groupe », les durées par
défaut, les libellés.

---

## 13. Sites éloignés : temps de trajet entre salles

Sur le lieu actuel, les salles sont voisines et le déplacement est négligeable. Ce ne sera
pas vrai partout : un stage réparti sur plusieurs bâtiments, voire plusieurs communes,
change la nature du problème. À prévoir dès la conception, même si la fonction reste
désactivée par défaut.

### Ce qui change

Un musicien qui termine une répétition salle A à 15:00 et en commence une salle B à 15:00
ne peut pas y être. Aujourd'hui l'outil l'autorise, parce qu'il considère les créneaux
comme instantanément enchaînables.

Et le trajet **mange la séance** : dix minutes de marche entre deux bâtiments, sur une
répétition d'une heure, c'est un sixième du temps perdu — et le groupe qui attend est
pénalisé autant que celui qui arrive.

### Saisie

Une matrice complète salle × salle serait pénible à remplir. Préférer deux niveaux :

- **Regrouper les salles en sites** (bâtiment, annexe, gymnase…)
- **Une matrice site × site** en minutes, symétrique par défaut
- Trajet intra-site : une valeur unique par site, souvent zéro
- Surcharge ponctuelle possible pour une salle particulière (étage sans ascenseur,
  bâtiment à l'écart)

### Contraintes à ajouter

**Dure** — entre deux engagements d'une même personne, l'écart doit couvrir le trajet.
S'il ne le couvre pas, le placement est refusé.

**Préférence** — minimiser les déplacements : garder une personne sur le même site
sur une même demi-journée, limiter le nombre de changements de site par jour.

**Affichage** — signaler dans la feuille de route les enchaînements serrés, avec le temps
de trajet et la durée réellement disponible. Un groupe qui perd dix minutes doit le savoir.

### Conséquence architecturale — le point important

Dans le prototype, le placement horaire se fait d'abord, l'attribution des salles ensuite.
Ça tient tant que les salles sont interchangeables. **Avec des temps de trajet, ce n'est
plus vrai** : le choix d'une salle peut rendre un horaire infaisable pour un musicien qui
vient d'ailleurs. Les deux étapes deviennent couplées.

Deux voies : les résoudre ensemble, ou conserver la séparation avec une boucle de retour
qui invalide un placement horaire quand aucune attribution de salles ne le satisfait. La
seconde est plus simple à faire évoluer depuis l'existant.

À prévoir dans la structure du code même si la fonction n'est pas livrée tout de suite.

---

## 14. Présentation à l'organisateur

Ce qui convainc, dans l'ordre :

1. **Charger les données réelles de la session** et lancer le calcul — treize morceaux
   placés en une seconde, sans conflit.
2. **Montrer le diagnostic** : provoquer un blocage en ajoutant un engagement à quelqu'un
   de déjà chargé, et voir l'outil expliquer pourquoi et proposer un levier.
3. **Montrer l'aide aux quotas d'inscription** — faire varier le nombre de batteurs ou de
   bassistes et voir combien de groupes deviennent réalisables. C'est l'argument le plus
   parlant pour qui gère six sessions par an et contingente déjà les places par instrument.
   *(Le changement de lieu, lui, n'a pas à être démontré : il n'arrive que tous les
   quelques années.)*
4. **Imprimer les deux états** : la feuille de route d'un groupe, l'occupation d'une salle.

Prévoir donc dans les jeux d'essai de quoi faire varier les effectifs par pupitre, pour
cette démonstration.

Ce qu'il vaut mieux annoncer d'emblée : l'outil ne décide de rien de musical. Il ne sait
pas quel morceau sacrifier, ni qui doit céder sa place à la batterie. Il calcule ce qui
est possible et explique ce qui ne l'est pas — les arbitrages restent humains.

