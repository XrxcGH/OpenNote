// WP3's registrations: page zoom (ARCHITECTURE.md section 5.3, amendment P2-13), the page's layout commands, and
// the object commands. Ctrl+wheel over the page zooms it too, and Ctrl+=, Ctrl+-, and Ctrl+0 keep changing the
// interface text size. Each command reaches the shown page through a light store, so start-up loads none of it.
import { registerPageCommand } from '../keys';
import type { MessageKey } from '../../../strings/t';
import { readingOrderOpen, shownPage } from '../viewport/shown';
import type { ObjectCommandId } from '../viewport/shown';
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

registerPageCommand({
  id: 'page.readingOrderPane',
  title: 'page.commands.readingOrderPane',
  keywords: 'page.commands.readingOrderPaneKeywords',
  category: 'view',
  flag: 'page.readingOrder',
  enabled: () => shown() !== null,
  run: () => readingOrderOpen.set((open) => !open),
});

const OBJECT_COMMANDS: readonly { id: ObjectCommandId; title: MessageKey; keywords: MessageKey }[] = [
  { id: 'bringToFront', title: 'page.object.bringToFront', keywords: 'page.object.arrangeKeywords' },
  { id: 'sendToBack', title: 'page.object.sendToBack', keywords: 'page.object.arrangeKeywords' },
  { id: 'bringForward', title: 'page.object.bringForward', keywords: 'page.object.arrangeKeywords' },
  { id: 'sendBackward', title: 'page.object.sendBackward', keywords: 'page.object.arrangeKeywords' },
  { id: 'edit', title: 'page.object.edit', keywords: 'page.object.editKeywords' },
  { id: 'delete', title: 'page.object.delete', keywords: 'page.object.deleteKeywords' },
  { id: 'lock', title: 'page.object.lock', keywords: 'page.object.lockKeywords' },
  { id: 'lockPosition', title: 'page.object.lockPosition', keywords: 'page.object.lockKeywords' },
  { id: 'unlock', title: 'page.object.unlock', keywords: 'page.object.lockKeywords' },
  { id: 'float', title: 'page.object.float', keywords: 'page.object.floatKeywords' },
  { id: 'putInFlow', title: 'page.object.putInFlow', keywords: 'page.object.floatKeywords' },
  { id: 'sizeAndPosition', title: 'page.object.sizeAndPosition', keywords: 'page.object.sizeKeywords' },
];

for (const { id, title, keywords } of OBJECT_COMMANDS) {
  registerPageCommand({
    id: `object.${id}`,
    title,
    keywords,
    category: 'object',
    enabled: () => shown()?.objectEnabled(id) ?? false,
    run: () => shown()?.objectCommand(id),
  });
}
