// The export jobs through the web platform's stand-ins, in a real browser: the page is measured and planned with real
// layout, the stand-in PDF has the planned pages, and the files that would be saved are the ones the job writes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebExports, standInPdf } from '../../../platform/web/exports';
import type { ExportsClient } from '../../../platform/types';
import { inspectPdf } from '../pdf';
import { pageOf, textBlock } from '../testing/build';
import { exportHtmlFile, exportMarkdownFile, exportPdfFile, PdfCheckError } from './exporter';
import type { PageSource } from './source';

const PARAGRAPH =
  'The reading room was quiet. A lamp on the desk threw a warm circle over the page, and the pencil moved slowly ' +
  'from one line to the next while the afternoon went on outside the window.';

function source(paragraphs: number, title = 'Field notes'): PageSource {
  const markdown = Array.from({ length: paragraphs }, (_, i) => `${i + 1}. ${PARAGRAPH}`).join('\n\n');
  const page = pageOf([textBlock('# Field notes\n\n' + markdown)], {
    title,
    view: { layout: 'flow', mode: 'paginated' },
  });
  return { pageId: 'p1', title, notebook: 'Work', section: 'Notes', page, assetUrls: {} };
}

interface Recorded {
  readonly client: ExportsClient;
  readonly writes: { path: string; files: { path: string; bytes: Uint8Array }[] }[];
}

function recording(overrides: Partial<ExportsClient> = {}): Recorded {
  const writes: Recorded['writes'] = [];
  const base = createWebExports();
  const client: ExportsClient = {
    ...base,
    async write(path, files) {
      writes.push({ path, files: [...files] });
    },
    ...overrides,
  };
  return { client, writes };
}

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
});

describe('exportPdfFile', () => {
  it('saves a PDF with one page for every planned sheet', async () => {
    const { client, writes } = recording();
    const outcome = await exportPdfFile(client, source(40), { print: {} });
    expect(outcome.status).toBe('saved');
    if (outcome.status !== 'saved') return;
    expect(outcome.name).toBe('Field notes.pdf');
    expect(outcome.sheets).toBeGreaterThan(1);
    expect(writes).toHaveLength(1);
    const info = await inspectPdf(writes[0].files[0].bytes);
    expect(info.pages).toHaveLength(outcome.sheets);
    // Letter, 816 by 1056 page units, is 612 by 792 points.
    expect(info.pages[0].width).toBeCloseTo(612, 0);
    expect(info.pages[0].height).toBeCloseTo(792, 0);
  });

  it('prints only the sheets asked for', async () => {
    const { client, writes } = recording();
    const outcome = await exportPdfFile(client, source(40), { print: { range: '2' } });
    expect(outcome.status === 'saved' && outcome.sheets).toBe(1);
    expect((await inspectPdf(writes[0].files[0].bytes)).pages).toHaveLength(1);
  });

  it('closes the print window when it is done', async () => {
    const close = vi.fn(async () => undefined);
    const { client } = recording({ printClose: close });
    await exportPdfFile(client, source(3), { print: {} });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the Save dialog is canceled', async () => {
    const prepare = vi.fn();
    const { client, writes } = recording({ pickSave: async () => null, printPrepare: prepare });
    const outcome = await exportPdfFile(client, source(3), { print: {} });
    expect(outcome.status).toBe('canceled');
    expect(prepare).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('saves nothing when the file does not match the plan', async () => {
    const { client, writes } = recording({ printRender: async () => standInPdf(1, 612, 792) });
    await expect(exportPdfFile(client, source(40), { print: {} })).rejects.toBeInstanceOf(PdfCheckError);
    expect(writes).toHaveLength(0);
  });

  it('stops when asked to', async () => {
    const abort = new AbortController();
    const { client, writes } = recording({
      printRender: () => new Promise(() => undefined),
    });
    const running = exportPdfFile(client, source(3), { print: {}, signal: abort.signal });
    setTimeout(() => abort.abort(), 50);
    await expect(running).rejects.toMatchObject({ name: 'AbortError' });
    expect(writes).toHaveLength(0);
  });

  it('reports the progress of each step', async () => {
    const { client } = recording();
    const stages: string[] = [];
    await exportPdfFile(client, source(3), { print: {}, onProgress: (p) => stages.push(p.stage) });
    expect(stages[0]).toBe('prepare');
    expect(stages).toContain('render');
    expect(stages.at(-1)).toBe('verify');
  });
});

describe('exportMarkdownFile', () => {
  it('writes the page as Markdown with its title as front matter', async () => {
    const { client, writes } = recording();
    const outcome = await exportMarkdownFile(client, source(2));
    expect(outcome.status).toBe('saved');
    const text = new TextDecoder().decode(writes[0].files[0].bytes);
    expect(text).toContain('title: "Field notes"');
    expect(text).toContain('# Field notes');
    expect(writes[0].path).toMatch(/Field notes\.md$/);
  });
});

describe('exportHtmlFile', () => {
  it('writes one web page that reads in order', async () => {
    const { client, writes } = recording();
    await exportHtmlFile(client, source(2));
    const html = new TextDecoder().decode(writes[0].files[0].bytes);
    expect(html).toContain('<h1 class="page-title">Field notes</h1>');
    expect(html).toContain("default-src 'none'");
    expect(writes[0].files).toHaveLength(1);
  });
});
