// The search methods Beta 4 added (see core_bridge/search/extras.rs), each one a call of the `search_call` command.
import type {
  Connections,
  LinkGraphData,
  MediaKind,
  Neighbor,
  PageFact,
  SearchExtras,
  TaggedBlock,
  TextHit,
} from '../../services/search/types';

type Call = <T>(method: string, args?: Record<string, unknown>) => Promise<T>;

export function createTauriSearchExtras(call: Call): SearchExtras {
  return {
    launchLink: () => call<string | null>('launchLink'),
    pageFacts: (notebook) => call<PageFact[]>('pageFacts', { notebook: notebook ?? null }),
    taggedBlocks: (scope) => call<TaggedBlock[]>('taggedBlocks', { scope }),
    setMediaText: (page, block, kind, text) => call<boolean>('setMediaText', { page, block, kind, text }),
    mediaBlocks: (page) => call<{ block: string; kind: MediaKind }[]>('mediaBlocks', { page }),
    findText: (needle, limit) => call<TextHit[]>('findText', { needle, limit }),
    linkGraph: (notebook) => call<LinkGraphData>('graph', { notebook: notebook ?? null }),
    neighbors: (page, depth) => call<Neighbor[]>('neighbors', { page, depth }),
    connections: (page) => call<Connections>('connections', { page }),
  };
}
