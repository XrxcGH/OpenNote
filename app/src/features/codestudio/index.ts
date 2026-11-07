// The code studio's public face: what other features may import.
// Owner: code:L00 (B11), which adds the contracts. shared:x-shared landed it with the window loader the tool
// window host needs, so the window stays in a lazy chunk of its own.

/** Loads the studio window's chunk (features/codestudio/window, code:L04). */
export const loadCodeStudioWindow = () => import('./window');
