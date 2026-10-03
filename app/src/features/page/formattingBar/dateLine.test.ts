// The date line under a new page's title: an ordinary text block with the date and time in small text, added
// once to an empty page, and not at all when Settings turns it off.
import { afterEach, describe, expect, it } from 'vitest';
import { initFlags } from '../../../app/flags';
import type { NodeId } from '../../../services/notes/types';
import { createMemoryPageService } from '../../../services/pages/memory';
import { DEFAULT_SETTINGS, settingsStore } from '../../../state/settings';
import { installPages } from '../runtime';
import { textPageFixture } from '../test/fixtures';
import { addDateLine, dateLineMarkdown } from './dateLine';

const NOW = new Date('2026-09-30T14:05:00');
let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  settingsStore.set({ settings: DEFAULT_SETTINGS, readOnly: false });
});

function emptyPage() {
  const fixture = textPageFixture('');
  fixture.page.blocks = [];
  const service = createMemoryPageService([fixture]);
  uninstall = installPages({ pages: service });
  initFlags('dev', { 'page.editor': true });
  return { service, id: fixture.page.id };
}

describe('the date line', () => {
  it('is the date and time in small text', () => {
    expect(dateLineMarkdown(NOW)).toBe('<span data-size="small">Sep 30, 2026 2:05 PM</span>');
  });

  it('goes into a new, empty page as its first text block', async () => {
    const { service, id } = emptyPage();
    await addDateLine(id as unknown as NodeId, NOW);
    const edits = service.sent(id).flatMap((batch) => batch.edits);
    expect(edits).toMatchObject([
      { edit: 'insertBlock', block: { type: 'text', data: { markdown: dateLineMarkdown(NOW) } } },
    ]);
  });

  it('stays out when Settings turns it off', async () => {
    const { service, id } = emptyPage();
    const editing = { ...DEFAULT_SETTINGS.editing, newPageDateTime: false };
    settingsStore.set({ settings: { ...DEFAULT_SETTINGS, editing }, readOnly: false });
    await addDateLine(id as unknown as NodeId, NOW);
    expect(service.sent(id)).toEqual([]);
  });
});
