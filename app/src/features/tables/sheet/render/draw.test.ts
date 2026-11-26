// checks-disable-file brand-consistency: cell colors here are document data of the file format, not interface styling
import { describe, expect, it } from 'vitest';
import { applyToRange, type Sheet, type StyleChange, type TableLike } from '../model';
import { K, R, makeTable, range } from '../model/testing';
import { kindOf, textAlign } from './align';
import { cssLine, heavier } from './borders';
import { automaticText, contrast, textTokens } from './color';
import { drawTable } from './draw';
import { LOOK_NAMES, lookStyle } from './looks';
import { centerAcrossSpan, overflowCells, rotatedBox, shrinkScale } from './spill';

const table = makeTable(range(1, 4), range(1, 4));

/** The table with the typed text of some cells replaced, by column ID, in the first row. */
function withCells(t: TableLike, texts: Record<string, string>): TableLike {
  const [first, ...rest] = t.rows;
  const cells = { ...first.cells };
  for (const [id, markdown] of Object.entries(texts)) cells[id] = { markdown };
  return { ...t, rows: [{ ...first, cells }, ...rest] };
}

function styled(base: Sheet, tbl: TableLike, cell: [number, number], change: StyleChange): Sheet {
  return applyToRange(base, tbl, [R(cell[0]), K(cell[1])], [R(cell[0]), K(cell[1])], change).sheet;
}

const draw = (sheet: Sheet, tbl: TableLike = table, extra: object = {}) =>
  drawTable({ sheet, table: tbl, scheme: 'light', ...extra });

describe('alignment variables', () => {
  it('gives a cell with align center and middle and pad left 6 the matching variables', () => {
    const sheet = styled({}, table, [1, 1], { align: { h: 'center', v: 'middle' }, pad: { l: 6 } });
    const { vars } = draw(sheet).cells[0][0];
    expect(vars['--cell-h']).toBe('center');
    expect(vars['--cell-v']).toBe('middle');
    expect(vars['--cell-pad-l']).toBe('6pt');
    expect(vars['--cell-pad-t']).toBe('2pt');
  });

  it('aligns General by value: numbers right, booleans center, text start', () => {
    const t: TableLike = {
      columns: [{ id: K(1) }, { id: K(2) }, { id: K(3) }, { id: K(4) }],
      rows: [
        {
          id: R(1),
          cells: {
            [K(1)]: { markdown: '42' },
            [K(2)]: { markdown: 'TRUE' },
            [K(3)]: { markdown: 'hello' },
            [K(4)]: { markdown: '#DIV/0!' },
          },
        },
      ],
    };
    const row = draw({}, t).cells[0].map((c) => c.vars['--cell-h']);
    expect(row).toEqual(['right', 'center', 'start', 'center']);
    expect(kindOf('$1,234.50')).toBe('number');
    expect(kindOf('12 apples')).toBe('text');
    expect(textAlign('left', 'number')).toBe('left');
    expect(textAlign('distributed', 'text')).toBe('justify');
  });

  it('uses the shown value of a formula to decide the kind', () => {
    const t = makeTable([1], [1]);
    const drawn = draw({}, t, { shown: () => ({ text: '7', kind: 'number' }) });
    expect(drawn.cells[0][0].vars['--cell-h']).toBe('right');
  });
});

