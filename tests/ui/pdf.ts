// A small PDF for the PDF tests, written out here so no binary file sits in the repository: US Letter pages with one
// line of Helvetica text each, and an exact cross-reference table.
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { runCommand } from './intel';

export function tinyPdf(lines: readonly string[]): Buffer {
  const objects: string[] = [];
  const kids = lines.map((_, i) => `${4 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${lines.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  lines.forEach((line, i) => {
    const stream = `BT /F1 24 Tf 72 700 Td (${line.replace(/[()\\]/g, '')}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Inserts a PDF into the shown page through Insert PDF, and waits for its first page picture. */
export async function insertPdf(page: Page, name: string, lines: readonly string[]): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await runCommand(page, 'Insert PDF');
  await (await chooser).setFiles({ name, mimeType: 'application/pdf', buffer: tinyPdf(lines) });
  await expect(page.getByRole('group', { name: new RegExp(`Page 1 of ${lines.length} from ${name}`) })).toBeVisible({
    timeout: 30_000,
  });
}
