// The state diagram of a chain as SVG text: the states on a circle, an arrow for each nonzero transition with its
// probability or rate, and a loop for a state that stays put. Arrows between two states bend to opposite sides, so
// both directions stay readable.
import { colorOf, escapeXml, type DrawWords, type Palette } from '../ui/plot';

const W = 520;
const H = 340;

export interface DiagramInput {
  readonly title: string;
  readonly names: readonly string[];
  /** Labels by row and column; an empty label draws no arrow. The diagonal is a self-loop. */
  readonly labels: readonly (readonly string[])[];
  /** States drawn with a double ring (absorbing). */
  readonly marked?: readonly number[];
}

const n2 = (v: number) => (Math.round(v * 10) / 10).toString();

export function stateDiagram(input: DiagramInput, palette: Palette, words: DrawWords): string {
  const n = input.names.length;
  const cx = W / 2;
  const cy = H / 2 + 8;
  const radius = n === 1 ? 0 : Math.min(130, 40 + n * 12);
  const node = 16;
  const at = (i: number) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a), a] as const;
  };
  const title = words.plot(input.title);
  const pen = colorOf(palette, 0);
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" ` +
      `aria-label="${escapeXml(title)}" font-family="${escapeXml(palette.font)}" font-size="11">`,
    `<title>${escapeXml(title)}</title>`,
    `<rect width="${W}" height="${H}" fill="${palette.surface}"/>`,
    `<defs><marker id="state-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" ` +
      `orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="${pen}"/></marker></defs>`,
    `<text x="12" y="18" fill="${palette.text}" font-weight="600">${escapeXml(title)}</text>`,
  ];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const label = input.labels[i]?.[j] ?? '';
      if (!label) continue;
      const [x1, y1, a] = at(i);
      if (i === j) {
        // A loop on the outside of the circle.
        const lx = x1 + Math.cos(a) * (node + 12);
        const ly = y1 + Math.sin(a) * (node + 12);
        out.push(
          `<circle cx="${n2(lx)}" cy="${n2(ly)}" r="12" fill="none" stroke="${pen}" stroke-width="1.5"/>`,
          `<text x="${n2(lx + Math.cos(a) * 20)}" y="${n2(ly + Math.sin(a) * 20 + 4)}" text-anchor="middle" ` +
            `fill="${palette.text}">${escapeXml(label)}</text>`,
        );
        continue;
      }
      const [x2, y2] = at(j);
      const dx = x2 - x1;
      const dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      // Bend to the left of the direction of travel, so i→j and j→i part.
      const bend = 22;
      const mx = (x1 + x2) / 2 - uy * bend;
      const my = (y1 + y2) / 2 + ux * bend;
      const sx = x1 + ux * node;
      const sy = y1 + uy * node;
      const ex = x2 - ux * (node + 2);
      const ey = y2 - uy * (node + 2);
      out.push(
        `<path d="M${n2(sx)} ${n2(sy)}Q${n2(mx)} ${n2(my)} ${n2(ex)} ${n2(ey)}" fill="none" stroke="${pen}" ` +
          `stroke-width="1.5" marker-end="url(#state-arrow)"/>`,
        `<text x="${n2((sx + 2 * mx + ex) / 4 - uy * 8)}" y="${n2((sy + 2 * my + ey) / 4 + ux * 8 + 4)}" ` +
          `text-anchor="middle" fill="${palette.text}">${escapeXml(label)}</text>`,
      );
    }
  }
  input.names.forEach((name, i) => {
    const [x, y] = at(i);
    const ring = input.marked?.includes(i)
      ? `<circle cx="${n2(x)}" cy="${n2(y)}" r="${node - 4}" fill="none" stroke="${palette.text}"/>`
      : '';
    out.push(
      `<circle cx="${n2(x)}" cy="${n2(y)}" r="${node}" fill="${palette.surface}" stroke="${palette.text}" stroke-width="1.5"/>`,
      ring,
      `<text x="${n2(x)}" y="${n2(y + 4)}" text-anchor="middle" fill="${palette.text}">${escapeXml(name)}</text>`,
    );
  });
  out.push('</svg>');
  return out.join('');
}
