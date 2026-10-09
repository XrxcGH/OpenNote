import { describe, expect, it, vi } from 'vitest';
import { addShare, fromBase64, quickNoteBody, shareText, shareTransfer } from './receive';
import type { ShareBlocks, ShareDeps } from './receive';

/** A DataTransfer stand-in that records what a paste would carry. */
class FakeTransfer {
  data = new Map<string, string>();
  files: File[] = [];
  items = { add: (file: File) => this.files.push(file) };
  setData(type: string, value: string) {
    this.data.set(type, value);
  }
}

const make = () => new FakeTransfer() as unknown as DataTransfer;
const share = (over: Partial<ShareBlocks> = {}): ShareBlocks => ({
  title: 'Shared item',
  text: '',
  link: null,
  markdown: '',
  files: [],
  skipped: [],
  ...over,
});

describe('share content to a paste', () => {
  it('carries text as plain text', () => {
    const data = shareTransfer(share({ text: 'Eggs\nMilk' }), false, make) as unknown as FakeTransfer;
    expect(data.data.get('text/plain')).toBe('Eggs\nMilk');
    expect(data.data.has('text/uri-list')).toBe(false);
  });

  it('carries a web link as a link and as text, once', () => {
    const link = 'https://example.org/a';
    const data = shareTransfer(share({ link, text: link }), false, make) as unknown as FakeTransfer;
    expect(data.data.get('text/uri-list')).toBe(link);
    expect(data.data.get('text/plain')).toBe(link);
    expect(shareText(share({ link, text: 'Read this' }))).toBe(`${link}\n\nRead this`);
  });

  it('keeps a mail link as text only', () => {
    const data = shareTransfer(share({ link: 'mailto:a@example.org' }), false, make) as unknown as FakeTransfer;
    expect(data.data.has('text/uri-list')).toBe(false);
    expect(data.data.get('text/plain')).toBe('mailto:a@example.org');
  });

  it('turns pictures and files into files with their names and types', async () => {
    const data = shareTransfer(
      share({
        files: [
          { name: 'Shared picture.png', mime: 'image/png', data: 'cG5n' },
          { name: 'notes.pdf', mime: 'application/pdf', data: 'JVBERg==' },
        ],
      }),
      false,
      make,
    ) as unknown as FakeTransfer;
    expect(data.files.map((file) => [file.name, file.type])).toEqual([
      ['Shared picture.png', 'image/png'],
      ['notes.pdf', 'application/pdf'],
    ]);
    expect(await data.files[0].text()).toBe('png');
    expect(data.data.size).toBe(0);
  });

  it('decodes base64 to bytes', () => {
    expect([...fromBase64('AAEC/w==')]).toEqual([0, 1, 2, 255]);
  });

  it('leaves the title out of a quick note body', () => {
    expect(quickNoteBody(share({ title: 'Eggs', markdown: 'Eggs\nMilk' }))).toBe('Milk');
    expect(quickNoteBody(share({ title: 'example.org/a', markdown: '<https://example.org/a>' }))).toBe(
      '<https://example.org/a>',
    );
  });
});

describe('where a share goes', () => {
  const deps = (over: Partial<ShareDeps> = {}): ShareDeps => ({
    pasteTarget: () => null,
    quickNote: vi.fn(async () => 'page-1'),
    openForPaste: vi.fn(async () => null),
    transfer: make,
    ...over,
  });

  it('pastes into the open page', async () => {
    const target = new EventTarget();
    const pasted = vi.fn();
    target.addEventListener('paste', pasted);
    const used = deps({ pasteTarget: () => target });
    expect(await addShare(share({ text: 'Hello' }), used)).toBe('page');
    expect(pasted).toHaveBeenCalledOnce();
    expect(used.quickNote).not.toHaveBeenCalled();
  });

  it('makes a quick note when no page is open, then adds the files to it', async () => {
    const target = new EventTarget();
    const pasted = vi.fn();
    target.addEventListener('paste', pasted);
    const used = deps({ openForPaste: vi.fn(async () => target) });
    const result = await addShare(
      share({ title: 'Trip', text: 'Trip\nBoots', markdown: 'Trip\nBoots', files: [{ name: 'a.png', mime: 'image/png', data: 'AA==' }] }),
      used,
    );
    expect(result).toBe('quickNote');
    expect(used.quickNote).toHaveBeenCalledWith('Trip', 'Boots');
    expect(used.openForPaste).toHaveBeenCalledWith('page-1');
    expect(pasted).toHaveBeenCalledOnce();
  });

  it('says so when there is nowhere to put it', async () => {
    expect(await addShare(share({ text: 'x' }), deps({ quickNote: vi.fn(async () => null) }))).toBe('none');
  });
});
