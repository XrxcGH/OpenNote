// Ink anchored on a table keeps its place (walk 9, T1-D03-3).
import { afterEach, describe, expect, it } from 'vitest';
import { placeAt, placeNow } from './anchoring';

const roots: HTMLElement[] = [];
afterEach(() => roots.splice(0).forEach((r) => r.remove()));

function table(): HTMLElement {
  const root = document.body.appendChild(document.createElement('div'));
  root.dataset.blockId = 'tbl';
  root.style.cssText = 'position:absolute;left:0;top:200px;font:16px/20px sans-serif';
  roots.push(root);
  const tools = root.appendChild(document.createElement('div'));
  tools.className = 'tools';
  // The floating table toolbar: out of the flow, so it moves no words.
  tools.style.cssText = 'position:absolute;left:0;bottom:100%';
  const grid = root.appendChild(document.createElement('table'));
  grid.style.borderCollapse = 'collapse';
  for (const r of [1, 2, 3]) {
    const row = grid.appendChild(document.createElement('tr'));
    for (const c of ['A', 'B', 'C']) {
      const cell = row.appendChild(document.createElement('td'));
      cell.style.cssText = 'padding:15px 40px;border:1px solid';
      cell.appendChild(document.createElement('p')).textContent = `${c}${r}`;
      (cell.firstChild as HTMLElement).style.margin = '0';
    }
  }
  return root;
}

describe('ink anchored in a table', () => {
  for (const [name, dx, dy] of [
    ['on the words', 0, 0],
    ['in the cell padding', 30, 12],
  ] as const) {
    it(`finds the same place again, ${name}`, () => {
      const root = table();
      const cell = root.querySelectorAll('td')[4]!.firstChild as HTMLElement;
      const r = cell.getBoundingClientRect();
      const place = placeAt(document, r.left + 4 + dx, r.top + 4 + dy)!;
      expect(place.block).toBe('tbl');
      const tools = root.querySelector('.tools')!;
      tools.setAttribute('role', 'toolbar');
      tools.textContent = 'Column width 120 px Row height A2 B2 C2';
      const now = placeNow(root, place)!;
      expect(Math.abs(now.y - place.y)).toBeLessThan(2);
      expect(Math.abs(now.x - place.x)).toBeLessThan(2);
    });
  }

  it('moves by one row height when a row is added above', () => {
    const root = table();
    const cell = root.querySelectorAll('td')[4]!.firstChild as HTMLElement;
    const r = cell.getBoundingClientRect();
    const place = placeAt(document, r.left + 4, r.top + 4)!;
    const grid = root.querySelector('table')!;
    const added = grid.insertRow(1);
    for (let i = 0; i < 3; i++) {
      const empty = added.insertCell();
      empty.style.cssText = 'padding:15px 40px;border:1px solid;height:20px';
    }
    const rowHeight = added.getBoundingClientRect().height;
    const now = placeNow(root, place)!;
    expect(now.y - place.y).toBeCloseTo(rowHeight, 0);
    expect(now.x).toBeCloseTo(place.x, 0);
  });
});
