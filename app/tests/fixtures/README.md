# Fixtures Balance

Jeux d'essai versionnés utilisés par la suite `vitest` et pour reproduire à la main
les scénarios de spec Stéphane. Tout ajout ou modification ici doit être justifié
en commit — ces fichiers servent de contrat de non-régression.

## Format `.xlsx` (structure de terrain — Sujet C)

| Fichier | Contenu | Utilisé par |
|---------|---------|-------------|
| `identites-ambigues.xlsx` | 20 stagiaires, 6 morceaux, cas A à H (identité) | `alertes-import.test.ts` (baseline) |
| `identites-ambigues-corrige.json` | Corrigé Stéphane des attendus (types + occurrences) | Contrat de test |
| `coherence-onglets.xlsx` | 15 stagiaires, 8 morceaux, cas I à P (cohérence entre onglets) | `coherence.test.ts` (e2e) |
| `coherence-onglets-corrige.json` | Corrigé Stéphane du décompte alertes/signalements attendus | Contrat de test |
| `balance-stress-test.xlsx` | 84 stagiaires, 20 morceaux, 36 séances — cas volume | `alertes-import.test.ts` (volume) |

Les `.corrige.json` sont rédigés en français, lisibles côté humain. Ils font
partie de la spec ; leur mise à jour est du ressort de Stéphane, pas du code.

## Format `.json` legacy (fixtures du prototype)

| Fichier | Contenu | Notes |
|---------|---------|-------|
| `demo_session5.json` | Cas nominal, 5 groupes | Ancien format prototype, lisible par `parseLegacyInscriptions` |
| `demo_session5_sature.json` | 8 groupes, 16 morceaux pour un plafond de 13 — déclenche arbitrage | Idem |

Historiquement rangés sous `app/` (racine), déplacés ici pour cohérence. Le
composant `App.svelte` référence `apero_mercredi.json` via `src/fixtures/`
(chemin distinct — géré par le bundler Vite). Les deux `demo_session5*` ne
sont **pas** importés directement par le code ; ils servent au test manuel :

1. Démarrer l'app en mode vide (sans `?demo=apero`)
2. Utiliser l'écran d'import unique → import JSON → sélectionner le fichier
3. Observer le comportement selon la situation (nominal vs saturé)
