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

/** How long to wait before asking again for a node whose read failed, and how many times to ask. */
const RETRY_MS = 500;
const RETRIES = 3;

/** The nodes in order, and whether any read failed (a refusal, as opposed to a node that is not there). */
async function load(
  notes: NotesService,
  ids: readonly (NodeId | null)[],
): Promise<{ nodes: (NodeSummary | null)[]; failed: boolean }> {
  let failed = false;
  const nodes = await Promise.all(
    ids.map((id) =>
      id
        ? notes.get(id).catch(() => {
            failed = true;
            return null;
          })
        : null,
    ),
  );
  return { nodes, failed };
}

/** The summaries of several nodes, in order, with null for a missing id or a node that no longer exists. */
export function useNodes(ids: readonly (NodeId | null)[]): readonly (NodeSummary | null)[] {
  const notes = useNotes();
  const key = ids.join('\n');
  const [state, setState] = useState<{ key: string; nodes: (NodeSummary | null)[] }>({ key: '', nodes: [] });
  useEffect(() => {
    const wanted = key ? (key.split('\n') as (NodeId | '')[]).map((id) => id || null) : [];
    let current = true;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const refresh = () =>
      void load(notes, wanted).then(({ nodes, failed }) => {
        if (!current) return;
        setState({ key, nodes });
        // A read that failed once (the service busy while the window resized) would leave the title blank until
        // something else touched the node, so ask again a few times.
        clearTimeout(retry);
        if (failed && tries < RETRIES) retry = setTimeout(refresh, RETRY_MS * ++tries);
      });
    refresh();
    const present = wanted.filter((id): id is NodeId => id !== null);
    const stop = notes.watch((event) => touches(event, present) && refresh());
    return () => {
      current = false;
      clearTimeout(retry);
      stop();
    };
  }, [notes, key]);
  return state.key === key ? state.nodes : ids.map(() => null);
}

export function useNode(id: NodeId | null): NodeSummary | null {
  return useNodes([id])[0] ?? null;
}
