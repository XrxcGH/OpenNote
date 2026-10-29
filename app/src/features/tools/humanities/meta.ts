// The tools of the history, places, languages, and texts kit: an id, an icon, and the order they are listed in.
// Start-up code reads this list to register one palette command per tool, so it holds data only.

/** The kit's id for figure blocks and the shared kit registry. */
export const KIT_ID = 'humanities';

export const HUMANITIES_TOOLS = [
  { id: 'frames', icon: 'Layout' },
  { id: 'coordinates', icon: 'Compass' },
  { id: 'timeline', icon: 'ClockCounterClockwise' },
  { id: 'calendars', icon: 'CalendarBlank' },
  { id: 'keys', icon: 'Key' },
] as const;

export type HumanitiesToolId = (typeof HUMANITIES_TOOLS)[number]['id'];

export const isHumanitiesTool = (value: unknown): value is HumanitiesToolId =>
  HUMANITIES_TOOLS.some((tool) => tool.id === value);
