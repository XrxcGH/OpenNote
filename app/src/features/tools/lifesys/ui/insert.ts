// What Insert puts on the page for a result: an answer line, the worked steps, the equation as LaTeX, the results
// as a table, or the plot as a picture (drawn from the SVG at twice its size as a PNG, as the grapher does).
import { announce, showToast } from '../../../../ui';
import { KIT_CALC_TYPE, kitCalcData, kitCalcFallback } from '../../kits/block/model';
import { insertIntoPage } from '../../ui/CalculatorTool';
import type { LifeSysInputs } from '../open';
import type { CalcResult, CalcSpec, PlotData, ResultRow } from '../types';
import { plotModel, plotSvg } from './plotModel';
import { plotLabels } from './Plot';
import { formatNumber } from './text';
import { word } from './words';

export const rowValue = (row: ResultRow): string =>
  row.word
    ? word(row.word, row.wordVars)
    : typeof row.value === 'number'
      ? formatNumber(row.value, row.digits ?? 6)
      : row.value;

export const rowText = (row: ResultRow): string =>
  `${word(row.label, row.vars)}: ${rowValue(row)}${row.unit ? ` ${row.unit}` : ''}`;

export function answerText(result: CalcResult): string {
  return result.rows.map(rowText).join('; ');
}

export function stepsText(result: CalcResult): string {
  const lines = result.steps.map((step, i) => `${i + 1}. ${word(step.key, step.vars)}`);
  const notes = (result.notes ?? []).map((note) => `- ${word(note.key, note.vars)}`);
  const source = result.source ? [word('ui.sourceLine', { source: word(result.source) })] : [];
  return [answerText(result), ...lines, ...notes, ...source].join('\n');
}

export function stepsLatex(result: CalcResult): string | null {
  const math = [result.latex, ...result.steps.map((step) => step.math)].filter((m): m is string => !!m);
  if (math.length === 0) return null;
  return math.length === 1 ? math[0] : `\\begin{aligned}${math.map((m) => `&${m}`).join('\\\\')}\\end{aligned}`;
}

export function resultTable(result: CalcResult): { header: string[]; rows: string[][] } {
  if (result.table) {
    return {
      header: result.table.header.map((h) => word(h.key, h.vars)),
      rows: result.table.rows.map((row) =>
        row.map((cell) =>
          typeof cell === 'number' ? formatNumber(cell) : typeof cell === 'string' ? cell : word(cell.key, cell.vars),
        ),
      ),
    };
  }
  return {
    header: [word('ui.quantity'), word('ui.value'), word('ui.unit')],
    rows: result.rows.map((row) => [word(row.label, row.vars), rowValue(row), row.unit ?? '']),
  };
}

/** The plot as PNG bytes for an image block, or null when the browser cannot draw it. */
export async function plotPicture(
  plot: PlotData,
): Promise<{ bytes: ArrayBuffer; name: string; alt: string; mime: string } | null> {
  const labels = plotLabels(plot);
  const svg = plotSvg(plotModel(plot), labels);
  const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 720);
  const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 440);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) return null;
    return { bytes: await blob.arrayBuffer(), name: 'Plot.png', alt: labels.title, mime: 'image/png' };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Puts a result on the page. With no page caret to take it, a toast says so where the person is looking: a message
 *  in the live region alone left the first Insert after opening the window looking as if it had failed. */
export function send(detail: Parameters<typeof insertIntoPage>[0]): void {
  if (insertIntoPage(detail)) announce(word('ui.inserted'));
  else showToast({ id: 'lifesys-no-page', message: word('ui.noPage') });
}

/**
 * A live calculation block (ext:org.opennote/kitcalc, the kits' shared block) for a result: the tool, the
 * calculation, and the typed values to reopen it with, and the answer rows and equation shown on the page.
 */
export function liveBlock(tool: string, spec: CalcSpec, values: LifeSysInputs['values'], result: CalcResult) {
  const data = kitCalcData({
    kit: 'lifesys',
    tool,
    title: word(spec.label),
    summary: answerText(result),
    inputs: { calc: spec.id, values } satisfies LifeSysInputs,
    rows: result.rows.map((row) => ({ label: word(row.label, row.vars), value: rowValue(row), unit: row.unit ?? '' })),
    ...(result.latex ? { latex: result.latex } : {}),
  });
  return { type: KIT_CALC_TYPE, data: { ...data }, fallback: kitCalcFallback(data) };
}
