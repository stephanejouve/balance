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

### Placement
Recherche par redémarrages aléatoires : ordre des groupes rebattu à chaque essai,
attribution par **tours de table** (chaque groupe obtient sa 1ʳᵉ répétition, puis la 2ᵉ,
puis la 3ᵉ) plutôt que groupe par groupe — sans ça, les premiers groupes accaparent les
meilleurs créneaux. Phase de **réparation par échange** pour les groupes restés
incomplets. Environ 2 500 essais, moins d'une seconde.

Ce n'est pas un solveur exact, et ça suffit : sur un cas de test, une recherche
exhaustive a confirmé que l'heuristique trouvait l'optimum.

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

### Les deux états indispensables
- **Feuille de route par groupe** — pour chaque morceau : responsable, tonalité, effectif,
  et ses répétitions (jour, horaire, salle)
- **Occupation par salle** — une feuille par salle, chronologique, créneaux libres
  compris, à afficher sur la porte

Les deux doivent être **imprimables séparément** (sans les formulaires) et **exportables
en CSV** (séparateur `;`, BOM UTF-8 pour Excel) — `balance_feuilles_de_route.csv` et `balance_occupation_par_salle.csv`.

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

## 11. Portabilité : changer de lieu, changer de session

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

## 12. Présentation à l'organisateur

Ce qui convainc, dans l'ordre :

1. **Charger les données réelles de la session** et lancer le calcul — treize morceaux
   placés en une seconde, sans conflit.
2. **Montrer le diagnostic** : provoquer un blocage en ajoutant un engagement à quelqu'un
   de déjà chargé, et voir l'outil expliquer pourquoi et proposer un levier.
3. **Changer de lieu en direct** — charger un second profil avec d'autres salles, et
   relancer. C'est ce qui prouve que l'outil n'est pas jetable.
4. **Imprimer les deux états** : la feuille de route d'un groupe, l'occupation d'une salle.

Prévoir donc **un second profil de lieu fictif** dans les jeux d'essai, uniquement pour
cette démonstration.

Ce qu'il vaut mieux annoncer d'emblée : l'outil ne décide de rien de musical. Il ne sait
pas quel morceau sacrifier, ni qui doit céder sa place à la batterie. Il calcule ce qui
est possible et explique ce qui ne l'est pas — les arbitrages restent humains.

