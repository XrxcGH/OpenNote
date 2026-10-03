// Reads notebook, section, and page summaries for the shell: the breadcrumb, the window title, the rails, and the
// compact app bar. Each follows the notes service's events, so a rename shows at once.

import { useEffect, useState } from 'react';
import { useNotes } from '../../services/notes';
import type { NodeId, NodeSummary, NotesEvent, NotesService } from '../../services/notes/types';

function touches(event: NotesEvent, ids: readonly NodeId[]): boolean {
  if (event.type === 'reset') return true;
  if (event.type === 'upserted') return event.nodes.some((node) => ids.includes(node.id));
  if (event.type === 'removed') return event.ids.some((id) => ids.includes(id));
  return false;
}

async function load(notes: NotesService, ids: readonly (NodeId | null)[]): Promise<(NodeSummary | null)[]> {
  return Promise.all(ids.map((id) => (id ? notes.get(id).catch(() => null) : null)));
}

/** The summaries of several nodes, in order, with null for a missing id or a node that no longer exists. */
export function useNodes(ids: readonly (NodeId | null)[]): readonly (NodeSummary | null)[] {
  const notes = useNotes();
  const key = ids.join('\n');
  const [state, setState] = useState<{ key: string; nodes: (NodeSummary | null)[] }>({ key: '', nodes: [] });
  useEffect(() => {
    const wanted = key ? (key.split('\n') as (NodeId | '')[]).map((id) => id || null) : [];
    let current = true;
    const refresh = () => void load(notes, wanted).then((nodes) => current && setState({ key, nodes }));
    refresh();
    const present = wanted.filter((id): id is NodeId => id !== null);
    const stop = notes.watch((event) => touches(event, present) && refresh());
    return () => {
      current = false;
      stop();
    };
  }, [notes, key]);
  return state.key === key ? state.nodes : ids.map(() => null);
}

export function useNode(id: NodeId | null): NodeSummary | null {
  return useNodes([id])[0] ?? null;
}