describe('borders', () => {
  it('writes a stored border width in points and a named style in pixels', () => {
    expect(cssLine({ style: 'thin', color: '#000000', width: 3 }, '#000000')).toBe('3pt solid #000000');
    expect(cssLine({ style: 'thin', color: '#000000' }, '#000000')).toBe('1px solid #000000');
  });
  it('draws thick where B2 bottom is thin and B3 top is thick', () => {
    let sheet = styled({}, table, [2, 2], { border: { b: { style: 'thin', color: '#112233' } } });
    sheet = styled(sheet, table, [3, 2], { border: { t: { style: 'thick', color: '#445566' } } });
    const drawn = draw(sheet);
    expect(drawn.cells[1][1].vars['--cell-bb']).toBe('3px solid #445566');
    expect(drawn.cells[2][1].vars['--cell-bt']).toBe('3px solid #445566');
  });

  it('settles a tie for the right or lower cell, and keeps any one side alone', () => {
    const a = { style: 'thin', color: '#111111' };
    const b = { style: 'thin', color: '#222222' };
    expect(heavier(a, b)).toBe(b);
    expect(heavier(a, undefined)).toBe(a);
    expect(heavier({ style: 'double' }, { style: 'thick' })?.style).toBe('double');
    expect(heavier({ style: 'dotted' }, { style: 'hair' })?.style).toBe('dotted');
    expect(heavier({ style: 'bogus' }, undefined)).toBeUndefined();
  });

  it('draws a gridline on edges with no border and none when the grid is off', () => {
    const on = draw({}).cells[0][0].vars;
    expect(on['--cell-bt']).toContain('var(--sheet-grid)');
    const off = draw({ table: { grid: false } });
    // The grid color is the stylesheet's (an inline value would beat the forced-colors rule); the table says "off".
    expect(off.table.vars['--sheet-grid']).toBeUndefined();
    expect(off.table.data['data-no-grid']).toBe('');
  });

  it('maps all 13 styles to a CSS line', () => {
    const styles = [
      'thin',
      'medium',
      'thick',
      'hair',
      'dotted',
      'dashed',
      'mediumDashed',
      'dashDot',
      'mediumDashDot',
      'dashDotDot',
      'mediumDashDotDot',
      'slantDashDot',
      'double',
    ];
    for (const style of styles) {
      const sheet = styled({}, table, [1, 1], { border: { l: { style, color: '#000000' } } });
      expect(draw(sheet).cells[0][0].vars['--cell-bl']).toMatch(/^[\d.]+px (solid|dashed|dotted|double) #000000$/);
    }
  });
});

describe('overflow, center across, rotation, and shrink', () => {
  const row = (texts: string[], align: object = { wrap: 'overflow' }) =>
    texts.map((text) => ({ text, kind: kindOf(text), align }));

  it('draws long text in A1 across the empty B1 and stops at C1 when C1 has text', () => {
    expect(overflowCells(row(['a very long sentence', '', 'stop', '']), 0)).toEqual({ before: 0, after: 1 });
    expect(overflowCells(row(['a very long sentence', '', '', '']), 0)).toEqual({ before: 0, after: 3 });
    const sheet = styled({}, table, [1, 1], { align: { wrap: 'overflow' } });
    const t = withCells(makeTable([1], [1, 2, 3]), { [K(2)]: '' });
    const drawn = draw(sheet, t);
    expect(drawn.cells[0][0].data['data-spill-after']).toBe('1');
    expect(drawn.cells[0][0].data['data-wrap']).toBe('overflow');
  });

  it('never spills numbers, clipped text, or wrapped text', () => {
    expect(overflowCells(row(['12345', '']), 0).after).toBe(0);
    expect(overflowCells(row(['long text', ''], { wrap: 'clip' }), 0).after).toBe(0);
    expect(overflowCells(row(['long text', ''], { wrap: 'wrap' }), 0).after).toBe(0);
  });

  it('spills right-aligned text to the left and centered text evenly', () => {
    expect(overflowCells(row(['', '', 'text'], { wrap: 'overflow', h: 'right' }), 2)).toEqual({ before: 2, after: 0 });
    expect(overflowCells(row(['', 'text', '', ''], { wrap: 'overflow', h: 'center' }), 1)).toEqual({
      before: 1,
      after: 1,
    });
  });

  it('centers across the empty cells that follow', () => {
    const r = row(['title', '', '', 'x'], { h: 'centerAcross' });
    expect(centerAcrossSpan(r, 0)).toBe(2);
    const sheet = styled({}, table, [1, 1], { align: { h: 'centerAcross' } });
    const wide = styled(styled(sheet, table, [1, 2], { align: { h: 'centerAcross' } }), table, [1, 3], {
      align: { h: 'centerAcross' },
    });
    const t = withCells(makeTable([1], [1, 2, 3, 4]), { [K(2)]: '', [K(3)]: '' });
    const drawn = draw(wide, t);
    expect(drawn.cells[0][0].data['data-across']).toBe('2');
    expect(drawn.cells[0][1].data['data-across-covered']).toBe('');
    expect(drawn.cells[0][2].data['data-across-covered']).toBe('');
  });

  it('turns text counterclockwise for a positive angle and stacks text', () => {
    const sheet = styled(styled({}, table, [1, 1], { align: { rotate: 45 } }), table, [1, 2], {
      align: { rotate: 'stacked' },
    });
    const drawn = draw(sheet);
    expect(drawn.cells[0][0].vars['--cell-rotate']).toBe('-45deg');
    expect(drawn.cells[0][0].data['data-rotate']).toBe('45');
    expect(drawn.cells[0][1].data['data-stacked']).toBe('');
  });

  it('finds the box of rotated text and the shrink factor', () => {
    const turned = rotatedBox(100, 20, 90);
    expect(turned.width).toBeCloseTo(20);
    expect(turned.height).toBeCloseTo(100);
    const diag = rotatedBox(100, 20, 45);
    expect(diag.height).toBeCloseTo((100 + 20) / Math.SQRT2);
    expect(shrinkScale(100, 200)).toBe(1);
    expect(shrinkScale(200, 100)).toBe(0.5);
    expect(shrinkScale(1000, 10)).toBe(0.25);
  });
});

describe('fonts, fills, and automatic text', () => {
  it('resolves Automatic text on fill #1e293b to the light text token with a ratio of at least 4.5', () => {
    const sheet = styled({}, table, [1, 1], { fill: '#1e293b' });
    const color = draw(sheet).cells[0][0].vars['--cell-color'];
    expect(color).toBe(textTokens().light);
    expect(contrast(color, '#1e293b')).toBeGreaterThanOrEqual(4.5);
    expect(automaticText('#fef3c7')).toBe(textTokens().dark);
  });

  it('keeps a color the person set, and writes fonts as variables', () => {
    const sheet = styled({}, table, [1, 1], {
      fill: '#1e293b',
      font: {
        color: '#ff0000',
        size: 14,
        bold: true,
        italic: true,
        underline: 'double',
        strike: 'single',
        family: 'Garamond',
      },
    });
    const { vars } = draw(sheet).cells[0][0];
    expect(vars['--cell-color']).toBe('#ff0000');
    expect(vars['--cell-size']).toBe('14pt');
    expect(vars['--cell-weight']).toBe('700');
    expect(vars['--cell-style']).toBe('italic');
    expect(vars['--cell-deco']).toBe('underline double line-through');
    expect(vars['--cell-font']).toContain('Garamond');
  });

  it('draws patterns and gradients, and ignores a pattern it does not know', () => {
    const grid = styled({}, table, [1, 1], { fill: { pattern: 'darkGrid', color: '#000000', back: '#ffffff' } });
    expect(draw(grid).cells[0][0].vars['--cell-fill-image']).toContain('repeating-linear-gradient');
    const grad = styled({}, table, [1, 1], {
      fill: {
        gradient: {
          angle: 0,
          stops: [
            { at: 0, color: '#000000' },
            { at: 1, color: '#ffffff' },
          ],
        },
      },
    });
    expect(draw(grad).cells[0][0].vars['--cell-fill-image']).toContain('linear-gradient(90deg');
    const odd = styled({}, table, [1, 1], { fill: { pattern: 'future' } });
    expect(draw(odd).cells[0][0].vars['--cell-fill']).toBeUndefined();
  });
});

describe('rows, hidden lines, freeze panes', () => {
  it('sets exact and minimum row heights', () => {
    const sheet: Sheet = { rows: { [R(1)]: { height: 40, exact: true }, [R(2)]: { height: 30 } } };
    const drawn = draw(sheet);
    expect(drawn.rows[0].vars['--row-h']).toBe('40px');
    expect(drawn.rows[0].data['data-row-exact']).toBe('');
    expect(drawn.rows[1].data['data-row-min']).toBe('');
    expect(drawn.rows[2].vars['--row-h']).toBeUndefined();
  });

  it('marks hidden rows and columns and the edge beside them', () => {
    const sheet: Sheet = { rows: { [R(2)]: { hidden: true } }, cols: { [K(3)]: { hidden: true } } };
    const drawn = draw(sheet);
    expect(drawn.rows[1].data['data-row-hidden']).toBe('');
    expect(drawn.cells[0][2].data['data-col-hidden']).toBe('');
    expect(drawn.cells[0][0].data['data-hidden-below']).toBe('');
    expect(drawn.cells[0][1].data['data-hidden-right']).toBe('');
    expect(drawn.cells[0][0].data['data-hidden-right']).toBeUndefined();
  });

  it('marks frozen rows and columns and their edge', () => {
    const drawn = draw({ table: { freeze: { rows: 1, cols: 2 } } });
    expect(drawn.cells[0][0].data['data-frozen-row']).toBe('edge');
    expect(drawn.cells[0][1].data['data-frozen-col']).toBe('edge');
    expect(drawn.cells[0][0].data['data-frozen-col']).toBe('');
    expect(drawn.cells[1][3].data['data-frozen-row']).toBeUndefined();
    expect(draw({ table: { freeze: { rows: 99 } } }).cells[3][0].data['data-frozen-row']).toBe('edge');
    expect(drawn.table.data['data-frozen-rows']).toBe('');
    expect(drawn.table.data['data-frozen-cols']).toBe('');
    expect(draw({}).table.data['data-frozen-rows']).toBeUndefined();
  });

  it('puts the freeze edge on the last frozen row and column that show', () => {
    const sheet: Sheet = {
      table: { freeze: { rows: 2, cols: 2 } },
      rows: { [R(2)]: { hidden: true } },
      cols: { [K(2)]: { hidden: true } },
    };
    const drawn = draw(sheet);
    expect(drawn.cells[0][0].data['data-frozen-row']).toBe('edge');
    expect(drawn.cells[0][0].data['data-frozen-col']).toBe('edge');
  });

  it('marks the header row so it can repeat on each printed page', () => {
    const t = makeTable(range(1, 3), range(1, 2), true);
    expect(draw({}, t).rows[0].data['data-header-row']).toBe('');
    expect(draw({}, t).rows[1].data['data-header-row']).toBeUndefined();
    expect(draw({}, table).rows[0].data['data-header-row']).toBeUndefined();
    expect(draw({ rows: { [R(1)]: { hidden: true } } }, t).rows[0].data['data-header-row']).toBeUndefined();
  });
});

describe('looks and banding', () => {
  const t = makeTable(range(1, 6), range(1, 2), true);
  const sheet: Sheet = { table: { look: 'medium-indigo', band: { rows: true } } };
  const fills = (drawn: ReturnType<typeof draw>) => drawn.cells.map((r) => r[0].vars['--cell-fill']);

  it('has 21 looks, each drawing a header', () => {
    expect(LOOK_NAMES).toHaveLength(21);
    for (const name of LOOK_NAMES) {
      expect(lookStyle(name, 'header', 'light')).toBeDefined();
      expect(lookStyle(name, 'band1', 'dark')).toBeDefined();
    }
    expect(lookStyle('unknown-look', 'header', 'light')).toBeUndefined();
    expect(lookStyle('medium-nothing', 'header', 'light')).toBeUndefined();
  });

  it('bands by position in the view, so a hidden row does not break the banding', () => {
    const plain = fills(draw(sheet, t));
    // Header, then band1, band2, band1, band2, band1.
    expect(plain[1]).toBeDefined();
    expect(plain[2]).toBeUndefined();
    expect(plain[3]).toBe(plain[1]);
    const filtered = fills(draw(sheet, t, { hiddenRows: new Set([R(2)]) }));
    // Row 2 is gone: row 3 is now the first band and row 4 the second.
    expect(filtered[2]).toBe(plain[1]);
    expect(filtered[3]).toBeUndefined();
    expect(filtered[4]).toBe(plain[1]);
  });

  it('recolors looks with the scheme and picks readable text on every filled cell', () => {
    const light = draw(sheet, t);
    const dark = drawTable({ sheet, table: t, scheme: 'dark' });
    expect(light.cells[0][0].vars['--cell-fill']).not.toBe(dark.cells[0][0].vars['--cell-fill']);
    const ratios = LOOK_NAMES.flatMap((name) => lookRatios(name, t));
    expect(ratios.length).toBeGreaterThan(100);
    expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  });
});

/** The contrast of text on fill for every filled cell of a look, in both schemes. */
function lookRatios(name: string, t: TableLike): number[] {
  const sheet: Sheet = { table: { look: name, band: { rows: true }, emphasis: { totalRow: true, firstCol: true } } };
  return (['light', 'dark'] as const).flatMap((scheme) =>
    drawTable({ sheet, table: t, scheme })
      .cells.flat()
      .map((c) => c.vars)
      .filter((vars) => vars['--cell-fill'] && vars['--cell-color'])
      .map((vars) => contrast(vars['--cell-color'], vars['--cell-fill'])),
  );
}

describe('drawing again after a text change', () => {
  const sheet = styled({}, table, [1, 1], { fill: '#1e293b', align: { wrap: 'overflow' } });
  const edited = (t: TableLike, row: number, texts: Record<string, string>): TableLike => ({
    ...t,
    rows: t.rows.map((r, i) =>
      i === row
        ? {
            ...r,
            cells: { ...r.cells, ...Object.fromEntries(Object.entries(texts).map(([k, v]) => [k, { markdown: v }])) },
          }
        : r,
    ),
  });

  it('draws only the rows whose text changed, and gives what a full drawing gives', () => {
    const first = draw(sheet);
    const next = edited(table, 2, { [K(1)]: 'A long line of words' });
    const again = drawTable({ sheet, table: next, scheme: 'light' }, first);
    expect([...(again.changed ?? [])]).toEqual([2]);
    expect(again.cells[0]).toBe(first.cells[0]);
    expect(again.cells[3]).toBe(first.cells[3]);
    expect(again.cells[2]).not.toBe(first.cells[2]);
    expect(again.table).toBe(first.table);
    expect(JSON.parse(JSON.stringify(again.cells))).toEqual(
      JSON.parse(JSON.stringify(drawTable({ sheet, table: next, scheme: 'light' }).cells)),
    );
    // Text that is the same draws nothing again, even in a new row object.
    const same = drawTable({ sheet, table: edited(table, 1, {}), scheme: 'light' }, first);
    expect(same.changed?.size).toBe(0);
  });

  it('draws everything again when the sheet changes', () => {
    const first = draw(sheet);
    const again = drawTable(
      { sheet: styled(sheet, table, [2, 2], { fill: '#fef3c7' }), table, scheme: 'light' },
      first,
    );
    expect(again.changed).toBeUndefined();
    expect(again.cells[2]).not.toBe(first.cells[2]);
  });

  it('restyles rows when a conditional format depends on the text that changed', () => {
    const rules: Sheet = { conditional: { c1: { order: 1, type: 'blank', ranges: [{ col: K(1) }], style: 'aaaaaa' } } };
    const conditional = (_r: unknown, cell: { row: number; col: number }, _s: Sheet, t: TableLike) =>
      t.rows[cell.row].cells[t.columns[cell.col].id]?.markdown === 'hot' ? [{ fill: '#ff0000' }] : [];
    const input = { sheet: rules, scheme: 'light' as const, hooks: { conditional } };
    const first = drawTable({ ...input, table });
    expect(first.cells[0][0].vars['--cell-fill']).toBeUndefined();
    const next = withCells(table, { [K(1)]: 'hot' });
    const again = drawTable({ ...input, table: next }, first);
    expect(again.cells[0][0].vars['--cell-fill']).toBe('#ff0000');
    expect(again.cells[0][0].vars['--cell-fill']).toBe(
      drawTable({ ...input, table: next }).cells[0][0].vars['--cell-fill'],
    );
    expect(again.cells[3]).toBe(first.cells[3]);
    // And back: the fill goes when the text goes.
    expect(drawTable({ ...input, table }, again).cells[0][0].vars['--cell-fill']).toBeUndefined();
  });
});

describe('automatic text on shaded patterns', () => {
  // WCAG 2.x relative luminance, written out here so the test does not share code with the module.
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  it.each([
    ['darkGray', '#404040'],
    ['mediumGray', '#808080'],
    ['lightGray', '#bfbfbf'],
    ['gray125', '#e0e0e0'],
  ])('reads on %s black over white, which shows about %s', (pattern, shown) => {
    const sheet = styled({}, table, [1, 1], { fill: { pattern, color: '#000000', back: '#ffffff' } } as StyleChange);
    const color = draw(sheet).cells[0][0].vars['--cell-color'];
    expect(ratio(color, shown)).toBeGreaterThanOrEqual(4.5);
  });
});
