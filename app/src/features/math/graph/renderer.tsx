// How the page mounts a graph into the element the editor keeps after a "graph" code block (Phase 10). A block whose
// first line is "@3d" is a 3D graph (space/Graph3DView), drawn by its own view where the math.graph3d flag is on.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { isEnabled } from '../../../app/flags';
import type { GraphRenderer } from '../../../editor/host';
import { Graph3DView } from '../space/Graph3DView';
import { is3dGraph } from '../space/source3d';
import { GraphView } from './GraphView';

export const graphRenderer: GraphRenderer = {
  mount(container, initial) {
    const root = createRoot(container);
    const draw = (props: typeof initial) =>
      root.render(createElement(is3dGraph(props.source) && isEnabled('math.graph3d') ? Graph3DView : GraphView, props));
    draw(initial);
    return {
      update: draw,
      // React warns when a root unmounts during another root's render, so it waits a task.
      destroy: () => setTimeout(() => root.unmount(), 0),
    };
  },
};
