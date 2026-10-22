import { describe, expect, it, vi } from 'vitest';
import { createMarkdownCache } from '../../../editor/markdown';
import { EN_US } from '../engine';
import { EMPTY_SMART } from '../smart/data';
import { buildModel } from '../smart/model';
import type { SmartInstance } from '../smart/ops';
import { runAnalysis } from './run';
import type { AnalysisTool } from './run';
import { readBlock } from './read';

function setup(texts: string[][], range: { row0: number; row1: number; col0: number; col1: number } | null = null) {
  const columnIds = texts[0].map((_, i) => `c${i}`);
  const model = buildModel({ header: true, columnIds, texts }, EMPTY_SMART, EN_US);
  const inserted: Record<string, unknown>[] = [];
  const announced: string[] = [];
  const inst = {
    locale: EN_US,
    model: () => model,
    range: () => range,
    host: {
      cache: createMarkdownCache(),
      announce: (text: string) => announced.push(text),
      insertTable: vi.fn(async (data: Record<string, unknown>) => {
        inserted.push(data);
        return true;
      }),
    },
  } as unknown as SmartInstance;
  return { inst, inserted, announced, model };
}

const cellText = (data: Record<string, unknown>) =>
  (data.rows as { cells: Record<string, { markdown: string }> }[]).map((row) =>
    Object.values(row.cells).map((cell) => cell.markdown.replaceAll('\\', '')),
  );

const run = (tool: AnalysisTool, texts: string[][], range = null as Parameters<typeof setup>[1]) => {
  const made = setup(texts, range);
  return runAnalysis(made.inst, tool).then((ok) => ({ ok, ...made }));
};

describe('analysis tools on table data', () => {
  const scores = [
    ['Score', 'Weight'],
    ['2', '1'],
    ['4', '2'],
    ['4', '3'],
    ['6', '4'],
  ];

  it('adds a statistics table for every numeric column', async () => {
    const { ok, inserted } = await run('summary', scores);
    expect(ok).toBe(true);
    const rows = cellText(inserted[0]);
    expect(rows[0]).toEqual(['Statistic', 'Score', 'Weight']);
    expect(rows[1]).toEqual(['Count', '4', '4']);
    expect(rows.find((r) => r[0] === 'Mean')).toEqual(['Mean', '4', '2.5']);
    expect(rows.find((r) => r[0] === 'Mode')?.[1]).toBe('4');
  });

  it('keeps a shared unit on the results', async () => {
    const { inserted } = await run('summary', [['Mass'], ['2 kg'], ['4 kg']]);
    const mean = cellText(inserted[0]).find((r) => r[0] === 'Mean');
    expect(mean).toEqual(['Mean', '3 kg']);
  });

  it('refuses mixed units', async () => {
    const { ok, announced } = await run('summary', [['Mass'], ['2 kg'], ['4 g']]);
    expect(ok).toBe(false);
    expect(announced[0]).toContain('different units');
  });

  it('adds a histogram with a chart', async () => {
    const { inserted } = await run('histogram', scores);
    expect((inserted[0].smart as { charts: unknown[] }).charts).toHaveLength(1);
  });

  it('fits a line and adds a summary and a data table with a scatter chart', async () => {
    const { inserted } = await run('linear', [
      ['x', 'y'],
      ['1', '3'],
      ['2', '5'],
      ['3', '7'],
    ]);
    expect(inserted).toHaveLength(2);
    expect(cellText(inserted[0])[1]).toEqual(['Equation', 'y = 2x + 1']);
    expect((inserted[1].smart as { charts: { kind: string }[] }).charts[0].kind).toBe('scatter');
  });

  it('uses only the selected cells', async () => {
    const { inserted } = await run(
      'transpose',
      [
        ['a', 'b', 'c'],
        ['1', '2', '3'],
        ['4', '5', '6'],
      ],
      {
        row0: 1,
        row1: 2,
        col0: 0,
        col1: 1,
      },
    );
    expect(cellText(inserted[0])).toEqual([
      ['1', '4'],
      ['2', '5'],
    ]);
  });

  it('inverts, and says when there is no inverse', async () => {
    const good = await run('inverse', [
      ['a', 'b'],
      ['2', '1'],
      ['5', '3'],
    ]);
    expect(cellText(good.inserted[0])).toEqual([
      ['3', '-1'],
      ['-5', '2'],
    ]);
    const bad = await run('inverse', [
      ['a', 'b'],
      ['1', '2'],
      ['2', '4'],
    ]);
    expect(bad.ok).toBe(false);
    expect(bad.announced[0]).toContain('no inverse');
  });

  it('solves a system from an augmented selection', async () => {
    const { inserted } = await run('solve', [
      ['a', 'b', 'c'],
      ['2', '1', '5'],
      ['1', '-1', '1'],
    ]);
    expect(cellText(inserted[0])).toEqual([
      ['Unknown', 'Value'],
      ['x1', '2'],
      ['x2', '1'],
    ]);
  });

  it('shows row reduction steps as fractions', async () => {
    const { inserted } = await run('rref', [
      ['a', 'b'],
      ['2', '1'],
      ['1', '3'],
    ]);
    const rows = cellText(inserted[0]);
    expect(rows[0][0]).toBe('Start');
    expect(rows[rows.length - 2][0]).toBe('Reduced row echelon form');
    expect(rows.flat()).toContain('1/2');
  });

  it('reports a text cell in a matrix', async () => {
    const { ok, announced } = await run('determinant', [
      ['a', 'b'],
      ['1', 'x'],
      ['3', '4'],
    ]);
    expect(ok).toBe(false);
    expect(announced[0]).toContain('B1');
  });

  it('reads a whole table when only the cursor is in it', () => {
    const { model } = setup(scores);
    const block = readBlock(model, EN_US, { row0: 1, row1: 1, col0: 0, col1: 0 });
    expect(block?.rows).toHaveLength(4);
    expect(block?.cols).toEqual([0, 1]);
  });
});
