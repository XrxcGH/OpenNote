// How the page draws a diagram block: a React root in the block's wrapper. The text is the block's data, and the same
// text in a code fence is its fallback, so search and exports keep the diagram as words.
import { createRoot } from 'react-dom/client';
import { DiagramPanel } from './DiagramPanel';
import { fallbackOf } from './kind';

export interface DiagramBlockProps {
  data: Record<string, unknown>;
  readOnly: boolean;
  patch(data: Record<string, unknown>, fallback?: string): void;
}

export function mountDiagram(container: HTMLElement, props: DiagramBlockProps) {
  const root = createRoot(container);
  const draw = (next: DiagramBlockProps) =>
    root.render(
      <DiagramPanel
        source={typeof next.data.source === 'string' ? next.data.source : ''}
        readOnly={next.readOnly}
        onChange={(source) => next.patch({ source }, fallbackOf(source))}
      />,
    );
  draw(props);
  return { update: draw, destroy: () => setTimeout(() => root.unmount(), 0) };
}
