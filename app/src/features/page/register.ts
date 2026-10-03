// Registers the page zoom commands. They have no shortcuts, because Ctrl+=, Ctrl+-, and Ctrl+0 change the text size
// everywhere. Ctrl+wheel over the page is the pointer way (amendment P2-13), and the palette is the keyboard way.

import { defineCommand } from '../../commands/registry';
import { commands } from '../../registries';
import { canZoomPage, resetPageZoom, stepPageZoom } from './zoom';

const ZOOM = [
  { id: 'page.zoomIn', title: 'page.zoom.in', run: () => stepPageZoom(1) },
  { id: 'page.zoomOut', title: 'page.zoom.out', run: () => stepPageZoom(-1) },
  { id: 'page.zoomReset', title: 'page.zoom.reset', run: resetPageZoom },
] as const;

for (const { id, title, run } of ZOOM) {
  commands.register(
    defineCommand({ id, title, keywords: 'page.zoom.keywords', category: 'view', enabled: canZoomPage, run }),
  );
}
