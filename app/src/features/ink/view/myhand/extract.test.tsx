// Uploads in a real browser: a PDF whose ink is vector outlines (as OneNote exports it) and a photo of writing both
// become symbols, a file that is not one fails calmly, and confirmed symbols join the style. The PDF and the picture
// are made here; no real person's writing is used.
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { resetFakeShell } from '../../../../platform/shellqol';
import { syntheticProgress } from '../../myhand/fixtures';
import { MAX_UPLOAD_BYTES, UploadFailure, readUpload } from './extract';
import type { UploadRead } from './extract';
import { finishCalibration, loadStyle, resetStyleForTests, setProgressForTests, styleState } from './store';
import { showUploads } from './Uploads';

vi.mock('./extract', async (original) => ({
  ...(await original<typeof import('./extract')>()),
  // The test reads no handwriting: the person types every symbol, as they do when reading is off.
  readSymbol: async () => 'off',
}));

beforeEach(() => {
  resetFakeShell();
  resetStyleForTests();
});

/** The outline a round pen leaves along a path, as a PDF fill, starting where the pen started. */
function outline(path: [number, number][], width: number): string {
  const r = width / 2;
  const left: string[] = [];
  const right: string[] = [];
  path.forEach(([x, y], i) => {
    const [ax, ay] = path[Math.max(0, i - 1)];
    const [bx, by] = path[Math.min(path.length - 1, i + 1)];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const [nx, ny] = [-(by - ay) / len, (bx - ax) / len];
    left.push(`${(x + nx * r).toFixed(2)} ${(y + ny * r).toFixed(2)}`);
    right.unshift(`${(x - nx * r).toFixed(2)} ${(y - ny * r).toFixed(2)}`);
  });
  const [first, ...rest] = [...left, ...right];
  return `${first} m ${rest.map((p) => `${p} l`).join(' ')} h f`;
}

