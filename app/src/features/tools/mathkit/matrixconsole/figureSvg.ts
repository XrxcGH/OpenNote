// checks-disable-file brand-consistency: a picture made to leave the app has fixed colors, since a style variable does not reach an image
// A figure drawn as a standalone SVG picture, for putting into a page, and that picture drawn into a PNG.
import type { Figure } from './ctx';

const PENS = ['#3b5b92', '#b7791f', '#4a7c59', '#a4403a', '#7a4f8a', '#6b5a43'];
const W = 480;
const H = 320;

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const tick = (v: number, log: boolean) => (log ? `1e${Math.round(v)}` : String(Number(v.toPrecision(3))));

/** The figure as SVG text, with a title and a description for readers who cannot see it. */
export function figureSvg(fig: Figure, description: string): string {
  const padL = 52;
  const padR = 16;
  const padT = fig.title ? 30 : 14;
  const padB = fig.xlabel ? 46 : 30;
  const fx = (v: number) => (fig.logx ? Math.log10(Math.max(v, 1e-300)) : v);
  const fy = (v: number) => (fig.logy ? Math.log10(Math.max(v, 1e-300)) : v);
  const pts = fig.series
    .flatMap((s) => s.x.map((x, i): [number, number] => [fx(x), fy(s.y[i])]))
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  if (pts.length === 0) return '';
  let [x0, x1] = [Math.min(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[0]))];
  let [y0, y1] = [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))];
  if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
  if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
  const px = (x: number) => padL + ((fx(x) - x0) / (x1 - x0)) * (W - padL - padR);
  const py = (y: number) => H - padB - ((fy(y) - y0) / (y1 - y0)) * (H - padT - padB);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(description)}">`,
    `<title>${esc(fig.title || description)}</title>`,
    `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
    `<rect x="${padL}" y="${padT}" width="${W - padL - padR}" height="${H - padT - padB}" fill="none" stroke="#c9c2b6"/>`,
    `<g font-family="sans-serif" font-size="11" fill="#5b5448">`,
    `<text x="${padL}" y="${H - padB + 14}">${tick(x0, fig.logx)}</text>`,
    `<text x="${W - padR}" y="${H - padB + 14}" text-anchor="end">${tick(x1, fig.logx)}</text>`,
    `<text x="${padL - 4}" y="${H - padB}" text-anchor="end">${tick(y0, fig.logy)}</text>`,
    `<text x="${padL - 4}" y="${padT + 8}" text-anchor="end">${tick(y1, fig.logy)}</text>`,
  ];
  if (fig.title)
    parts.push(`<text x="${W / 2}" y="18" text-anchor="middle" font-size="14" fill="#2a261f">${esc(fig.title)}</text>`);
  if (fig.xlabel)
    parts.push(`<text x="${(padL + W - padR) / 2}" y="${H - 8}" text-anchor="middle">${esc(fig.xlabel)}</text>`);
  if (fig.ylabel)
    parts.push(
      `<text transform="translate(12 ${(padT + H - padB) / 2}) rotate(-90)" text-anchor="middle">${esc(fig.ylabel)}</text>`,
    );
  parts.push('</g>');
  fig.series.forEach((s, k) => {
    const color = PENS[k % PENS.length];
    const good = s.x
      .map((x, i): [number, number] => [x, s.y[i]])
      .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
    if (s.dots)
      good.forEach(([x, y]) =>
        parts.push(`<circle cx="${px(x).toFixed(1)}" cy="${py(y).toFixed(1)}" r="3" fill="${color}"/>`),
      );
    else {
      const path = good.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(' ');
      parts.push(`<polyline fill="none" stroke="${color}" stroke-width="1.8" points="${path}"/>`);
    }
  });
  parts.push('</svg>');
  return parts.join('');
}

/** An SVG string drawn into a PNG at twice its size. Needs a browser page. */
export async function svgToPngBytes(svg: string): Promise<ArrayBuffer> {
  const image = new Image();
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('The picture could not be drawn.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = W * 2;
  canvas.height = H * 2;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('No canvas to draw on.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The picture could not be saved.');
  return blob.arrayBuffer();
}
