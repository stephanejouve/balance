# Refactor App.svelte — God script à découper

`src/App.svelte` a atteint **~2500 lignes** — c'est un God script /
kitchen sink au sens des anti-patterns : un unique composant qui
empile état, actions, formulaires d'édition, sections d'affichage,
composants métier et styles.

Ce n'est pas ingérable — le fichier reste organisé en blocs `<details>`
et `{#if vue === …}` — mais la maintenance devient coûteuse et la
cohabitation avec plusieurs auteurs difficile.

## État courant

App.svelte est passé de **2510 → 1736 lignes** (−31%) après extraction
complète des vues et des sections d'édition en composants dédiés :

- ✅ 6 vues Résultat : `vues/{ParGroupe,ParSalle,ParMusicien,Carte,Concert,Quotas}.svelte`
- ✅ 8 sections d'édition : `edition/{Source,Personnes,Inscriptions,Imposes,Indispos,Lieu,Session,Contraintes}.svelte`

Pattern retenu : props explicites (données + callbacks). Rétro-compat
totale — les composants qui portent le nom d'un type Zod (`Inscriptions`,
`Lieu`, `Session`, `Imposes`, `Indispos`, `Personnes`) sont importés avec
un alias `XxxEdit` pour éviter les collisions.

## Ce qu'App.svelte contient encore

- `<script>` : ~830 lignes de state + handlers + $derived
- `<main>` : ~100 lignes d'orchestration (header, section Placement,
  section Résultats avec toolbar/toggle vue)
- `<style>` : ~570 lignes de styles globaux partagés par les composants
  (via cascade normale, pas de `:global()`)

## Extensions ultérieures possibles

## Structure actuelle

```
app/src/
├── App.svelte                (orchestrateur + state, 1736 lignes — cible ~800)
├── vues/                     ✓ 6 composants
│   ├── ParGroupe.svelte
│   ├── ParSalle.svelte
│   ├── ParMusicien.svelte
│   ├── Carte.svelte
│   ├── Concert.svelte
│   └── Quotas.svelte
└── edition/                  ✓ 8 composants
    ├── Source.svelte
    ├── Personnes.svelte
    ├── Inscriptions.svelte
    ├── Imposes.svelte
    ├── Indispos.svelte
    ├── Lieu.svelte
    ├── Session.svelte
    └── Contraintes.svelte
```

## Reste à faire

- Extraire les styles CSS globaux dans `app.css` (571 lignes)
- Extraire les handlers d'action (`ajouterX`, `supprimerX`, `importerY`) en modules utils
- Éventuellement passer à un store partagé `state.svelte.ts` (Svelte 5)
  pour supprimer la cascade de props/callbacks — à évaluer si l'ajout
  d'un composant devient récurrent

## Convention props

Chaque composant reçoit ses données en props explicites (`$props()`)
et remonte les modifications via callbacks. Le state central reste
dans App.svelte pour V1.1 ; une V2 pourra migrer vers des stores
Svelte si le pattern se révèle utile.

Les styles partagés (chip, badge, msg…) doivent être extraits en
`app.css` global — la duplication actuelle via `:global()` par
composant n'est pas viable à long terme.
