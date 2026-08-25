# Refactor App.svelte — God script à découper

`src/App.svelte` a atteint **~2500 lignes** — c'est un God script /
kitchen sink au sens des anti-patterns : un unique composant qui
empile état, actions, formulaires d'édition, sections d'affichage,
composants métier et styles.

Ce n'est pas ingérable — le fichier reste organisé en blocs `<details>`
et `{#if vue === …}` — mais la maintenance devient coûteuse et la
cohabitation avec plusieurs auteurs difficile.

## État courant

- Extraction faite : `vues/Quotas.svelte` (preuve de concept)
- 5 vues Résultat restantes à extraire (Par groupe, Par salle, Par
  musicien, Carte, Concert)
- 8 sections d'édition à extraire (Source, Personnes, Inscriptions,
  Imposés, Indispos, Lieu, Session, Contraintes)

## Cible

```
app/src/
├── App.svelte                (orchestrateur + state, ~300 lignes)
├── stores.ts                 (state réactif partagé si besoin)
├── vues/
│   ├── ParGroupe.svelte
│   ├── ParSalle.svelte
│   ├── ParMusicien.svelte
│   ├── Carte.svelte
│   ├── Concert.svelte
│   └── Quotas.svelte         ✓ fait
└── edition/
    ├── Source.svelte         (import Excel / JSON / démo / nouvelle)
    ├── Personnes.svelte
    ├── Inscriptions.svelte
    ├── Imposes.svelte
    ├── Indispos.svelte
    ├── Lieu.svelte
    ├── Session.svelte
    └── Contraintes.svelte
```

## Convention props

Chaque composant reçoit ses données en props explicites (`$props()`)
et remonte les modifications via callbacks. Le state central reste
dans App.svelte pour V1.1 ; une V2 pourra migrer vers des stores
Svelte si le pattern se révèle utile.

Les styles partagés (chip, badge, msg…) doivent être extraits en
`app.css` global — la duplication actuelle via `:global()` par
composant n'est pas viable à long terme.
