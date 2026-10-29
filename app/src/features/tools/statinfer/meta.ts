// The tools of the statistics kit, in the order of its tabs, with their palette icons. The words for each are under
// kitStatInfer.tools, kitStatInfer.open, and kitStatInfer.keywords; registrations/kitStatInfer.ts repeats this list
// so the palette knows the commands without loading the kit (the kit's test checks the two agree).
export const STAT_KIT_ID = 'statinfer';

/** The tool window that holds the kit. */
export const KIT_WINDOW = 'kit-statinfer';

export const STAT_TOOLS = [
  ['describe', 'ChartBar'],
  ['tables', 'Table'],
  ['epi', 'FirstAidKit'],
  ['correlation', 'ChartScatter'],
  ['ranks', 'Ranking'],
  ['multiple', 'ListNumbers'],
  ['resample', 'Shuffle'],
  ['design', 'GridFour'],
] as const;

export type StatTool = (typeof STAT_TOOLS)[number][0];
