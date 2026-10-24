// Printing to a printer: the request the dialog builds, and the job that makes the PDF and hands it over. The web
// platform's stand-in takes the job, so no test reaches a printer.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebExports } from '../../../platform/web/exports';
import type { PrinterInfo } from '../../../platform/types';
import { inspectPdf } from '../pdf';
import { pageOf, textBlock } from '../testing/build';
import {
  canDuplex,
  chosenPrinter,
  DEFAULT_PRINTER_FORM,
  parseCopies,
  PDF_PRINTER,
  printToPrinter,
  savesPdf,
  toJobRequest,
} from './printer';
import type { PageSource } from './source';

const OFFICE: PrinterInfo = { name: 'Office', default: true, twoSided: true };
const HALL: PrinterInfo = { name: 'Hall', default: false, twoSided: false };
const UNKNOWN: PrinterInfo = { name: 'Unknown', default: false, twoSided: null };
/** The form once the person has chosen the office printer. */
const FORM = { ...DEFAULT_PRINTER_FORM, printer: 'Office' };

const PARAGRAPH = 'The reading room was quiet. A lamp threw a warm circle over the page while the afternoon went on.';

function source(paragraphs: number): PageSource {
  const markdown = Array.from({ length: paragraphs }, (_, i) => `${i + 1}. ${PARAGRAPH}`).join('\n\n');
  const page = pageOf([textBlock('# Field notes\n\n' + markdown)], {
    title: 'Field notes',
    view: { layout: 'flow', mode: 'paginated' },
  });
  return { pageId: 'p1', title: 'Field notes', notebook: 'Work', section: 'Notes', page, assetUrls: {} };
}

afterEach(() => {
  document.querySelectorAll('iframe').forEach((frame) => frame.remove());
});

describe('parseCopies', () => {
  it('takes whole numbers from 1 to 999 and nothing else', () => {
    expect(parseCopies('1')).toBe(1);
    expect(parseCopies(' 12 ')).toBe(12);
    expect(parseCopies('999')).toBe(999);
    for (const bad of ['', '0', '1000', '-1', '1.5', 'two', '1e2', '12345']) expect(parseCopies(bad)).toBeNull();
  });
});

describe('toJobRequest', () => {
  it('has no request until a printer is chosen, even with a default printer listed', () => {
    expect(toJobRequest(DEFAULT_PRINTER_FORM, [HALL, OFFICE], 'Notes')).toBeNull();
    expect(toJobRequest({ ...DEFAULT_PRINTER_FORM, printer: 'Gone' }, [HALL, OFFICE], 'Notes')).toBeNull();
  });

  it('names the chosen printer and keeps the printer defaults', () => {
    const request = toJobRequest(FORM, [HALL, OFFICE], 'Notes');
    expect(request).toEqual({
      printer: 'Office',
      copies: 1,
      collate: true,
      duplex: null,
      fit: 'exact',
      grayscale: false,
      title: 'Notes',
    });
  });

  it('carries copies, both sides, shrink to fit, and black and white', () => {
    const form = { ...DEFAULT_PRINTER_FORM, printer: 'Office', copies: '3', collate: false };
    const request = toJobRequest(
      { ...form, duplex: 'shortEdge', shrinkToFit: true, grayscale: true },
      [OFFICE, HALL],
      'Notes',
    );
    expect(request).toMatchObject({
      copies: 3,
      collate: false,
      duplex: 'shortEdge',
      fit: 'shrinkToFit',
      grayscale: true,
    });
  });

  it('collates a single copy and drops both sides for a printer that cannot', () => {
    const form = { ...DEFAULT_PRINTER_FORM, printer: 'Hall', collate: false, duplex: 'longEdge' as const };
    const request = toJobRequest(form, [OFFICE, HALL], 'Notes');
    expect(request).toMatchObject({ printer: 'Hall', collate: true, duplex: null });
  });

  it('has no request for bad copies or no printers', () => {
    expect(toJobRequest({ ...FORM, copies: '0' }, [OFFICE], 'Notes')).toBeNull();
    expect(toJobRequest(FORM, [], 'Notes')).toBeNull();
  });
});

