// The tools of the history, places, languages, and texts kit: an id, an icon, and the order they are listed in.
// Start-up code reads this list to register one palette command per tool, so it holds data only.

export const HUMANITIES_TOOLS = [{ id: 'frames', icon: 'Layout' }] as const;

export type HumanitiesToolId = (typeof HUMANITIES_TOOLS)[number]['id'];

export const isHumanitiesTool = (value: unknown): value is HumanitiesToolId =>
  HUMANITIES_TOOLS.some((tool) => tool.id === value);
