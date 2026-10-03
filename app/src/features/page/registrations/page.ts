// WP3's registrations: page zoom (ARCHITECTURE.md section 5.3, amendment P2-13), the page's layout commands, and
// the object commands. Ctrl+wheel over the page zooms it too, and Ctrl+=, Ctrl+-, and Ctrl+0 keep changing the
// interface text size. Each command reaches the shown page through a light store, so start-up loads none of it.
import { registerPageCommand } from '../keys';
import { shownPage } from '../viewport/shown';
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

const shown = () => shownPage.get();

registerPageCommand({
  id: 'page.newTextBox',
  title: 'page.commands.newTextBox',
  keywords: 'page.commands.newTextBoxKeywords',
  category: 'insert',
  enabled: () => shown() !== null,
  run: () => shown()?.newTextBox(),
});

registerPageCommand({
  id: 'page.layout',
  title: 'page.commands.layout',
  keywords: 'page.commands.layoutKeywords',
  category: 'view',
  enabled: () => shown() !== null,
  run: () => {
    const page = shown();
    page?.setLayout(page.layout() === 'flow' ? 'freeform' : 'flow');
  },
});

registerPageCommand({
  id: 'page.readingView',
  title: 'page.commands.readingView',
  keywords: 'page.commands.readingViewKeywords',
  category: 'view',
  enabled: () => shown()?.readingAvailable() ?? false,
  run: () => {
    const page = shown();
    page?.setReading(!page.reading());
  },
});
