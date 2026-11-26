// The metric stand-in loader. It has no style-sheet import of its own, so tools that run outside the app can load it.
/** Open metric stand-ins: same advance widths as the Microsoft font they replace, so a Word page breaks the same. */
export const METRIC_STAND_INS = { Calibri: 'Carlito', Cambria: 'Caladea' } as const;

export type BundledStandIn = (typeof METRIC_STAND_INS)[keyof typeof METRIC_STAND_INS];

// Each import makes its own chunk. Nothing here runs at start-up: the files load when a run first uses the family.
const LOADERS: Record<BundledStandIn, () => Promise<unknown>> = {
  Carlito: () => import('./fonts/carlito.css'),
  Caladea: () => import('./fonts/caladea.css'),
};

/** The bundled stand-in for a font name, or undefined when it has none. Names compare without case. */
export function standInFor(fontName: string): BundledStandIn | undefined {
  const wanted = fontName.trim().toLowerCase();
  const found = Object.entries(METRIC_STAND_INS).find(([name]) => name.toLowerCase() === wanted);
  return found?.[1];
}

const requested = new Map<BundledStandIn, Promise<void>>();

/**
 * Makes the stand-in for a font name ready to draw. Resolves when its style rules are in the page (the font files
 * themselves load when a glyph needs them). A name with no stand-in resolves at once. Safe to call again.
 */
export function loadStandIn(fontName: string): Promise<void> {
  const family = standInFor(fontName);
  if (family === undefined) return Promise.resolve();
  let pending = requested.get(family);
  if (pending === undefined) {
    pending = LOADERS[family]().then(
      () => undefined,
      (error: unknown) => {
        requested.delete(family); // A failed load can be tried again.
        throw error;
      },
    );
    requested.set(family, pending);
  }
  return pending;
}
