// The attribute that carries paragraph formatting through the clipboard as JSON (ADR 0084). Copy writes it
// (serializer.ts) and paste reads it (features/page/paste/paraRules.ts), so the name lives in one place.
export const PARA_DATA = 'data-paste-para';
