// The measuring pass: sizes that only the browser's layout knows. It READS the layout first, in one go, and returns
// what it found as properties per cell; only then does it write (when `apply` is set, which the browser tests use).
// The editor does not apply them. It hands them to the render plugin, which puts them in node decorations. So
// ProseMirror's own DOM is never touched from outside its updates, which it would read as an edit.
// `measureTable` is self-contained (it uses no import), so a test can run its source inside a page.
// The browser tests in tests/ui/behavior/sheet-render.spec.ts check it. Its shrink and rotation formulas are those
// of spill.ts.
// checks-disable-file modifiability: one function with no helpers outside it, so its source can run in a page

/** The properties measured for one cell: custom properties (`--cell-...`) and one data attribute. */
export type CellProps = Record<string, string>;

/** Measured cells by row position in the table, then by cell position in the row. A measured row has an entry. */
export type Measured = Map<number, Map<number, CellProps>>;

export interface MeasureOptions {
  /** Row positions to measure (the frozen rows are always included); every row when unset. */
  rows?: ReadonlySet<number>;
  /** Write the properties to the cells. The default is on, for a table nobody else manages. */
  apply?: boolean;
}

/** Measures the styled cells of a table and finds the properties render.css reads. */
export function measureTable(table: HTMLElement, options: MeasureOptions = {}): Measured {
  const MAX_FILL = 2000;
  const NAMES = [
    '--cell-spill-l',
    '--cell-spill-r',
    '--cell-shrink',
    '--cell-rot-h',
    '--cell-sticky-top',
    '--cell-sticky-left',
    'data-fill-text',
  ];
  const all = Array.from(table.querySelectorAll('tr'));
  const lists = new Map<number, HTMLElement[]>();
  const listAt = (i: number): HTMLElement[] => {
    let list = lists.get(i);
    if (!list) {
      list = Array.from(all[i]?.children ?? []).filter(
        (c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute('data-cell'),
      );
      lists.set(i, list);
    }
    return list;
  };
  const shown = (i: number) => all[i] !== undefined && !all[i].hasAttribute('data-row-hidden');
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  const reach = (list: HTMLElement[], from: number, step: number, count: number): number => {
    let w = 0;
    for (let k = 1; k <= count; k += 1) w += list[from + step * k]?.getBoundingClientRect().width ?? 0;
    return w;
  };
  const textBox = (p: HTMLElement): number => {
    const range = document.createRange();
    range.selectNodeContents(p);
    return range.getBoundingClientRect().width;
  };

  // The frozen rows are the leading shown rows that have a frozen cell.
  const frozen: number[] = [];
  for (let i = 0; i < all.length; i += 1) {
    if (!shown(i)) continue;
    if (!listAt(i).some((td) => td.hasAttribute('data-frozen-row'))) break;
    frozen.push(i);
  }
  const scope = new Set<number>(frozen);
  if (options.rows) options.rows.forEach((i) => shown(i) && scope.add(i));
  else all.forEach((_, i) => shown(i) && scope.add(i));

  const out: Measured = new Map();
  const put = (row: number, cell: number, name: string, value: string): void => {
    let cells = out.get(row);
    if (!cells) out.set(row, (cells = new Map()));
    let props = cells.get(cell);
    if (!props) cells.set(cell, (props = {}));
    props[name] = value;
  };

  for (const i of scope) {
    const list = listAt(i);
    const rowCells = out.get(i) ?? new Map<number, CellProps>();
    out.set(i, rowCells);
    list.forEach((td, c) => {
      const p = td.firstElementChild instanceof HTMLElement ? td.firstElementChild : null;
      const before = Number(td.dataset.spillBefore ?? 0);
      const after = Number(td.dataset.spillAfter ?? 0) + Number(td.dataset.across ?? 0);
      if (before > 0 || after > 0) {
        put(i, c, '--cell-spill-l', px(reach(list, c, -1, before)));
        put(i, c, '--cell-spill-r', px(reach(list, c, 1, after)));
      }
      if (!p) return;
      const style = getComputedStyle(td);
      if (td.hasAttribute('data-shrink')) {
        // The text is measured as drawn, so the scale it has now is divided out.
        const now = parseFloat(style.getPropertyValue('--cell-shrink')) || 1;
        const box = td.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
        const width = textBox(p);
        const natural = width / now;
        let scale =
          natural <= 0 || box <= 0 || natural <= box ? 1 : Math.max(0.25, Math.floor((box / natural) * 100) / 100);
        // A scale that still fits and is within a hair of the ideal stays, so measuring does not wobble.
        if (now < 1 && width <= box && scale > now && scale - now < 0.03) scale = now;
        put(i, c, '--cell-shrink', String(scale));
      }
      if (td.hasAttribute('data-rotate')) {
        // Layout sizes, not bounding boxes: the box of turned text is already turned.
        const r = (Number(td.dataset.rotate) * Math.PI) / 180;
        const h = p.offsetWidth * Math.abs(Math.sin(r)) + p.offsetHeight * Math.abs(Math.cos(r));
        put(i, c, '--cell-rot-h', px(h + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)));
      }
      if (td.hasAttribute('data-fill-repeat')) {
        const text = p.textContent ?? '';
        const unit = text === '' || text.length > MAX_FILL ? 0 : textBox(p);
        // The repeat is limited in count and in total length, so a long cell cannot make a huge attribute.
        const times = unit > 0 ? Math.min(Math.ceil(td.clientWidth / unit) + 1, Math.floor(MAX_FILL / text.length)) : 0;
        if (times > 0) put(i, c, 'data-fill-text', text.repeat(times));
      }
    });
  }

  // Sticky offsets: a frozen row sticks under the frozen rows above it, a frozen column beside the ones before it.
  let top = 0;
  for (const i of frozen) {
    const offset = px(top);
    listAt(i).forEach((td, c) => td.hasAttribute('data-frozen-row') && put(i, c, '--cell-sticky-top', offset));
    top += all[i].getBoundingClientRect().height;
  }
  const firstAt = all.findIndex((_, i) => shown(i) && listAt(i).length > 0);
  const first = firstAt >= 0 ? listAt(firstAt) : [];
  const lefts: number[] = [];
  let left = 0;
  first.forEach((td) => {
    lefts.push(left);
    if (td.hasAttribute('data-frozen-col')) left += td.getBoundingClientRect().width;
  });
  for (const i of scope) {
    listAt(i).forEach(
      (td, c) => td.hasAttribute('data-frozen-col') && put(i, c, '--cell-sticky-left', px(lefts[c] ?? 0)),
    );
  }

  // Hidden columns: their `col` elements go too, so the table gets no wider than the columns that show. A column
  // group is ProseMirror's own and ignores such changes.
  const cols = options.rows ? [] : Array.from(table.querySelectorAll<HTMLElement>(':scope > colgroup > col'));
  const hide = cols.map((_, i) => first[i]?.hasAttribute('data-col-hidden') === true);

  // Writes come after every read.
  cols.forEach((col, i) => {
    const want = hide[i] ? 'none' : '';
    if (col.style.display !== want) col.style.display = want;
  });
  if (options.apply !== false) {
    for (const [i, rowCells] of out) {
      listAt(i).forEach((td, c) => {
        const props = rowCells.get(c) ?? {};
        for (const name of NAMES) {
          const value = props[name];
          if (name.startsWith('--')) {
            if (value === undefined) td.style.removeProperty(name);
            else td.style.setProperty(name, value);
          } else if (value === undefined) td.removeAttribute(name);
          else td.setAttribute(name, value);
        }
      });
    }
  }
  return out;
}