/** A one-page PDF: a ruled line drawn as a stroke, and handwriting drawn as filled outlines on each line given. */
function vectorPdf(lines: readonly number[] = [700]): Uint8Array<ArrayBuffer> {
  const strokes: [number, number][][] = [];
  // Three upright marks and an arc on each line (PDF y runs up).
  for (const y of lines) {
    for (let k = 0; k < 3; k++) strokes.push(Array.from({ length: 12 }, (_, i) => [100 + k * 20, y + i]));
    strokes.push(
      Array.from({ length: 16 }, (_, i) => [
        170 + Math.cos((i / 15) * Math.PI) * 6,
        y + 5 + Math.sin((i / 15) * Math.PI) * 6,
      ]),
    );
  }
  const content = ['0.5 w 0 750 m 612 750 l S', ...strokes.map((s) => outline(s, 0.9))].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let text = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(text.length);
    text += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const at of offsets) text += `${String(at).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

async function photo(): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 200;
  const ctx = canvas.getContext('2d')!;
  // Dark ink on a see-through page, which reads as paper.
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(60, 60);
  ctx.lineTo(60, 140);
  ctx.moveTo(140, 140);
  ctx.lineTo(170, 60);
  ctx.lineTo(200, 140);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(290, 100, 35, 0, Math.PI * 2);
  ctx.stroke();
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  return new File([blob], 'photo.png', { type: 'image/png' });
}

describe('reading uploads', () => {
  it('reads a PDF’s vector ink from its drawing, leaving out the paper’s rules', async () => {
    const read = await readUpload(new File([vectorPdf()], 'sheet.pdf', { type: 'application/pdf' }));
    expect(read.lines).toBe(1);
    expect(read.symbols.length).toBeGreaterThanOrEqual(3);
    // No symbol spans the page as the ruled line does.
    for (const symbol of read.symbols) expect(symbol.rect.x1 - symbol.rect.x0).toBeLessThan(40);
    // Page coordinates run down from the top: the writing is near the top of a letter page.
    expect(read.symbols[0].rect.y1).toBeLessThan(100);
  });

  it('traces a photo of writing', async () => {
    const read = await readUpload(await photo());
    expect(read.symbols.length).toBeGreaterThanOrEqual(2);
  });

  it('fails calmly on a file that is not a picture or a PDF, or is too big', async () => {
    await expect(readUpload(new File([new Uint8Array([1, 2, 3, 4, 5, 6])], 'x.pdf'))).rejects.toBeInstanceOf(
      UploadFailure,
    );
    const big = new File([new Uint8Array(MAX_UPLOAD_BYTES + 1)], 'big.png', { type: 'image/png' });
    await expect(readUpload(big)).rejects.toMatchObject({ code: 'tooBig' });
    const damaged = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 9, 9, 9])], 'broken.pdf');
    await expect(readUpload(damaged)).rejects.toMatchObject({ code: 'unreadable' });
  });

  it('refuses a small picture that claims to be huge, before decoding it', async () => {
    const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(13), 0x49, 0x48, 0x44, 0x52];
    const png = new Uint8Array([...header, ...be32(15000), ...be32(15000), 8, 6, 0, 0, 0]);
    await expect(readUpload(new File([png], 'huge.png', { type: 'image/png' }))).rejects.toMatchObject({
      code: 'tooManyPixels',
    });
  });

  it('stops at a whole line when the symbol cap is reached, says where, and reads on from there', async () => {
    const file = new File([vectorPdf([700, 600])], 'two.pdf', { type: 'application/pdf' });
    const whole = await readUpload(file);
    expect(whole.lines).toBe(2);
    expect(whole.next).toBeUndefined();
    const perLine = whole.symbols.filter((s) => s.line === 0).length;
    const first: UploadRead = await readUpload(file, undefined, { maxSymbols: perLine + 1 });
    expect(first.symbols).toHaveLength(perLine);
    expect(first.next).toEqual({ page: 1, line: 1 });
    expect(first.pages).toEqual({ first: 1, last: 1, total: 1 });
    expect(first.dropped).toBe(0);
    const rest = await readUpload(file, undefined, { start: first.next, maxSymbols: perLine + 1 });
    expect(rest.next).toBeUndefined();
    expect(first.symbols.length + rest.symbols.length).toBe(whole.symbols.length);
  });

  it('stops when the person cancels', async () => {
    const stop = new AbortController();
    stop.abort();
    const file = new File([vectorPdf()], 'sheet.pdf', { type: 'application/pdf' });
    await expect(readUpload(file, undefined, { signal: stop.signal })).rejects.toMatchObject({ code: 'stopped' });
  });
});

describe('confirming symbols', () => {
  it('adds the symbols the person named to the style, and leaves the skipped ones out', async () => {
    await loadStyle();
    await setProgressForTests(syntheticProgress());
    await finishCalibration();
    const closed = showUploads([new File([vectorPdf()], 'sheet.pdf', { type: 'application/pdf' })], false);
    const dialog = await screen.findByRole('dialog', { name: 'Confirm your symbols' });
    const fields = await within(dialog).findAllByRole('textbox', { name: 'What this symbol is' });
    expect(fields.length).toBeGreaterThanOrEqual(3);
    await userEvent.fill(fields[0], 'l');
    await userEvent.fill(fields[1], 'l');
    await userEvent.fill(fields[2], '∫');
    const skips = within(dialog).getAllByRole('button', { name: 'Skip' });
    for (const skip of skips.slice(3)) await userEvent.click(skip);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add 3 symbols' }));
    await closed;
    await waitFor(() => expect(styleState.get().doc.style?.glyphs['∫']?.some((g) => g.source === 'upload')).toBe(true));
    const glyphs = styleState.get().doc.style!.glyphs;
    expect(glyphs.l.filter((g) => g.source === 'upload')).toHaveLength(2);
    expect(glyphs.l.filter((g) => g.source === 'pen')).toHaveLength(3);
    // Nothing was kept: the file was only read.
    expect(styleState.get().doc.kept).toEqual([]);
  });
});
