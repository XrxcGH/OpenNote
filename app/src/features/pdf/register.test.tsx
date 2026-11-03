import { afterEach, describe, expect, it, vi } from 'vitest';
import { navigate } from '../../app/location';
import { executeCommand } from '../../commands/registry';
import type { NodeId } from '../../services/notes';
import { renderApp } from '../../test';

const id = (value: string) => value as NodeId;

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('[data-testid="pdf-file-input"]').forEach((input) => input.remove());
});

describe('Import PDF', () => {
  it('opens the file chooser at once, while the click that ran it still counts', async () => {
    await renderApp();
    navigate({ view: 'workspace', notebookId: id('n-biology'), sectionId: id('s-lectures'), pageId: null });
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    void executeCommand('pdf.import', undefined, 'menu');
    // No await before this check: a chooser opened after one is refused by the webview.
    expect(click).toHaveBeenCalledTimes(1);
    const input = document.querySelector<HTMLInputElement>('[data-testid="pdf-file-input"]');
    input?.dispatchEvent(new Event('cancel'));
  });
});
