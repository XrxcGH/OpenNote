// WP3's registrations: page zoom for now (amendment P2-13), with the rest of the page and object commands to come.
// Ctrl+wheel over the page zooms it too, and Ctrl+=, Ctrl+-, and Ctrl+0 keep changing the interface text size.
import { registerPageCommand } from '../keys';
import { canZoomPage, resetPageZoom, stepPageZoom } from '../zoom';

const ZOOM = [
  { id: 'page.zoomIn', title: 'page.zoom.in', run: () => stepPageZoom(1) },
  { id: 'page.zoomOut', title: 'page.zoom.out', run: () => stepPageZoom(-1) },
  { id: 'page.zoom100', title: 'page.zoom.reset', run: resetPageZoom },
] as const;

for (const { id, title, run } of ZOOM) {
  registerPageCommand({ id, title, keywords: 'page.zoom.keywords', category: 'view', enabled: canZoomPage, run });
}
