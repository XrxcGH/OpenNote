// How the page draws an engineering block: a React root in the block's wrapper. The model is the block's data, and
// a text summary of it (parts and results) is its fallback, so search, read aloud, and exports keep the numbers.
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import type { BlockProps } from './canvas/shared';

export function mountPanel(Panel: ComponentType<BlockProps>) {
  return (container: HTMLElement, props: BlockProps) => {
    const root = createRoot(container);
    const draw = (next: BlockProps) =>
      root.render(<Panel data={next.data} readOnly={next.readOnly} patch={next.patch} announce={next.announce} />);
    draw(props);
    return { update: draw, destroy: () => setTimeout(() => root.unmount(), 0) };
  };
}
