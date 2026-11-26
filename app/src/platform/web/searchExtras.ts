// The desktop host's search extras (services/search/types.ts) in a browser, for the documentation pictures: page facts,
// tagged lines, and the link graph. They read the pages the web page service holds and the tree in the notes snapshot,
// as the host reads page files and its index. Only a test build opened with `?searchExtras` has them
// (tests/ui/docscap), so the web build and its tests keep the host's absence that the features check for.
import type { PageJson } from '../../services/pages/types';
import type {
  Connection,
  Connections,
  GraphEdge,
  LinkGraphData,
  Neighbor,
  PageFact,
  PageId,
  ScopeRef,
  SearchClient,
  SearchExtras,
  TaggedBlock,
} from '../../services/search/types';

interface TreeNode {
  id: string;
  kind: string;
  title: string;
  created?: string;
  modified?: string;
  children?: TreeNode[];
}

interface Place {
  page: PageId;
  notebook: string;
  section: string;
  title: string;
  created: number;
  modified: number;
}

const time = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);

/** Every page in the snapshot's tree, with its notebook and section. */
export function placesOf(json: string): Place[] {
  const out: Place[] = [];
  const walk = (node: TreeNode, notebook: string, section: string) => {
    if (node.kind === 'page') {
      const { id, title, created, modified } = node;
      out.push({ page: id as PageId, notebook, section, title, created: time(created), modified: time(modified) });
    }
    const inside = node.kind === 'section' ? node.id : section;
    for (const child of node.children ?? []) walk(child, notebook, inside);
  };
  for (const notebook of (JSON.parse(json) as { notebooks?: TreeNode[] }).notebooks ?? []) {
    walk(notebook, notebook.id, '');
  }
  return out;
}

interface TextData {
  markdown?: string;
  tags?: Record<string, string[]>;
  ids?: string[];
  checked?: string[];
}

const textBlocks = (page: PageJson | null) =>
  (page?.blocks ?? []).filter((b) => b.type === 'text').map((b) => ({ id: b.id, data: b.data as TextData }));
const lineTags = (data: TextData) => Object.values(data.tags ?? {}).flat();
/** An unchecked `[ ]` box, as the host looks for one. */
const openBox = (markdown: string) => /\[ \]( |\n|$)/.test(markdown);

const inScope = (place: Place, scope: ScopeRef) =>
  scope.kind === 'all' ||
  (scope.kind === 'page' && place.page === scope.id) ||
  (scope.kind === 'section' && place.section === scope.id) ||
  (scope.kind === 'notebook' && place.notebook === scope.id);

/** Where the extras read from: the memory index's links, the held pages, and the snapshot's tree. */
interface Sources {
  search: SearchClient;
  held: (page: PageId) => PageJson | null;
  tree: () => Promise<string>;
}

const placesIn = async (src: Sources) => placesOf(await src.tree());

function factOf(src: Sources, place: Place): PageFact {
  const page = src.held(place.page);
  const properties = (page?.view as { properties?: Record<string, unknown> } | undefined)?.properties;
  const tags = [...(page?.tags ?? []), ...textBlocks(page).flatMap((b) => lineTags(b.data))];
  return {
    ...place,
    title: page?.title || place.title,
    modified: page ? time(page.modified) || place.modified : place.modified,
    tags: [...new Set(tags)],
    hasProperties: properties != null && Object.keys(properties).length > 0,
    ...(properties ? { properties } : {}),
  };
}

/** The links among some pages: one edge for each page that links to another, counting its links. */
async function edgesAmong(src: Sources, pages: readonly Place[]): Promise<GraphEdge[]> {
  const ids = new Set(pages.map((p) => p.page));
  const edges: GraphEdge[] = [];
  for (const target of pages) {
    const counts = new Map<PageId, number>();
    for (const link of await src.search.backlinks(target.page)) {
      if (ids.has(link.source)) counts.set(link.source, (counts.get(link.source) ?? 0) + 1);
    }
    for (const [from, count] of counts) edges.push({ from, to: target.page, count, ambiguous: false });
  }
  return edges;
}

/** The text blocks of a scope with a line tag or an open box, as the host lists them. */
async function taggedIn(src: Sources, scope: ScopeRef): Promise<TaggedBlock[]> {
  const out: TaggedBlock[] = [];
  for (const place of (await placesIn(src)).filter((p) => inScope(p, scope))) {
    const { page, title, notebook, section, modified } = factOf(src, place);
    for (const { id, data } of textBlocks(src.held(place.page))) {
      const markdown = data.markdown ?? '';
      if (lineTags(data).length === 0 && !openBox(markdown)) continue;
      const tags = Object.fromEntries(Object.entries(data.tags ?? {}).filter(([, list]) => list.length > 0));
      const block = { block: id, markdown, ids: data.ids ?? [], tags, checked: data.checked ?? [] };
      out.push({ page, title, notebook, section, modified, ...block });
    }
  }
  return out;
}

async function graphOf(src: Sources, notebook?: string | null): Promise<LinkGraphData> {
  const pages = (await placesIn(src)).filter((p) => !notebook || p.notebook === notebook);
  const edges = await edgesAmong(src, pages);
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  return {
    pages: pages.map(({ page, title, notebook: nb, section }) => ({ page, title, notebook: nb, section })),
    edges,
    orphans: pages.filter((p) => !linked.has(p.page)).map((p) => p.page),
    broken: 0,
  };
}

/** Every link among all pages, and a page's title. */
async function allLinks(src: Sources) {
  const all = await placesIn(src);
  const title = (id: PageId) => all.find((p) => p.page === id)?.title ?? '';
  return { edges: await edgesAmong(src, all), title };
}

async function connectionsOf(src: Sources, page: PageId): Promise<Connections> {
  const { edges, title } = await allLinks(src);
  const connection = (id: PageId, count: number): Connection => ({
    page: id,
    title: title(id),
    count,
    ambiguous: false,
  });
  return {
    outgoing: edges.filter((e) => e.from === page).map((e) => connection(e.to, e.count)),
    incoming: edges.filter((e) => e.to === page).map((e) => connection(e.from, e.count)),
  };
}

/** The pages within `depth` links of a page, in either direction. */
async function neighborsOf(src: Sources, page: PageId, depth: number): Promise<Neighbor[]> {
  const { edges, title } = await allLinks(src);
  const distance = new Map<PageId, number>([[page, 0]]);
  for (let step = 1; step <= depth; step += 1) {
    for (const e of edges) {
      if (distance.get(e.from) === step - 1 && !distance.has(e.to)) distance.set(e.to, step);
      if (distance.get(e.to) === step - 1 && !distance.has(e.from)) distance.set(e.from, step);
    }
  }
  return [...distance].filter(([id]) => id !== page).map(([id, d]) => ({ page: id, title: title(id), distance: d }));
}

export function createWebSearchExtras(
  search: SearchClient,
  held: (page: PageId) => PageJson | null,
  tree: () => Promise<string>,
): SearchExtras {
  const src: Sources = { search, held, tree };
  return {
    launchLink: () => Promise.resolve(null),
    pageFacts: async (notebook) =>
      (await placesIn(src)).filter((p) => !notebook || p.notebook === notebook).map((p) => factOf(src, p)),
    taggedBlocks: (scope) => taggedIn(src, scope),
    setMediaText: () => Promise.resolve(false),
    mediaBlocks: () => Promise.resolve([]),
    findText: () => Promise.resolve([]),
    linkGraph: (notebook) => graphOf(src, notebook),
    neighbors: (page, depth) => neighborsOf(src, page, depth),
    connections: (page) => connectionsOf(src, page),
  };
}
