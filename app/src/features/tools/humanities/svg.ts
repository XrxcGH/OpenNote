// checks-disable-file brand-consistency: colors written into exported pictures, which keep paper colors in any theme
// What the kit's pictures share: the paper colors they are drawn in, escaping, and a rough text width. A picture goes
// on the page as an image and prints, so it keeps the light paper colors whatever the app theme is.

export const PAPER = {
  background: '#fbf8f2',
  text: '#1f2a37',
  muted: '#5b6573',
  line: '#8c7f70',
  grid: '#d9d0c3',
  accent: '#2f5d62',
  accentSoft: '#cfe0dd',
  warm: '#a4553a',
  warmSoft: '#f0d9cc',
} as const;

/** Colors told apart with any common color-vision difference (the Okabe and Ito set), for tracks and classes. */
export const SERIES = ['#0072b2', '#e69f00', '#009e73', '#cc79a7', '#56b4e9', '#d55e00', '#f0e442', '#000000'] as const;

/** Five steps from light to dark, readable with any common color-vision difference, for classed maps. */
export const SEQUENTIAL = ['#fde725', '#5ec962', '#21918c', '#3b528b', '#440154'] as const;

export const FONT = 'Segoe UI, system-ui, sans-serif';

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** About how wide text is at this size: 0.56 em a character, which suits the interface font. */
export const textWidth = (text: string, size: number): number => [...text].length * size * 0.56;

/** Rounds to 0.01 so the picture's text stays short. */
export const r2 = (value: number): string => (Math.round(value * 100) / 100).toString();

/** An SVG document of this size with a paper background around the body. */
export function svgDocument(width: number, height: number, body: string, title: string): string {
  const w = r2(width);
  const h = r2(height);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">` +
    `<title>${escapeXml(title)}</title><rect width="${w}" height="${h}" fill="${PAPER.background}"/>${body}</svg>`
  );
}

export function svgText(x: number, y: number, text: string, size = 12, extra = ''): string {
  return (
    `<text x="${r2(x)}" y="${r2(y)}" font-family="${FONT}" font-size="${size}" fill="${PAPER.text}"${extra}>` +
    `${escapeXml(text)}</text>`
  );
}
