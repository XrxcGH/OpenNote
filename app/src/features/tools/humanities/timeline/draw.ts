// The timeline drawn as SVG on paper colors: a row of tracks, each with its items packed into sub-rows, era bands
// behind them, uncertainty bars on uncertain dates, and the axis along the bottom. Words come from the tool.
import { PAPER, SERIES, escapeXml, r2, svgDocument, svgText, textWidth } from '../svg';
import { logTicks, linearTicks, packLanes, position } from './layout';
import type { Row, Scale } from './layout';
import { PRESENT } from './dates';

export interface DrawOptions {
  width: number;
  scale: Scale;
  title: string;
  /** The axis label for a year, or for years before present on a log axis. */
  tick(value: number, scale: Scale): string;
  /** The label of an item, with its qualifier. */
  label(row: Row): string;
}

const GUTTER = 130;
const RIGHT = 20;
const TOP = 30;
const LANE = 30;
const AXIS = 40;
const SIZE = 11;

export interface Drawn {
  svg: string;
  tracks: string[];
  lanes: number[];
}

function bar(x0: number, x1: number, y: number, color: string): string {
  return `<rect x="${r2(x0)}" y="${r2(y)}" width="${r2(Math.max(x1 - x0, 2))}" height="10" rx="2" fill="${color}"/>`;
}

function whisker(x0: number, x1: number, y: number): string {
  if (x1 - x0 < 1) return '';
  return (
    `<line x1="${r2(x0)}" y1="${r2(y)}" x2="${r2(x1)}" y2="${r2(y)}" stroke="${PAPER.text}" stroke-width="1"/>` +
    `<line x1="${r2(x0)}" y1="${r2(y - 4)}" x2="${r2(x0)}" y2="${r2(y + 4)}" stroke="${PAPER.text}"/>` +
    `<line x1="${r2(x1)}" y1="${r2(y - 4)}" x2="${r2(x1)}" y2="${r2(y + 4)}" stroke="${PAPER.text}"/>`
  );
}

export function timelineSvg(rows: readonly Row[], options: DrawOptions): Drawn {
  const { width, scale } = options;
  const plot = width - GUTTER - RIGHT;
  const at = (year: number) => GUTTER + Math.min(1, Math.max(0, position(scale, year))) * plot;
  // A label starts at its date, or further left when it would run off the right edge.
  const labelAt = (row: Row) =>
    Math.max(GUTTER, Math.min(at(row.start.mid), width - RIGHT - textWidth(options.label(row), SIZE)));
  const items = rows.filter((row) => row.kind !== 'era');
  const eras = rows.filter((row) => row.kind === 'era');
  const tracks = [...new Set(items.map((row) => row.track))];
  const extent = items.map((row) => {
    const start = Math.min(at(row.start.low), labelAt(row));
    const end = Math.max(
      at(row.end ? row.end.high : row.start.high),
      labelAt(row) + textWidth(options.label(row), SIZE),
    );
    return { start, end };
  });
  const lanes = new Array<number>(items.length).fill(0);
  const heights = tracks.map((track) => {
    const members = items.map((row, index) => (row.track === track ? index : -1)).filter((index) => index >= 0);
    const packed = packLanes(
      members.map((index) => extent[index]!),
      8,
    );
    members.forEach((index, n) => (lanes[index] = packed[n]!));
    return Math.max(1, ...packed.map((lane) => lane + 1)) * LANE + 10;
  });
  const tops = heights.map((_, index) => TOP + heights.slice(0, index).reduce((sum, h) => sum + h, 0));
  const bottom = TOP + heights.reduce((sum, h) => sum + h, 0);
  const height = bottom + AXIS;
  const parts: string[] = [];

  for (const era of eras) {
    const x0 = at(era.start.mid);
    const x1 = at(era.end!.mid);
    parts.push(
      `<rect x="${r2(x0)}" y="${TOP - 4}" width="${r2(Math.max(x1 - x0, 1))}" height="${r2(bottom - TOP + 4)}" ` +
        `fill="${PAPER.warmSoft}" opacity="0.6"/>`,
      svgText(x0 + 3, TOP - 10, era.label, SIZE, ` fill-opacity="0.9"`),
    );
  }
  tracks.forEach((track, index) => {
    const y = tops[index]!;
    if (index > 0)
      parts.push(
        `<line x1="0" y1="${r2(y)}" x2="${r2(width)}" y2="${r2(y)}" stroke="${PAPER.grid}" stroke-width="1"/>`,
      );
    parts.push(svgText(8, y + 20, track, SIZE + 1, ' font-weight="600"'));
  });
  items.forEach((row, index) => {
    const color = SERIES[tracks.indexOf(row.track) % SERIES.length]!;
    const y = tops[tracks.indexOf(row.track)]! + lanes[index]! * LANE + 6;
    const x = at(row.start.mid);
    parts.push(svgText(labelAt(row), y + 10, options.label(row), SIZE));
    if (row.end) {
      parts.push(bar(x, at(row.end.mid), y + 14, color));
      parts.push(whisker(at(row.start.low), at(row.start.high), y + 19));
      parts.push(whisker(at(row.end.low), at(row.end.high), y + 19));
    } else {
      parts.push(whisker(at(row.start.low), at(row.start.high), y + 19));
      parts.push(
        `<circle cx="${r2(x)}" cy="${r2(y + 19)}" r="4.5" fill="${color}" stroke="${PAPER.text}" stroke-width="0.8"/>`,
      );
    }
  });

  parts.push(
    `<line x1="${GUTTER}" y1="${r2(bottom)}" x2="${r2(GUTTER + plot)}" y2="${r2(bottom)}" stroke="${PAPER.line}"/>`,
  );
  const ticks =
    scale.kind === 'log'
      ? logTicks(scale.oldest, scale.youngest).map((bp) => ({ year: PRESENT - bp, value: bp }))
      : linearTicks(scale.from, scale.to).map((year) => ({ year, value: year }));
  for (const tick of ticks) {
    if (scale.kind === 'broken' && tick.year > scale.gapFrom && tick.year < scale.gapTo) continue;
    const x = at(tick.year);
    parts.push(
      `<line x1="${r2(x)}" y1="${r2(bottom)}" x2="${r2(x)}" y2="${r2(bottom + 5)}" stroke="${PAPER.line}"/>`,
      svgText(x, bottom + 18, options.tick(tick.value, scale), SIZE - 1, ' text-anchor="middle"'),
    );
  }
  if (scale.kind === 'broken') {
    const x = at((scale.gapFrom + scale.gapTo) / 2);
    parts.push(
      `<rect x="${r2(x - 5)}" y="${r2(bottom - 6)}" width="10" height="12" fill="${PAPER.background}"/>`,
      `<path d="M${r2(x - 7)} ${r2(bottom + 6)} l6 -12 M${r2(x + 1)} ${r2(bottom + 6)} l6 -12" stroke="${PAPER.text}"/>`,
    );
  }
  const body = `<g><desc>${escapeXml(options.title)}</desc>${parts.join('')}</g>`;
  return { svg: svgDocument(width, height, body, options.title), tracks, lanes };
}
