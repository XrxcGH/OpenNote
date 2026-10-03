// highlight.js ships one grammar per file, typed only through its main entry (owner: WP6).
declare module 'highlight.js/lib/languages/*' {
  import type { LanguageFn } from 'highlight.js';

  const grammar: LanguageFn;
  export default grammar;
}
