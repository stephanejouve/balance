/// <reference types="svelte" />
/// <reference types="vite/client" />

// Version bundlée injectée par vite (`define`) au build. Format
// `YYYYMMDD.HHMM` UTC — string-comparable, monotone. Voir vite.config.ts.
declare const __APP_VERSION__: string

// SHA court (7 caractères) du commit au moment du build. Permet de
// vérifier CE QUI a été construit, quand `__APP_VERSION__` dit QUAND.
// Chaîne vide si le build n'a pas eu accès à un repo git. Voir vite.config.ts.
declare const __APP_SHA__: string
