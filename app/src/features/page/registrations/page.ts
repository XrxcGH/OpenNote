// WP3's registrations: page zoom (ARCHITECTURE.md section 5.3, amendment P2-13). Ctrl+wheel over the page zooms it
// too, and Ctrl+=, Ctrl+-, and Ctrl+0 keep changing the interface text size.
import { registerPageCommand } from '../keys';
import { canFitPageWidth, canZoomPage, fitPageWidth, resetPageZoom, stepPageZoom } from '../zoom';

const ZOOM = [
  { id: 'page.zoomIn', title: 'page.zoom.in', run: () => stepPageZoom(1), enabled: canZoomPage },
  { id: 'page.zoomOut', title: 'page.zoom.out', run: () => stepPageZoom(-1), enabled: canZoomPage },
  { id: 'page.zoom100', title: 'page.zoom.reset', run: resetPageZoom, enabled: canZoomPage },
  { id: 'page.zoomFitWidth', title: 'page.zoom.fitWidth', run: fitPageWidth, enabled: canFitPageWidth },
] as const;

for (const { id, title, run, enabled } of ZOOM) {
  registerPageCommand({ id, title, keywords: 'page.zoom.keywords', category: 'view', enabled, run });
}