describe('chosenPrinter and canDuplex', () => {
  it('never falls back to the default or the first printer, and trusts a printer that does not say', () => {
    expect(chosenPrinter([HALL, OFFICE], 'Gone')).toBeNull();
    expect(chosenPrinter([OFFICE, HALL], '')).toBeNull();
    expect(chosenPrinter([HALL, OFFICE], 'Hall')?.name).toBe('Hall');
    expect(chosenPrinter([], '')).toBeNull();
    expect([canDuplex(OFFICE), canDuplex(HALL), canDuplex(UNKNOWN), canDuplex(null)]).toEqual([
      true,
      false,
      true,
      false,
    ]);
  });

  it('knows the printer that only makes a PDF file', () => {
    expect(savesPdf({ name: PDF_PRINTER, default: false, twoSided: false })).toBe(true);
    expect([savesPdf(OFFICE), savesPdf(null)]).toEqual([false, false]);
  });
});

describe('printToPrinter', () => {
  it('sends the PDF of the chosen sheets to the printer with the request', async () => {
    const client = createWebExports();
    const submit = vi.spyOn(client, 'printSubmit');
    const request = toJobRequest({ ...FORM, copies: '2' }, [OFFICE], 'Field notes');
    if (!request) throw new Error('The request was not made.');
    const outcome = await printToPrinter(client, source(40), { print: { range: '1' }, request });
    expect(outcome.sheets).toBe(1);
    expect(outcome.receipt.printer).toBe('Office');
    expect(submit).toHaveBeenCalledOnce();
    const [bytes, sent] = submit.mock.calls[0];
    expect(sent).toMatchObject({ printer: 'Office', copies: 2, title: 'Field notes' });
    expect((await inspectPdf(bytes)).pages).toHaveLength(1);
  });

  it('prints every sheet when no range is given', async () => {
    const client = createWebExports();
    const submit = vi.spyOn(client, 'printSubmit');
    const request = toJobRequest(FORM, [OFFICE], '');
    if (!request) throw new Error('The request was not made.');
    const outcome = await printToPrinter(client, source(40), { print: {}, request });
    expect(outcome.sheets).toBeGreaterThan(1);
    expect((await inspectPdf(submit.mock.calls[0][0])).pages).toHaveLength(outcome.sheets);
    expect(submit.mock.calls[0][1].title).toBe('Untitled page');
  });

  it('hands nothing over when stopped, and passes on the spooler refusing the job', async () => {
    const client = createWebExports();
    const submit = vi.spyOn(client, 'printSubmit');
    const request = toJobRequest(FORM, [OFFICE], 'Notes');
    if (!request) throw new Error('The request was not made.');
    const stop = new AbortController();
    stop.abort();
    await expect(printToPrinter(client, source(2), { print: {}, request, signal: stop.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(submit).not.toHaveBeenCalled();
    submit.mockRejectedValueOnce({ code: 'spool', message: 'The printer is offline.' });
    await expect(printToPrinter(client, source(2), { print: {}, request })).rejects.toMatchObject({ code: 'spool' });
  });

  it('is refused by the stand-in spooler when no printer is named, as the shell refuses it', async () => {
    const client = createWebExports();
    const made = toJobRequest(FORM, [OFFICE], 'Notes');
    if (!made) throw new Error('The request was not made.');
    const request = { ...made, printer: null };
    await expect(printToPrinter(client, source(2), { print: {}, request })).rejects.toMatchObject({
      code: 'noPrinter',
    });
  });

  it('ends the wait when stopped while the spooler still holds the job (a Save window left open)', async () => {
    const client = createWebExports();
    vi.spyOn(client, 'printSubmit').mockReturnValue(new Promise(() => undefined));
    const request = toJobRequest(FORM, [OFFICE], 'Notes');
    if (!request) throw new Error('The request was not made.');
    const stop = new AbortController();
    const run = printToPrinter(client, source(2), { print: {}, request, signal: stop.signal });
    await vi.waitFor(() => expect(client.printSubmit).toHaveBeenCalled());
    stop.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
  });
});
