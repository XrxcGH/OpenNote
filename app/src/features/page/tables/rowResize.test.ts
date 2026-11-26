// @vitest-environment jsdom
// The row edge is one element, so a table with thousands of rows costs nothing to attach, and it finds its row by a
// search, not by a scan.
import { describe, expect, it } from 'vitest';
import { attachRowHandles } from './rowResize';
import type { PageViewportApi } from '../viewport/viewport';

function tableHost(rows: number): { host: HTMLElement; rects: () => number } {
  const host = document.createElement('div');
  const table = host.appendChild(document.createElement('table'));
  let reads = 0;
  for (let i = 0; i < rows; i++) {
    const row = table.insertRow();
    row.insertCell().textContent = String(i);
    row.getBoundingClientRect = () => {
      reads++;
      return new DOMRect(0, i * 20, 100, 20);
    };
  }
  host.getBoundingClientRect = () => new DOMRect(0, 0, 100, 20 * rows);
  document.body.append(host);
  return { host, rects: () => reads };
}

const move = (host: HTMLElement, x: number, y: number) =>
  host.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse', bubbles: true }));

describe('attachRowHandles', () => {
  it('adds one edge and reads no row when it attaches to 5000 rows', () => {
    const { host, rects } = tableHost(5000);
    const stop = attachRowHandles(host, {} as PageViewportApi, () => {});
    expect(host.querySelectorAll('[data-row]')).toHaveLength(1);
    expect(rects()).toBe(0);
    stop();
    expect(host.querySelectorAll('[data-row]')).toHaveLength(0);
  });

  it('puts the edge on the rule under the pointer after a short search', () => {
    const { host, rects } = tableHost(5000);
    const stop = attachRowHandles(host, {} as PageViewportApi, () => {});
    const edge = host.querySelector<HTMLElement>('[data-row]')!;
    move(host, 2, 20 * 1234 + 20 + 2);
    expect(edge.hidden).toBe(false);
    expect(edge.dataset.row).toBe('1234');
    expect(rects()).toBeLessThan(60);
    move(host, 2, 20 * 1234 + 10);
    expect(edge.hidden).toBe(true);
    move(host, 50, 20 * 1234 + 20);
    expect(edge.hidden).toBe(true);
    stop();
  });

  it('fits the table row, not the drawn row, in a virtual table', () => {
    // Only rows 6000 to 6099 are drawn; each carries its row in aria-rowindex, counted from 1.
    const { host } = tableHost(100);
    host.querySelectorAll('tr').forEach((tr, i) => tr.setAttribute('aria-rowindex', String(6001 + i)));
    const fitted: number[] = [];
    const stop = attachRowHandles(
      host,
      {} as PageViewportApi,
      () => {},
      (row) => fitted.push(row),
    );
    move(host, 2, 20 * 10 + 20);
    expect(host.querySelector<HTMLElement>('[data-row]')!.dataset.row).toBe('6010');
    host.dispatchEvent(new MouseEvent('dblclick', { clientX: 2, clientY: 20 * 10 + 20, bubbles: true }));
    expect(fitted).toEqual([6010]);
    stop();
  });
});
