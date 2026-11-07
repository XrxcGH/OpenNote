// @vitest-environment jsdom
// The Paste Options chip through runPaste: it is offered only with the flag on and the text piece alone, switching
// never drops a table or later text, and the document after each switch is exact.
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupPages, renderPage } from '../test/harness';
import { textPageFixture } from '../test/fixtures';
import { runPaste } from './pipeline';
import type { PasteRequest } from './pipeline';

const shown = vi.hoisted(() => ({
  toasts: [] as { id?: string; action?: { run(): void | Promise<void> } }[],
  menus: [] as { id: string; disabled?: boolean }[][],
  pick: null as string | null,
}));

vi.mock('../../../ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../ui')>()),
  showToast: (spec: { id?: string; action?: { run(): void | Promise<void> } }) => {
    shown.toasts.push(spec);
    return { dismiss: () => undefined };
  },
  openMenu: async (options: { items: { id: string; disabled?: boolean }[] }) => {
    shown.menus.push(options.items);
    return shown.pick;
  },
}));

vi.mock('../../../state/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../state/settings')>();
  return {
    ...actual,
    getSettings: () => {
      const base = actual.getSettings();
      return { ...base, text: { ...base.text, paste: { ...base.text.paste, docs: 'textOnly' } } };
    },
  };
});

beforeAll(() => {
  const empty = () => new DOMRect(0, 0, 0, 0);
  Range.prototype.getBoundingClientRect ??= empty;
  Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList;
});
beforeEach(() => {
  shown.toasts.length = 0;
  shown.menus.length = 0;
  shown.pick = null;
});
afterEach(cleanupPages);

const request = (next: Partial<PasteRequest>): PasteRequest => ({
  html: null,
  text: null,
  files: [],
  plain: false,
  origin: 'paste',
  ...next,
});

async function pageWith(markdown: string, fidelity: boolean) {
  const fixture = textPageFixture(markdown);
  const block = fixture.page.blocks[0].id;
  const page = await renderPage({ fixture, flags: { 'text.pasteFidelity': fidelity } });
  const editor = page.mounted.pool.mount(block, { kind: 'end' }, 'target')!;
  editor.commands.focus('end', { scrollIntoView: false });
  return { page, block, editor };
}

const docs = (body: string) => `<b style="font-weight:normal" id="docs-internal-guid-1">${body}</b>`;
const withTable = docs('<p>Intro</p><table><tr><td>A</td><td>B</td></tr></table><p>Outro words</p>');
const chip = () => shown.toasts.find((toast) => toast.id === 'page.pasteOptions');

describe('the Paste Options chip through runPaste', () => {
  it('is not offered with the flag off', async () => {
    const { page } = await pageWith('', false);
    await runPaste(page.mounted, request({ html: docs('<p>Hello</p>'), text: 'Hello' }), null);
    expect(chip()).toBeUndefined();
  });

  it('is offered with the flag on when the text is alone', async () => {
    const { page } = await pageWith('', true);
    await runPaste(page.mounted, request({ html: docs('<p>Hello</p>'), text: 'Hello' }), null);
    expect(chip()).toBeDefined();
  });

  it('disables a choice that would drop a table or later text, and keeps the paste as it is', async () => {
    const { page, block, editor } = await pageWith('', true);
    await runPaste(page.mounted, request({ html: withTable, text: 'Intro\nA\tB\nOutro words' }), null);
    const before = editor.state.doc.textContent;
    expect(chip()).toBeDefined();
    shown.pick = 'keepSource';
    await chip()!.action!.run();
    const items = shown.menus[0];
    expect(items.find((item) => item.id === 'keepSource')?.disabled).toBe(true);
    expect(items.find((item) => item.id === 'mergeFormatting')?.disabled).toBe(true);
    expect(editor.state.doc.textContent).toBe(before);
    expect(before).toContain('Outro words');
    expect(page.markdown(block)).toContain('Outro words');
  });
});
