// @vitest-environment jsdom
// The code commands on a page (PLAN.md section 10.5): Set code language and Leave code block, through
// expectCommand, as the palette and the keyboard run them.
import { afterEach, describe, expect, it } from 'vitest';
import { executeCommand } from '../../../commands/registry';
import { applyLanguage } from '../../../editor/extensions/codeBlock';
import { setLanguagePicker } from '../../../editor/highlight/picker';
import { expectCommand } from '../test/harness';
import '../register';
import './register';

// jsdom has no layout, and ProseMirror measures a Range when it scrolls the caret into view.
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect ??= () => new DOMRect();

/** A picker that chooses `language` at once, as a person would in the listbox. */
function choose(language: string | null): void {
  setLanguagePicker(({ view, pos }) => applyLanguage(view, pos, language, { announce: () => {} }));
}

afterEach(() => setLanguagePicker(null));

describe('code commands', () => {
  it('sets the code language', async () => {
    choose('python');
    await expectCommand('code.setLanguage', '```\nprint(1)[]\n```', '```python\nprint(1)\n```');
  });

  it('sets plain text', async () => {
    choose(null);
    await expectCommand('code.setLanguage', '```js\nlet a[]\n```', '```\nlet a\n```');
  });

  it('leaves the code block for a new paragraph, which Markdown keeps once it has text', async () => {
    await expectCommand('code.exit', '```js\nlet []a\n```\n\nafter', '```js\nlet a\n```\n\nafter');
  });

  it('does not run outside code', async () => {
    expect(await executeCommand('code.exit')).toBe(false);
    expect(await executeCommand('code.setLanguage')).toBe(false);
  });
});
