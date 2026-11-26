// A two-page lecture handout as a PDF, written out here so no binary file sits in the repository: US Letter pages, each
// with a title and a few lines of Helvetica text, and an exact cross-reference table.

interface HandoutPage {
  title: string;
  lines: readonly string[];
}

const escape = (text: string) => text.replace(/[()\\]/g, '');

export function lecturePdf(pages: readonly HandoutPage[]): Buffer {
  const objects: string[] = [];
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  for (const [i, page] of pages.entries()) {
    const body = page.lines.map((line) => `0 -34 Td (${escape(line)}) Tj`).join(' ');
    const stream = `BT /F2 26 Tf 72 690 Td (${escape(page.title)}) Tj /F1 16 Tf 0 -10 Td ${body} ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${6 + i * 2} 0 R /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const [i, body] of objects.entries()) {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export const HANDOUT = [
  {
    title: 'Lecture 4: Membranes',
    lines: [
      'The plasma membrane is a phospholipid bilayer.',
      'Proteins float in it like a fluid mosaic.',
      'Small molecules cross by simple diffusion.',
      'Water crosses by osmosis.',
    ],
  },
  {
    title: 'Active transport',
    lines: [
      'Pumps use ATP to move ions against a gradient.',
      'The sodium-potassium pump moves 3 Na out',
      'and 2 K in for every ATP.',
    ],
  },
] as const;
