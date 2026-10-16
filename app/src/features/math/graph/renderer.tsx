// How the page mounts a graph into the element the editor keeps after a "graph" code block (Phase 10).
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { GraphRenderer } from '../../../editor/host';
import { GraphView } from './GraphView';

export const graphRenderer: GraphRenderer = {
  mount(container, initial) {
    const root = createRoot(container);
    const draw = (props: typeof initial) => root.render(createElement(GraphView, props));
    draw(initial);
    return {
      update: draw,
      // React warns when a root unmounts during another root's render, so it waits a task.
      destroy: () => setTimeout(() => root.unmount(), 0),
    };
  },
};
