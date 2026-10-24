// The tools in the civil, environmental, and chemical engineering kit, in the order the window lists them. This
// module is read at start-up by the palette commands, so it holds names and icons only, never an engine.

export const CIVIL_TOOL_IDS = ['groundwater', 'water'] as const;

export type CivilToolId = (typeof CIVIL_TOOL_IDS)[number];

/** Phosphor icon names for the palette. */
export const CIVIL_ICONS: Readonly<Record<CivilToolId, string>> = {
  groundwater: 'Drop',
  water: 'Funnel',
};

export const isCivilToolId = (value: unknown): value is CivilToolId =>
  (CIVIL_TOOL_IDS as readonly unknown[]).includes(value);
