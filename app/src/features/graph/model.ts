// Graph view model: the pages and links to draw after the filters, and the Connections of one page. The filters use
// tags, sections, and property values, the same ones collections use.
import { fieldNamed, readFields } from '../search';
import type { Field } from '../search';
import type { GraphEdge, GraphPage, LinkGraphData, PageFact } from '../../services/search/types';

export interface GraphFilter {
  tag: string;
  section: string;
  /** A property name and the value its page must show, or empty. */
  property: string;
  propertyValue: string;
}

export const NO_FILTER: GraphFilter = { tag: '', section: '', property: '', propertyValue: '' };

export interface Drawn {
  pages: GraphPage[];
  /** Pairs of numbers into `pages`. */
  edges: [number, number][];
  /** Pages the filters left out, or the view had no room for. */
  hidden: number;
}

const folded = (text: string) => text.trim().toLowerCase();

function showsValue(field: Field | undefined, wanted: string): boolean {
  if (!field) return false;
  const text = field.type === 'page' ? (field.label ?? '') : String(field.value ?? '');
  return folded(text) === folded(wanted);
}

/** Whether a page passes the filters. A page without facts passes only when nothing is filtered. */
export function passes(fact: PageFact | undefined, filter: GraphFilter): boolean {
  const filtered = filter.tag || filter.section || filter.property;
  if (!fact) return !filtered;
  const tag = folded(filter.tag);
  if (tag && !fact.tags.some((have) => have === tag || have.startsWith(`${tag}/`))) return false;
  if (filter.section && fact.section !== filter.section) return false;
  if (filter.property) {
    const field = fieldNamed(readFields({ properties: fact.properties }), filter.property);
    if (filter.propertyValue ? !showsValue(field, filter.propertyValue) : !field) return false;
  }
  return true;
}

/**
 * The pages and links to draw. `only` limits the graph to a neighborhood. Links between pages that both stay are
 * kept, one line for each pair however many links join them.
 */
export function drawn(data: LinkGraphData, facts: ReadonlyMap<string, PageFact>, filter: GraphFilter, only: ReadonlySet<string> | null): Drawn {
  const pages = data.pages.filter((page) => (!only || only.has(page.page)) && passes(facts.get(page.page), filter));
  const at = new Map(pages.map((page, index) => [page.page, index]));
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const edge of data.edges as GraphEdge[]) {
    const from = at.get(edge.from);
    const to = at.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push([from, to]);
  }
  return { pages, edges, hidden: data.pages.length - pages.length };
}

/** The pages that no link joins to another, among those drawn. */
export function unlinked(shown: Drawn): GraphPage[] {
  const linked = new Set(shown.edges.flat());
  return shown.pages.filter((_, index) => !linked.has(index));
}
