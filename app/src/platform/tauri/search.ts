// Search and linking through the shell (Phase 8). Every method is one `search_call` command with a name and its
// arguments, so the shell's command list stays short. The index reads the notebooks in the notes folder through
// the core, so page IDs are the tree's own and the interface sends the index nothing.
import type {
  Backlink,
  HeadingRef,
  IndexStatus,
  LinkEdit,
  LinkPreview,
  Mention,
  PageSuggestion,
  Resolution,
  SearchClient,
  SearchResponse,
  SwitchResponse,
  TagNode,
  TagPlan,
  UnlinkedMention,
} from '../../services/search/types';
import { invoke, listen } from './invoke';
import { createTauriSearchExtras } from './searchExtras';

function call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  return invoke('search_call', { method, args }) as Promise<T>;
}

export function createTauriSearch(): SearchClient {
  const none = (method: string, args?: Record<string, unknown>) => call<null>(method, args).then(() => undefined);
  return {
    capabilities: { places: true, feed: false },
    sync: () => Promise.resolve(),
    search: (request) => call<SearchResponse>('query', { ...request }),
    switcher: (request) => call<SwitchResponse>('switcher', { ...request }),
    suggestPages: (prefix, limit) => call<PageSuggestion[]>('suggestPages', { prefix, limit }),
    headings: (page) => call<HeadingRef[]>('headings', { page }),
    resolve: (links, from) => call<Resolution[]>('resolve', { links, from }),
    linkPreview: (request) => call<LinkPreview | null>('linkPreview', { ...request }),
    backlinks: (page) => call<Backlink[]>('backlinks', { page }),
    unlinkedMentions: (page, limit) => call<UnlinkedMention[]>('unlinkedMentions', { page, limit }),
    findMentions: (markdown, title) => call<Mention[]>('findMentions', { markdown, title }),
    linkMentions: (markdown, title, target, which) =>
      call<{ markdown: string; count: number } | null>('linkMentions', { markdown, title, target, which }),
    repairEdits: (page) => call<LinkEdit[]>('repairEdits', { page }),
    tagTree: () => call<TagNode[]>('tagTree'),
    planTagRename: (from, to) => call<TagPlan>('planTagRename', { from, to }),
    planTagDelete: (tag) => call<TagPlan>('planTagDelete', { from: tag }),
    titleSettled: (page) => none('titleSettled', { page }),
    status: () => call<IndexStatus>('status'),
    rebuild: () => none('rebuild'),
    flush: () => none('flush'),
    onUpdate: (listener) => listen('search:updated', listener),
    extras: createTauriSearchExtras(call),
  };
}
