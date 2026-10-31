// What Insert puts on the page from a result: the answer line, the worked steps, the result table, the equation in
// LaTeX, the data table, or a picture of the plot. Each says in words whether it worked.
import { t } from '../../../../strings/t';
import { announce } from '../../../../ui';
import { insertIntoPage } from '../../ui/CalculatorTool';
import { fmt } from '../core/format';
import type { Outcome, Plot } from '../core/types';
import { CIVIL_KIT_ID } from '../open';
import type { FieldState } from './parse';
import { PICTURE_PALETTE, plotSvg } from './plot';
import type { PlotText } from './plot';
import { label, say } from './say';

export type InsertKind = 'answer' | 'steps' | 'table' | 'latex' | 'grid' | 'picture';

const cell = (value: number | string) =>
  typeof value === 'number' ? fmt(value) : value.startsWith('~') ? label(value.slice(1)) : value;

export const stepsText = (outcome: Outcome): string =>
  [say(outcome.answer), ...outcome.steps.map((step, i) => `${i + 1}. ${say(step)}`)].join('\n');

/** The words a plot needs: its title, axis names, series names, and a description for screen readers. */
export function plotText(plot: Plot): PlotText {
  const series = plot.series.map((s) => label(s.name));
  return {
    title: label(plot.title),
    x: label(plot.x),
    y: label(plot.y),
    series,
    description: t('kitCivil.common.plotDescription', {
      title: label(plot.title),
      x: label(plot.x),
      y: label(plot.y),
      series: series.join(', '),
    }),
  };
}

async function picture(plot: Plot): Promise<{ bytes: ArrayBuffer; name: string; alt: string; mime: string } | null> {
  const text = plotText(plot);
  const svg = plotSvg(plot, text, PICTURE_PALETTE, 'civil-picture');
  const width = Number(/width="(\d+)"/.exec(svg)?.[1] ?? 520);
  const height = Number(/height="(\d+)"/.exec(svg)?.[1] ?? 320);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width * 2;
    canvas.height = height * 2;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    return blob
      ? { bytes: await blob.arrayBuffer(), name: `${text.title}.png`, alt: text.description, mime: 'image/png' }
      : null;
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * A live calculation block (ext:org.opennote/kitcalc) that keeps the typed inputs and units, so Open in tool puts
 * them back into this calculation and solves it again.
 */
export async function insertLive(
  outcome: Outcome,
  from: { tool: string; calc: string; title: string; state: FieldState },
): Promise<void> {
  const { insertLiveBlock } = await import('../../kits/ui/insert');
  const done = insertLiveBlock({
    kit: CIVIL_KIT_ID,
    tool: `${from.tool}.${from.calc}`,
    title: from.title,
    summary: say(outcome.answer),
    inputs: { text: { ...from.state.text }, unit: { ...from.state.unit } },
    rows: outcome.rows.map((row) => ({
      label: label(row.label),
      value: String(cell(row.value)),
      unit: row.unit ?? '',
    })),
    ...(outcome.latex ? { latex: outcome.latex } : {}),
  });
  announce(t(done ? 'kitCivil.common.inserted' : 'kitCivil.common.noPage'));
}

/** Puts part of a result on the page at the caret, and announces what happened. */
export async function insertResult(outcome: Outcome, kind: InsertKind): Promise<void> {
  let done = false;
  if (kind === 'answer') done = insertIntoPage({ text: say(outcome.answer) });
  else if (kind === 'steps') done = insertIntoPage({ text: stepsText(outcome) });
  else if (kind === 'latex' && outcome.latex) done = insertIntoPage({ math: { source: outcome.latex, display: true } });
  else if (kind === 'table') {
    const header = [t('kitCivil.common.quantity'), t('kitCivil.common.value'), t('kitCivil.common.unit')];
    const rows = outcome.rows.map((row) => [label(row.label), cell(row.value), row.unit ?? '']);
    done = insertIntoPage({ table: { header, rows } });
  } else if (kind === 'grid' && outcome.grid) {
    const { header, rows } = outcome.grid;
    done = insertIntoPage({ table: { header: header.map(label), rows: rows.map((row) => row.map(cell)) } });
  } else if (kind === 'picture' && outcome.plot) {
    const made = await picture(outcome.plot);
    if (!made) return announce(t('kitCivil.common.pictureFailed'));
    done = insertIntoPage({ picture: made });
  }
  announce(t(done ? 'kitCivil.common.inserted' : 'kitCivil.common.noPage'));
}

export { cell };
