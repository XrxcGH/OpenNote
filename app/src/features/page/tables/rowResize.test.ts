// @vitest-environment jsdom
// Row edges lay out once: layout is read for every row, then every position is written.
import { describe, expect, it } from 'vitest';
import { attachRowHandles } from './rowResize';
import type { PageViewportApi } from '../viewport/viewport';

function tableHost(rows: number): HTMLElement {
  const host = document.createElement('div');
  const table = host.appendChild(document.createElement('table'));
  for (let i = 0; i < rows; i++) table.insertRow().insertCell().textContent = String(i);
  document.body.append(host);
  return host;
}

describe('attachRowHandles', () => {
  it('reads every row before it writes any edge, so the cost grows with the row count', () => {
    const host = tableHost(500);
    let reads = 0;
    let readAfterWrite = 0;
    for (const row of Array.from(host.querySelectorAll('tr'))) {
      row.getBoundingClientRect = () => {
        reads++;
        // An edge already placed means a write came before this read.
        if (host.querySelector<HTMLElement>('[data-row]')?.style.insetBlockStart) readAfterWrite++;
        return new DOMRect(0, 0, 10, 20);
      };
    }
    const stop = attachRowHandles(host, {} as PageViewportApi, () => {});
    const edges = Array.from(host.querySelectorAll<HTMLElement>('[data-row]'));
    expect(edges).toHaveLength(500);
    expect(edges.every((edge) => edge.style.insetBlockStart !== '')).toBe(true);
    expect(reads).toBeGreaterThanOrEqual(500);
    expect(readAfterWrite).toBe(0);
    stop();
  });
});
