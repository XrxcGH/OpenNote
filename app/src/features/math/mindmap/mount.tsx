// How the page draws a mind map block: a React root in the block's wrapper. Every change is one patch of the map, with
// the outline as the block's fallback text, so search, read aloud, and exports see the map as a nested list.
import { createRoot } from 'react-dom/client';
import { MindMap } from './MindMap';
import { toOutline } from './tree';

export interface MindMapBlockProps {
  data: Record<string, unknown>;
  readOnly: boolean;
  patch(data: Record<string, unknown>, fallback?: string): void;
}

export function mountMindMap(container: HTMLElement, props: MindMapBlockProps) {
  const root = createRoot(container);
  const draw = (next: MindMapBlockProps) =>
    root.render(
      <MindMap
        data={next.data}
        readOnly={next.readOnly}
        onChange={(map) => next.patch({ root: map }, toOutline(map))}
      />,
    );
  draw(props);
  return { update: draw, destroy: () => setTimeout(() => root.unmount(), 0) };
}
