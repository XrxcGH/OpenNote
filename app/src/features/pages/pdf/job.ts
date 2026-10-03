// The PDF export job. A page goes to a print surface (a hidden window, ADR 0006), which measures it, plans the sheets
// with the paginator, and shows the print document. The surface prints that to PDF, and the job checks the file against
// the plan before it hands the bytes back. It runs in the background: every step is a promise, and an abort signal
// stops it between steps.

import type { PrepareInput, PrepareResult } from '../print/prepare';
import type { PrintPlan } from '../print/sheets';
import { inspectPdf, type PdfInfo } from './inspect';

export interface PdfRenderOptions {
  /** Writes structure tags, a language, and alt text, where the renderer allows. */
  readonly tagged: boolean;
  /** Writes bookmarks from the headings. */
  readonly outline: boolean;
  /** Prints the paper pattern and tints. */
  readonly background: boolean;
}

/** The window that renders the print document. The host implements it with a hidden WebView2 (ADR 0006). */
export interface PrintSurface {
  /** Runs `preparePrint` in the surface's own document, and shows the print document there. */
  prepare(input: PrepareInput): Promise<PrepareResult>;
  /** Prints the shown document to PDF bytes. */
  toPdf(options: PdfRenderOptions): Promise<Uint8Array>;
  /** Closes the window. */
  dispose(): Promise<void>;
}

export type PdfStage = 'prepare' | 'render' | 'verify';

export interface PdfProgress {
  readonly stage: PdfStage;
  /** Where the job is, from 0 to 1. The stages weigh in as measured: preparing 30%, rendering 60%, checking 10%. */
  readonly fraction: number;
}

export interface PdfExportRequest {
  readonly input: PrepareInput;
  readonly tagged?: boolean;
  readonly outline?: boolean;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: PdfProgress) => void;
}

export type ProblemKind =
  'pageCount' | 'pageSize' | 'untagged' | 'noLanguage' | 'noText' | 'variableFonts' | 'blankPage';

export interface PdfProblem {
  readonly kind: ProblemKind;
  /** An error means the file does not match the plan, and a warning means it is usable but short of what was asked. */
  readonly severity: 'error' | 'warning';
  readonly detail: string;
}

export interface PdfExportResult {
  readonly bytes: Uint8Array;
  readonly info: PdfInfo;
  readonly plan: PrintPlan;
  readonly prepared: PrepareResult;
  readonly problems: readonly PdfProblem[];
  /** Milliseconds: the surface preparing and measuring, the renderer printing, and the check. */
  readonly timings: { readonly prepare: number; readonly render: number; readonly verify: number };
}

const POINTS = 0.75;
/** How far a page may differ from the plan, in points. Chromium rounds page sizes to hundredths of a point. */
const SIZE_TOLERANCE = 0.5;

function aborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('The export was stopped.', 'AbortError');
}

/** Checks the file against the plan and the options. Problems that are errors mean the file is wrong. */
export function checkPdf(info: PdfInfo, plan: PrintPlan, options: PdfRenderOptions): PdfProblem[] {
  const problems: PdfProblem[] = [];
  if (info.pages.length !== plan.sheets.length) {
    problems.push({
      kind: 'pageCount',
      severity: 'error',
      detail: `The plan has ${plan.sheets.length} sheets and the file has ${info.pages.length} pages.`,
    });
  }
  const wide = plan.box.width * POINTS;
  const tall = plan.box.height * POINTS;
  info.pages.forEach((page, i) => {
    if (Math.abs(page.width - wide) > SIZE_TOLERANCE || Math.abs(page.height - tall) > SIZE_TOLERANCE) {
      problems.push({
        kind: 'pageSize',
        severity: 'error',
        detail: `Page ${i + 1} is ${page.width} by ${page.height} points, not ${wide.toFixed(2)} by ${tall.toFixed(2)}.`,
      });
    }
  });
  if (options.tagged && !info.tagged) {
    problems.push({ kind: 'untagged', severity: 'warning', detail: 'The renderer did not write structure tags.' });
  }
  if (options.tagged && info.lang === null) {
    problems.push({ kind: 'noLanguage', severity: 'warning', detail: 'The file does not name its language.' });
  }
  const type3 = info.fonts.filter((f) => f.type === 'Type3');
  if (type3.length > 0) {
    problems.push({
      kind: 'variableFonts',
      severity: 'warning',
      detail: `${type3.length} fonts are embedded as glyph outlines (Type 3), which variable fonts become (ADR 0006, rule 3).`,
    });
  }
  return problems;
}

/**
 * Exports a page to PDF through a print surface. The surface is closed when the job ends, even when it fails.
 * Throws an `AbortError` if the signal fires, and any error the surface throws.
 */
export async function exportPdf(surface: PrintSurface, request: PdfExportRequest): Promise<PdfExportResult> {
  const { signal, onProgress } = request;
  const options: PdfRenderOptions = {
    tagged: request.tagged ?? true,
    outline: request.outline ?? true,
    background: request.input.print?.background !== false,
  };
  const mark = (stage: PdfStage, fraction: number) => onProgress?.({ stage, fraction });
  let closed = false;
  try {
    aborted(signal);
    mark('prepare', 0);
    const t0 = performance.now();
    const prepared = await surface.prepare(request.input);
    aborted(signal);
    mark('render', 0.3);
    const t1 = performance.now();
    const bytes = await surface.toPdf(options);
    // Close the print window before reading the file: a window that is still open competes for the processor with
    // the reader, and the file is all that is needed from here on.
    closed = true;
    await surface.dispose();
    aborted(signal);
    mark('verify', 0.9);
    const t2 = performance.now();
    const info = await inspectPdf(bytes);
    const problems = checkPdf(info, prepared.plan, options);
    const t3 = performance.now();
    mark('verify', 1);
    return {
      bytes,
      info,
      plan: prepared.plan,
      prepared,
      problems,
      timings: { prepare: t1 - t0, render: t2 - t1, verify: t3 - t2 },
    };
  } finally {
    if (!closed) await surface.dispose();
  }
}
