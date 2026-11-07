// The measuring pass: sizes that only the browser's layout knows. It writes custom properties and one data
// attribute on cells, never touches their content, and is idempotent. `measureTable` is self-contained (it uses no
// import), so a test can run its source inside a page; the browser tests in
// tests/ui/behavior/sheet-render.spec.ts check it. Its shrink and rotation formulas are those of spill.ts.

/** Measures every styled cell of a table and sets the properties render.css reads. */
export function measureTable(table: HTMLElement): void {
  const cells = (tr: Element): HTMLElement[] =>
    Array.from(tr.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.hasAttribute('data-cell'));
  const rows = Array.from(table.querySelectorAll('tr')).filter((tr) => !tr.hasAttribute('data-row-hidden'));
  const px = (n: number) => `${Math.round(n * 100) / 100}px`;
  const reach = (list: HTMLElement[], from: number, step: number, count: number): number => {
    let w = 0;
    for (let k = 1; k <= count; k += 1) w += list[from + step * k]?.getBoundingClientRect().width ?? 0;
    return w;
  };
  const textBox = (p: HTMLElement): { w: number; h: number } => {
    const range = document.createRange();
    range.selectNodeContents(p);
    const r = range.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };

  for (const tr of rows) {
    const list = cells(tr);
    list.forEach((td, i) => {
      const p = td.firstElementChild instanceof HTMLElement ? td.firstElementChild : null;
      const before = Number(td.dataset.spillBefore ?? 0);
      const after = Number(td.dataset.spillAfter ?? 0) + Number(td.dataset.across ?? 0);
      if (before > 0 || after > 0) {
        td.style.setProperty('--cell-spill-l', px(reach(list, i, -1, before)));
        td.style.setProperty('--cell-spill-r', px(reach(list, i, 1, after)));
      }
      if (!p) return;
      if (td.hasAttribute('data-shrink')) {
        td.style.removeProperty('--cell-shrink');
        const box =
          td.clientWidth - parseFloat(getComputedStyle(td).paddingLeft) - parseFloat(getComputedStyle(td).paddingRight);
        const natural = p.scrollWidth;
        const scale =
          natural <= 0 || box <= 0 || natural <= box ? 1 : Math.max(0.25, Math.floor((box / natural) * 100) / 100);
        td.style.setProperty('--cell-shrink', String(scale));
      }
      if (td.hasAttribute('data-rotate')) {
        // Layout sizes, not bounding boxes: the box of turned text is already turned.
        const r = (Number(td.dataset.rotate) * Math.PI) / 180;
        const h = p.offsetWidth * Math.abs(Math.sin(r)) + p.offsetHeight * Math.abs(Math.cos(r));
        const style = getComputedStyle(td);
        td.style.setProperty('--cell-rot-h', px(h + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)));
      }
      if (td.hasAttribute('data-fill-repeat')) {
        const unit = textBox(p).w;
        const text = p.textContent ?? '';
        if (unit > 0 && text !== '') {
          const times = Math.ceil(td.clientWidth / unit) + 1;
          td.setAttribute('data-fill-text', text.repeat(times));
        } else td.removeAttribute('data-fill-text');
      }
    });
  }

  // Hidden columns: their `col` elements go too, so the table gets no wider than the columns that show.
  const first0 = rows.map(cells).find((list) => list.length > 0);
  Array.from(table.querySelectorAll(':scope > colgroup > col')).forEach((col, i) => {
    (col as HTMLElement).style.display = first0?.[i]?.hasAttribute('data-col-hidden') ? 'none' : '';
  });

  // Sticky offsets: a frozen row sticks under the frozen rows above it, a frozen column beside the ones before it.
  let top = 0;
  for (const tr of rows) {
    const list = cells(tr);
    if (!list.some((td) => td.hasAttribute('data-frozen-row'))) continue;
    for (const td of list) td.style.setProperty('--cell-sticky-top', px(top));
    top += tr.getBoundingClientRect().height;
  }
  const first = rows.map(cells).find((list) => list.length > 0);
  if (first) {
    const lefts: number[] = [];
    let left = 0;
    first.forEach((td) => {
      lefts.push(left);
      if (td.hasAttribute('data-frozen-col')) left += td.getBoundingClientRect().width;
    });
    for (const tr of rows) {
      cells(tr).forEach((td, i) => {
        if (td.hasAttribute('data-frozen-col')) td.style.setProperty('--cell-sticky-left', px(lefts[i] ?? 0));
      });
    }
  }
}
