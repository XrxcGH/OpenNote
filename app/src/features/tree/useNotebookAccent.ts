// The open page's notebook color, as one of the seven pen names. The breadcrumb dot, the active tab's edge and the
// page title's rule all read it, so one notebook shows one color across the screen. Section colors are not used.

import { useLocation } from '../../app/location';
import type { ChipColor, NodeId, NodeSummary } from '../../services/notes/types';
import { useNodes } from '../../shell/layout/useNode';
import { useTreeNode } from './access';

function penOf(node: NodeSummary | null | undefined): ChipColor | null {
  return node?.kind === 'notebook' ? node.color : null;
}

/** The pen of any notebook the tree knows (a tab's own notebook), or null for no color or an unknown notebook. */
export function useNotebookAccentOf(notebookId: NodeId | null): ChipColor | null {
  return penOf(useTreeNode(notebookId));
}

/** The pen of the notebook that holds the open page, or null outside the workspace and for an uncolored notebook. */
export function useNotebookAccent(): ChipColor | null {
  const location = useLocation();
  const [node] = useNodes([location.view === 'workspace' ? location.notebookId : null]);
  return penOf(node);
}
