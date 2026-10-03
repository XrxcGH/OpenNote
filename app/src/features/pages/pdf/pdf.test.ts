import { deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { exportFileName, fileStem } from './filename';
import { inspectPdf } from './inspect';
import { checkPdf, exportPdf, type PrintSurface } from './job';
import { PdfName, PdfRef, PdfString, readObjects } from './objects';
import type { PrepareResult } from '../print/prepare';
import type { PrintPlan } from '../print/sheets';

interface Obj {
  readonly num: number;
  readonly body: string;
  readonly stream?: string | Uint8Array;
}

const latin1 = (text: string): Uint8Array => Uint8Array.from(text, (c) => c.charCodeAt(0));

/** A small PDF made by hand. The reader finds objects by scanning, so the cross-reference table is left out. */
function buildPdf(objects: readonly Obj[]): Uint8Array {
  const parts: Uint8Array[] = [latin1('%PDF-1.4\n')];
  for (const o of objects) {
    if (o.stream === undefined) parts.push(latin1(`${o.num} 0 obj\n${o.body}\nendobj\n`));
    else {
      const data = typeof o.stream === 'string' ? latin1(o.stream) : o.stream;
      const body = o.body.replace(/>>$/, ` /Length ${data.length}>>`);
      parts.push(latin1(`${o.num} 0 obj\n${body}\nstream\n`), data, latin1('\nendstream\nendobj\n'));
    }
  }
  parts.push(latin1('trailer\n<< /Root 1 0 R /Info 20 0 R >>\n%%EOF\n'));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const TO_UNICODE = `/CIDInit /ProcSet findresource begin 12 dict begin begincmap
1 begincodespacerange <0000> <FFFF> endcodespacerange
2 beginbfchar <0001> <0048> <0002> <0069> endbfchar
1 beginbfrange <0010> <0012> <0061> endbfrange
endcmap`;

const PAGE_ONE =
  'BT /F1 12 Tf 1 0 0 1 72 700 Tm <00010002> Tj ET\nBT /F1 12 Tf 1 0 0 1 72 680 Tm [<0010> -300 <0011> <0012>] TJ ET\n';
const PAGE_TWO = 'q 1 0 0 rg 0 0 10 10 re f Q BT /F1 12 Tf 1 0 0 1 72 700 Tm <0002> Tj ET /Im1 Do';

const SAMPLE: Obj[] = [
  {
    num: 1,
    body: '<< /Type /Catalog /Pages 2 0 R /Lang (en-US) /MarkInfo << /Marked true >> /StructTreeRoot 6 0 R /Outlines 7 0 R >>',
  },
  {
    num: 2,
    body:
      '<< /Type /Pages /Kids [3 0 R 8 0 R] /Count 2 /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 4 0 R >> /XObject << /Im1 12 0 R >> >> >>',
  },
  { num: 3, body: '<< /Type /Page /Parent 2 0 R /Contents 5 0 R >>' },
  { num: 4, body: '<< /Type /Font /Subtype /Type0 /BaseFont /Test /ToUnicode 9 0 R /DescendantFonts [10 0 R] >>' },
  { num: 5, body: '<< >>', stream: PAGE_ONE },
  { num: 6, body: '<< /Type /StructTreeRoot /K [13 0 R 14 0 R] >>' },
  { num: 7, body: '<< /Type /Outlines /First 15 0 R /Last 15 0 R /Count 1 >>' },
  { num: 8, body: '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.5 842] /Contents [11 0 R] >>' },
  { num: 9, body: '<< >>', stream: TO_UNICODE },
  { num: 10, body: '<< /Type /Font /Subtype /CIDFontType2 /FontDescriptor 16 0 R >>' },
  { num: 11, body: '<< /Filter /FlateDecode >>', stream: deflateSync(Buffer.from(PAGE_TWO)) },
  { num: 12, body: '<< /Type /XObject /Subtype /Image /Width 1 /Height 1 >>', stream: 'x' },
  { num: 13, body: '<< /Type /StructElem /S /H1 /K 0 >>' },
  { num: 14, body: '<< /Type /StructElem /S /Figure /Alt (A leaf) /K 1 >>' },
  { num: 15, body: '<< /Title (Chapter one) /Parent 7 0 R >>' },
  { num: 16, body: '<< /Type /FontDescriptor /FontFile2 17 0 R >>' },
  { num: 17, body: '<< >>', stream: 'font' },
  { num: 20, body: '<< /Title <FEFF00480069> /Producer (test) >>' },
];

describe('reading a PDF', () => {
  it('reads the objects of a file, with their streams', () => {
    const objects = readObjects(buildPdf(SAMPLE));
    expect(objects.size).toBe(SAMPLE.length);
    const page = objects.get(3)!.value as { Contents: PdfRef; Parent: PdfRef; Type: PdfName };
    expect(page.Contents).toBeInstanceOf(PdfRef);
    expect(page.Type.name).toBe('Page');
    expect(objects.get(5)!.stream).toHaveLength(PAGE_ONE.length);
    expect((objects.get(20)!.value as { Title: PdfString }).Title.text).toBe('Hi');
  });

  it('finds the pages in order, with the size they inherit or set', async () => {
    const info = await inspectPdf(buildPdf(SAMPLE));
    expect(info.pages.map((p) => [p.width, p.height])).toEqual([
      [612, 792],
      [595.5, 842],
    ]);
  });

  it('reads the text through the font map, with a new line where the text moves down', async () => {
    const info = await inspectPdf(buildPdf(SAMPLE));
    expect(info.pages[0].text).toBe('Hi\nabc');
    expect(info.pages[1].text).toBe('i');
  });

  it('counts images and vector fills, including inside compressed streams', async () => {
    const info = await inspectPdf(buildPdf(SAMPLE));
    expect(info.pages[0]).toMatchObject({ images: 0, fills: 0 });
    expect(info.pages[1]).toMatchObject({ images: 1, fills: 1, strokes: 0 });
  });

  it('reads the tags, the language, the title, the outline, and the fonts', async () => {
    const info = await inspectPdf(buildPdf(SAMPLE));
    expect(info.tagged).toBe(true);
    expect(info.lang).toBe('en-US');
    expect(info.title).toBe('Hi');
    expect(info.structure).toEqual({ H1: 1, Figure: 1 });
    expect(info.figuresWithAlt).toBe(1);
    expect(info.outline).toEqual(['Chapter one']);
    expect(info.fonts).toEqual([{ name: 'Test', type: 'Type0', embedded: true }]);
  });

  it('says a file without tags is not tagged, and refuses a file without pages', async () => {
    const plain = SAMPLE.filter((o) => o.num !== 6).map((o) =>
      o.num === 1 ? { ...o, body: '<< /Type /Catalog /Pages 2 0 R >>' } : o,
    );
    const info = await inspectPdf(buildPdf(plain));
    expect(info).toMatchObject({ tagged: false, lang: null, outline: [] });
    await expect(inspectPdf(latin1('not a pdf'))).rejects.toThrow('no page tree');
  });

  it('reads strings with escapes, names with codes, and nested values', () => {
    const objects = readObjects(
      latin1(
        '1 0 obj\n<< /A#20B (a\\(b\\)\\n\\101\\\nc (nested)) /C [1 -2.5 true null /N <4142>] /D << /E 3 0 R >> >>\nendobj\n',
      ),
    );
    const value = objects.get(1)!.value as Record<string, unknown>;
    expect(Object.keys(value)).toEqual(['A B', 'C', 'D']);
    expect((value['A B'] as PdfString).text).toBe('a(b)\nAc (nested)');
    const list = value.C as unknown[];
    expect(list.slice(0, 4)).toEqual([1, -2.5, true, null]);
    expect((list[4] as PdfName).name).toBe('N');
    expect((list[5] as PdfString).text).toBe('AB');
    expect(((value.D as Record<string, unknown>).E as PdfRef).num).toBe(3);
  });
});

describe('file names', () => {
  it('replaces what a file name cannot hold and keeps the rest', () => {
    expect(fileStem('Cell biology: part 1/2')).toBe('Cell biology part 1 2');
    expect(fileStem('  a<b>c|d?e*f"g\\h  ')).toBe('a b c d e f g h');
    expect(fileStem('Notes...')).toBe('Notes');
    expect(fileStem('.hidden')).toBe('hidden');
    expect(fileStem('Résumé 日本語')).toBe('Résumé 日本語');
  });

  it('avoids the names Windows reserves, and empty names', () => {
    expect(fileStem('CON')).toBe('CON_');
    expect(fileStem('nul.txt')).toBe('nul.txt_');
    expect(fileStem('COM1')).toBe('COM1_');
    expect(fileStem('', 'Page')).toBe('Page');
    expect(fileStem('???')).toBe('Untitled');
    expect(exportFileName('Plan: A', 'pdf')).toBe('Plan A.pdf');
  });

  it('cuts long names at a character, not in the middle of one', () => {
    const stem = fileStem('é'.repeat(300) + '😀');
    expect(Array.from(stem)).toHaveLength(120);
    expect(fileStem('x'.repeat(119) + ' y')).toHaveLength(119);
  });
});

const PLAN = (sheets: number): PrintPlan => ({
  paper: { width: 816, height: 1056 },
  box: { width: 816, height: 1056 },
  total: sheets,
  sheets: Array.from({ length: sheets }, (_, index) => ({ index, number: index + 1, header: null, footer: null })),
  header: null,
  footer: null,
  background: true,
  ink: true,
  warnings: [],
});

function fakeSurface(bytes: Uint8Array, sheets = 2): { surface: PrintSurface; log: string[] } {
  const log: string[] = [];
  const surface: PrintSurface = {
    async prepare() {
      log.push('prepare');
      return {
        html: '',
        sheets,
        printed: sheets,
        plan: PLAN(sheets),
        breaks: [],
        warnings: [],
        timings: { measure: 0, plan: 0, build: 0 },
      } satisfies PrepareResult;
    },
    async toPdf(options) {
      log.push(`toPdf ${JSON.stringify(options)}`);
      return bytes;
    },
    async dispose() {
      log.push('dispose');
    },
  };
  return { surface, log };
}

const INPUT = { page: { id: 'P' } as never, assetUrls: {} };

describe('the export job', () => {
  it('prepares, renders, checks, reports progress, and closes the surface', async () => {
    const { surface, log } = fakeSurface(buildPdf(SAMPLE));
    const stages: string[] = [];
    const result = await exportPdf(surface, {
      input: INPUT,
      onProgress: (p) => stages.push(`${p.stage}:${p.fraction}`),
    });
    expect(log).toEqual(['prepare', 'toPdf {"tagged":true,"outline":true,"background":true}', 'dispose']);
    expect(stages).toEqual(['prepare:0', 'render:0.3', 'verify:0.9', 'verify:1']);
    expect(result.info.pages).toHaveLength(2);
    expect(result.problems.map((p) => p.kind)).toEqual(['pageSize']);
    expect(result.timings.prepare).toBeGreaterThanOrEqual(0);
  });

  it('stops between steps when the signal fires, and still closes the surface', async () => {
    const { surface, log } = fakeSurface(buildPdf(SAMPLE));
    const controller = new AbortController();
    const run = exportPdf(surface, {
      input: INPUT,
      signal: controller.signal,
      onProgress: (p) => p.stage === 'render' && controller.abort(),
    });
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(log[0]).toBe('prepare');
    expect(log.at(-1)).toBe('dispose');
    expect(log.some((l) => l.startsWith('toPdf'))).toBe(true);
    const early = new AbortController();
    early.abort();
    const second = fakeSurface(buildPdf(SAMPLE));
    await expect(exportPdf(second.surface, { input: INPUT, signal: early.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(second.log).toEqual(['dispose']);
  });

  it('closes the surface when rendering fails', async () => {
    const { surface, log } = fakeSurface(new Uint8Array());
    surface.toPdf = async () => {
      throw new Error('boom');
    };
    await expect(exportPdf(surface, { input: INPUT })).rejects.toThrow('boom');
    expect(log.at(-1)).toBe('dispose');
  });

  it('finds a file that does not match the plan', async () => {
    const info = await inspectPdf(buildPdf(SAMPLE));
    const opts = { tagged: true, outline: true, background: true };
    const wrong = checkPdf(info, PLAN(5), opts);
    expect(wrong.filter((p) => p.severity === 'error').map((p) => p.kind)).toEqual(['pageCount', 'pageSize']);
    const plain = { ...info, tagged: false, lang: null, fonts: [{ name: 'F', type: 'Type3', embedded: true }] };
    expect(checkPdf(plain, PLAN(2), opts).map((p) => p.kind)).toEqual([
      'pageSize',
      'untagged',
      'noLanguage',
      'variableFonts',
    ]);
    expect(checkPdf(plain, PLAN(2), { ...opts, tagged: false }).map((p) => p.kind)).toEqual([
      'pageSize',
      'variableFonts',
    ]);
  });
});
