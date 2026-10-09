// @vitest-environment node
// Opening a Markdown or text file as a page: the page is made once and linked, typing saves back, an outside edit
// comes in, and an edit on both sides keeps the page's text and offers the file's.
import { describe, expect, it } from 'vitest';
import type { InteropClient } from '../../platform/interop';
import type { PagesClient } from '../../platform/types';
import { createMemoryNotesService } from '../../services/notes/memory';
import type { NodeId } from '../../services/notes/types';
import type { EditBatch } from '../../services/pages/types';
import { OpenFiles, fileTitle, pageText } from './openFiles';

interface Disk {
  text: string;
  modified: number;
}

function world() {
  const disk = new Map<string, Disk>([['C:\\Notes\\Plan.md', { text: '# Plan\n\nBuy pens.', modified: 10 }]]);
  const links: Record<string, string> = {};
  const writes: string[] = [];
  const more = <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    const path = args.path as string;
    const file = disk.get(path);
    const answer = (() => {
      switch (op) {
        case 'open_picked':
          return { path };
        case 'open_read':
          if (!file) throw { code: 'invalid' };
          return { path, text: file.text, modified: file.modified, markdown: true };
        case 'open_stat':
          return { exists: Boolean(file), modified: file?.modified ?? null };
        case 'open_write':
          if (!file) throw { code: 'invalid' };
          if (args.expected !== file.modified) throw { code: 'changed', message: '' };
          file.text = args.text as string;
          file.modified += 1;
          writes.push(file.text);
          return { modified: file.modified };
        case 'open_list':
          return { pages: { ...links } };
        case 'open_link':
          if (args.path) links[args.page as string] = args.path as string;
          else delete links[args.page as string];
          return null;
        default:
          throw new Error(op);
      }
    })();
    return Promise.resolve(answer as T);
  };
  const pageTexts = new Map<string, string>();
  const pages = {
    open(id: string) {
      return Promise.resolve({
        initial: { blocks: [{ id: 'b1', type: 'text', order: 'a', data: { markdown: pageTexts.get(id) ?? '' } }] },
        send(batch: EditBatch) {
          for (const edit of batch.edits) {
            if (edit.edit === 'insertBlock') pageTexts.set(id, edit.block.data.markdown as string);
          }
          return Promise.resolve({ seq: 1, orderKeys: {}, canUndo: true, canRedo: false });
        },
        close: () => Promise.resolve(),
      });
    },
  } as unknown as PagesClient;
  const notes = createMemoryNotesService({ seed: 'empty' });
  const opened: string[] = [];
  const files = new OpenFiles({
    platform: { pages, interop: { more } as unknown as InteropClient },
    notes,
    openPage: (_notes, page) => {
      opened.push(page);
      return Promise.resolve(true);
    },
    shownText: (page) => Promise.resolve(pageTexts.get(page) ?? null),
  });
  return { disk, links, writes, pageTexts, notes, opened, files };
}

describe('opening a file as a page', () => {
  it('makes a linked page in Opened files once, and shows it again the next time', async () => {
    const { files, notes, links, opened, pageTexts } = world();
    expect(await files.open('C:\\Notes\\Plan.md')).toBe(true);
    const [notebook] = await notes.listNotebooks();
    expect(notebook.title).toBe('Opened files');
    const page = opened[0];
    expect(links[page]).toBe('C:\\Notes\\Plan.md');
    expect(pageTexts.get(page)).toBe('# Plan\n\nBuy pens.');
    expect((await notes.get(page as NodeId))?.title).toBe('Plan');
    await files.open('C:\\Notes\\Plan.md');
    expect(opened).toEqual([page, page]);
    expect((await notes.listNotebooks()).length).toBe(1);
  });

  it('saves typing back, and never rewrites the file just for opening it', async () => {
    const { files, opened, pageTexts, disk, writes } = world();
    await files.open('C:\\Notes\\Plan.md');
    const page = opened[0];
    await files.tick(page);
    expect(writes).toEqual([]);
    pageTexts.set(page, '# Plan\n\nBuy pens and ink.');
    await files.tick(page);
    expect(disk.get('C:\\Notes\\Plan.md')?.text).toBe('# Plan\n\nBuy pens and ink.');
  });

  it('brings in an edit made in another app', async () => {
    const { files, opened, pageTexts, disk } = world();
    await files.open('C:\\Notes\\Plan.md');
    const page = opened[0];
    await files.tick(page);
    disk.set('C:\\Notes\\Plan.md', { text: '# Plan\n\nFrom Notepad.', modified: 99 });
    await files.tick(page);
    expect(pageTexts.get(page)).toBe('# Plan\n\nFrom Notepad.');
  });

  it('keeps the page when both sides changed, then saves it over the file', async () => {
    const { files, opened, pageTexts, disk } = world();
    await files.open('C:\\Notes\\Plan.md');
    const page = opened[0];
    await files.tick(page);
    disk.set('C:\\Notes\\Plan.md', { text: 'Outside', modified: 50 });
    pageTexts.set(page, 'Inside');
    await files.tick(page);
    expect(disk.get('C:\\Notes\\Plan.md')?.text).toBe('Outside');
    expect(pageTexts.get(page)).toBe('Inside');
    pageTexts.set(page, 'Inside, more');
    await files.tick(page);
    expect(disk.get('C:\\Notes\\Plan.md')?.text).toBe('Inside, more');
  });

  it('reads the page text in block order and titles pages by file name', () => {
    const blocks = [
      { id: 'b', type: 'text', order: 'b', data: { markdown: 'two' } },
      { id: 'i', type: 'image', order: 'a0', data: {} },
      { id: 'a', type: 'text', order: 'a', data: { markdown: 'one' } },
    ];
    expect(pageText({ blocks } as never)).toBe('one\n\ntwo');
    expect(fileTitle('C:\\Notes\\todo.txt')).toBe('todo');
  });
});
