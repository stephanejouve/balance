# Règles de saisie — désambiguation forcée

À implémenter dans l'UI de saisie (S5). Ces règles sont un **durcissement** de la
détection d'identité du prototype : au lieu d'alerter *a posteriori*, on **bloque
à la saisie** tant que la personne n'est pas non-ambiguë.

## Règle 1 — Homonymes bloqués

Si l'utilisateur tente d'ajouter une personne dont le prénom (ou l'entrée
complète) existe déjà dans une autre formation, l'UI **exige un discriminant**
avant de valider :

- ajout d'une initiale (`David R.`, `David T.`)
- ou d'un nom entre parenthèses (`Pierre (SIG)`, `Pierre (L)` — convention issue
  du terrain, cf. piège §7 du brief)

L'entrée n'est pas enregistrée tant que le doublon n'est pas levé.

## Règle 2 — Multi-instruments dont chant bloqués

Si un prénom apparaît avec **plusieurs instruments différents** et que **le
chant** figure parmi eux, l'UI exige aussi une désambiguation.

Justification : un chanteur qui joue aussi un instrument est rare dans la
communauté ; le vrai polyvalent connu utilise déjà un discriminant (`Emmanuelle
(B)`, `Beate (B)`). Une collision `Sylvain (chant)` + `Sylvain (guitare)` sans
discriminant est bien plus probablement deux personnes.

À noter : les combinaisons instrument+instrument (sans chant) restent traitées
comme polyvalence sans blocage, sauf si le contexte devient ambigu (à préciser
à l'implémentation).

## Comportement UI attendu

- Feedback immédiat au moment de la frappe (pas au submit)
- Suggestion des discriminants existants (`Pierre (SIG)`, `Pierre (L)`) pour
  éviter les inventions incohérentes
- Message clair : *"Un David existe déjà dans « 02 · For Me Formidable ». Ajoute
  une initiale ou un nom pour distinguer."*
- La whitelist `identitesConnues` du prototype devient inutile : la
  désambiguation à la saisie garantit l'unicité.

## Tests de non-régression associés

Reprendre les cas historiques du prototype comme fixtures :

- 13 prénoms seuls dans `apero_mercredi.json` (Dominique, David, Gaël, …) — la
  saisie de l'un d'eux dans un second groupe doit déclencher le blocage.
- `Sylvain (chant)` puis `Sylvain (guitare)` — blocage règle 2.
- `Emmanuelle (B) (chant)` puis `Emmanuelle (B) (piano)` — pas de blocage
  (discriminant `(B)` déjà présent).
