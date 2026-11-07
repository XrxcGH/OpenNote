// The attribute that carries paragraph formatting through the clipboard as JSON (ADR 0084). Copy writes it
// (serializer.ts) and paste reads it (features/page/paste/paraRules.ts), so the name lives in one place.
export const PARA_DATA = 'data-paste-para';

/** The attribute OpenNote's copy puts on its first element (ADR 0084). ProseMirror's own `data-pm-slice` is written
 * by every ProseMirror app, so it alone proves nothing about where a paste came from. */
export const COPY_MARKER = 'data-opennote-copy';
