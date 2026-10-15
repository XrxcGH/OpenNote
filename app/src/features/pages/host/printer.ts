// Printing to a printer (File > Print): the same PDF the export makes, sent to the system's spooler instead of to a
// file. The page range, odd or even sheets, headers and paper pattern are already in the PDF, so the printer's part is
// the copies, the sides of the paper, colour, and whether the sheets are shrunk to fit. Nothing here knows a printer.
import type { ExportsClient, PrinterInfo, PrintJobRequest, PrintReceipt } from '../../../platform/types';
import { t } from '../../../strings/t';
import { exportPdf } from '../pdf';
import type { PdfProgress } from '../pdf';
import type { PrintOptions } from '../print';
import { createPrintSurface, newJobId, PdfCheckError, prepareInput } from './exporter';
import type { PageSource } from './source';

/** The most copies one job may ask for, as the shell allows. */
export const MAX_COPIES = 999;

export type DuplexChoice = 'default' | 'off' | 'longEdge' | 'shortEdge';

/** What the printer part of the dialog holds. */
export interface PrinterForm {
  /** The printer's name, or empty for the system's default. */
  readonly printer: string;
  /** The copies as typed. */
  readonly copies: string;
  readonly collate: boolean;
  readonly duplex: DuplexChoice;
  readonly shrinkToFit: boolean;
  readonly grayscale: boolean;
}

export const DEFAULT_PRINTER_FORM: PrinterForm = {
  printer: '',
  copies: '1',
  collate: true,
  duplex: 'default',
  shrinkToFit: false,
  grayscale: false,
};

/** The copies a whole number from 1 to 999, or null when the text isn't one. */
export function parseCopies(text: string): number | null {
  if (!/^\s*\d{1,4}\s*$/.test(text)) return null;
  const copies = Number(text);
  return copies >= 1 && copies <= MAX_COPIES ? copies : null;
}

/** The printer the form names, or the default one, or the first. Null when there are none. */
export function chosenPrinter(printers: readonly PrinterInfo[], name: string): PrinterInfo | null {
  return (
    printers.find((printer) => printer.name === name) ??
    printers.find((printer) => printer.default) ??
    printers[0] ??
    null
  );
}

/** Whether the printer can print on both sides. A printer that doesn't say is given the benefit of the doubt. */
export const canDuplex = (printer: PrinterInfo | null): boolean => printer !== null && printer.twoSided !== false;

/** The request the shell takes, or null while the copies are not a number. Two sides are dropped for a printer without. */
export function toJobRequest(
  form: PrinterForm,
  printers: readonly PrinterInfo[],
  title: string,
): PrintJobRequest | null {
  const copies = parseCopies(form.copies);
  const printer = chosenPrinter(printers, form.printer);
  if (copies === null || printer === null) return null;
  return {
    printer: printer.name,
    copies,
    collate: copies > 1 ? form.collate : true,
    duplex: form.duplex === 'default' || !canDuplex(printer) ? null : form.duplex,
    fit: form.shrinkToFit ? 'shrinkToFit' : 'exact',
    grayscale: form.grayscale,
    title,
  };
}

export interface PrintOutcome {
  readonly receipt: PrintReceipt;
  readonly sheets: number;
}

export interface PrintJobOptions {
  readonly print: PrintOptions;
  readonly request: PrintJobRequest;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PdfProgress) => void;
}

/**
 * Makes the PDF of the page and hands it to the printer. Rejects like `exportPdfFile` does: an `AbortError` when
 * stopped, a `TimeoutError` when a step takes too long, a `PdfCheckError` when the file doesn't match the plan, and
 * the shell's error when the spooler turns the job down. A stop after the job is handed over cannot recall it.
 */
export async function printToPrinter(
  client: ExportsClient,
  source: PageSource,
  options: PrintJobOptions,
): Promise<PrintOutcome> {
  const result = await exportPdf(createPrintSurface(client, newJobId()), {
    input: prepareInput(source, options.print),
    // A printed page needs no reading structure, so the plain route is used.
    tagged: false,
    outline: false,
    signal: options.signal,
    onProgress: options.onProgress,
  });
  const errors = result.problems.filter((problem) => problem.severity === 'error');
  if (errors.length > 0) throw new PdfCheckError(errors);
  options.signal?.throwIfAborted();
  const receipt = await client.printSubmit(result.bytes, {
    ...options.request,
    title: options.request.title || t('pageViews.print.untitled'),
  });
  return { receipt, sheets: result.prepared.printed };
}
