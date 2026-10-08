import { describe, expect, it, vi } from 'vitest';
import type { ExportsClient } from '../../../platform/types';
import { createPrintSurface } from './exporter';

function client() {
  const printRender = vi.fn<ExportsClient['printRender']>(async () => new Uint8Array([37, 80, 68, 70]));
  const stub = {
    printPrepare: async () => ({ plan: { box: { width: 816, height: 1056 } } }),
    printRender,
    printClose: async () => undefined,
  } as unknown as ExportsClient;
  return { stub, printRender };
}

describe('the print surface', () => {
  it('asks the host for tags and bookmarks when the export is accessible', async () => {
    const { stub, printRender } = client();
    const surface = createPrintSurface(stub, 'j1');
    await surface.prepare({} as never);
    await surface.toPdf({ tagged: true, outline: true, background: false });
    expect(printRender).toHaveBeenCalledWith('j1', { width: 8.5, height: 11 }, false, { tagged: true, outline: true });
  });

  it('asks for neither when the export is plain', async () => {
    const { stub, printRender } = client();
    const surface = createPrintSurface(stub, 'j2');
    await surface.prepare({} as never);
    await surface.toPdf({ tagged: false, outline: false, background: true });
    expect(printRender.mock.calls[0][3]).toEqual({ tagged: false, outline: false });
  });

  it('refuses to print before the page is prepared', async () => {
    const { stub } = client();
    await expect(
      createPrintSurface(stub, 'j3').toPdf({ tagged: true, outline: true, background: true }),
    ).rejects.toThrow(/Prepare/);
  });
});
