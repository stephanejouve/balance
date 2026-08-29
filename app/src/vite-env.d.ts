/// <reference types="svelte" />
/// <reference types="vite/client" />

// Version bundlée injectée par vite (`define`) au build. Format
// `YYYYMMDD.HHMM` UTC — string-comparable, monotone. Voir vite.config.ts.
declare const __APP_VERSION__: string
