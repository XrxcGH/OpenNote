// @vitest-environment node
// Printing a bundle's pages: each page opens, prints, and goes to the host under the job's name; a page that fails is
// counted and the rest go on; stopping tells the host to drop what it has.
import { describe, expect, it, vi } from 'vitest';
import type { ExportsClient, PagesClient } from '../../../platform/types';
import { drawBundle } from './bundle';

vi.mock('../pdf', () => ({
  exportPdf: vi.fn(async (_surface: unknown, request: { input: { print: { fields: { title: string } } } }) => {
    if (request.input.print.fields.title === 'Broken') throw new Error('The print window failed.');
    return { bytes: new TextEncoder().encode(`%PDF-1.7 ${request.input.print.fields.title} %%EOF`) };
  }),
}));

function pages(): PagesClient & { opened: string[]; closed: number } {
  const opened: string[] = [];
  const service = {
    opened,
    closed: 0,
    open(id: string) {
      opened.push(id);
      return Promise.resolve({
        id,
        initial: { blocks: [], assets: {}, title: '' },
        assetUrl: (asset: string) => `http://opennote-asset.localhost/${id}/${asset}`,
        close: () => {
          service.closed += 1;
          return Promise.resolve();
        },
      });
    },
  };
  return service as unknown as PagesClient & { opened: string[]; closed: number };
}

const sections = [
  {
    title: 'Lectures',
    pages: [
      { ui: 'p1', title: 'Cells' },
      { ui: 'p2', title: 'Broken' },
    ],
  },
  { title: 'Labs', pages: [{ ui: 'p3', title: 'Enzymes' }] },
];

describe('printing a bundle', () => {
  it('stages each page it prints and counts the ones that fail', async () => {
    const calls: { op: string; args: Record<string, unknown> }[] = [];
    const more = <T>(op: string, args?: Record<string, unknown>) => {
      calls.push({ op, args: args ?? {} });
      return Promise.resolve(null as T);
    };
    const service = pages();
    const seen: string[] = [];
    const drawn = await drawBundle({
      pages: service,
      exports: {} as ExportsClient,
      interop: { more },
      job: 'j1',
      notebook: 'Biology',
      sections,
      onPage: (done, total, title) => seen.push(`${done}/${total} ${title}`),
    });
    expect(drawn).toEqual({ drawn: 2, failed: 1 });
    expect(seen).toEqual(['0/3 Cells', '1/3 Broken', '2/3 Enzymes']);
    expect(service.opened).toEqual(['p1', 'p2', 'p3']);
    expect(service.closed).toBe(3);
    const staged = calls.filter((call) => call.op === 'pdf_stage');
    expect(staged.map((call) => call.args.page)).toEqual(['p1', 'p3']);
    expect(atob(staged[0].args.data as string)).toContain('%PDF-1.7 Cells');
    expect(staged.every((call) => call.args.job === 'j1')).toBe(true);
  });

  it('uses the shown page as the window has it', async () => {
    const service = pages();
    const more = () => Promise.resolve(null as never);
    await drawBundle({
      pages: service,
      exports: {} as ExportsClient,
      interop: { more },
      job: 'j2',
      notebook: 'Biology',
      sections: [sections[1]],
      shown: (id) =>
        Promise.resolve(
          id === 'p3'
            ? {
                pageId: 'p3',
                title: 'Enzymes',
                notebook: 'Biology',
                section: 'Labs',
                page: { blocks: [], assets: {} } as never,
                assetUrls: {},
              }
            : null,
        ),
    });
    expect(service.opened).toEqual([]);
  });

  it('drops what it staged when stopped', async () => {
    const calls: string[] = [];
    const more = <T>(op: string) => {
      calls.push(op);
      return Promise.resolve(null as T);
    };
    const abort = new AbortController();
    const run = drawBundle({
      pages: pages(),
      exports: {} as ExportsClient,
      interop: { more },
      job: 'j3',
      notebook: 'Biology',
      sections,
      signal: abort.signal,
      onPage: (done) => {
        if (done === 1) abort.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toContain('pdf_unstage');
  });
});
