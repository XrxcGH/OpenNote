// Which sections the Home page shows and in what order. The person can reorder or hide them; a section the
// saved choice does not know yet (one added in a later version) shows at the end.

export const HOME_SECTIONS = ['recent', 'pinned', 'today', 'saved', 'upcoming'] as const;
export type HomeSectionId = (typeof HOME_SECTIONS)[number];

export interface HomeChoice {
  readonly order?: readonly string[];
  readonly hidden?: readonly string[];
}

const known = (id: string): id is HomeSectionId => (HOME_SECTIONS as readonly string[]).includes(id);

/** The sections in order, split into the ones shown and the ones hidden. */
export function arrange(choice: HomeChoice | undefined): { shown: HomeSectionId[]; hidden: HomeSectionId[] } {
  const saved = (choice?.order ?? []).filter(known);
  const order = [...new Set([...saved, ...HOME_SECTIONS])];
  const hidden = new Set((choice?.hidden ?? []).filter(known));
  return { shown: order.filter((id) => !hidden.has(id)), hidden: order.filter((id) => hidden.has(id)) };
}

/** The order with one section moved a step up (-1) or down (1) among the shown ones. */
export function moved(shown: readonly HomeSectionId[], id: HomeSectionId, step: 1 | -1): HomeSectionId[] {
  const at = shown.indexOf(id);
  const to = at + step;
  if (at === -1 || to < 0 || to >= shown.length) return [...shown];
  const next = [...shown];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}
