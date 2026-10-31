// A clustered heat map: the data matrix drawn as colored cells, with its rows and its columns each put in the order
// of a dendrogram, so rows (and columns) that are alike sit side by side. The columns can be standardized first,
// which makes each cell a z-score and keeps a column in large units from swamping the colors.
import { transpose, type Matrix } from '../kit/linalg';
import { escapeXml, text as svgText, svg, W, type DrawContext } from '../kit/picture';
import { agglomerate, distanceMatrix, leafOrder, type Linkage, type Merge, type Metric } from './cluster';
import { checkMatrix, covariance } from './engine';

export interface HeatMap {
  /** The cells as drawn: z-scores of each column, or the values as measured. */
  readonly values: Matrix;
  readonly rowOrder: number[];
  readonly colOrder: number[];
  readonly rowMerges: Merge[];
  readonly colMerges: Merge[];
  /** The value drawn as neither color, and the distance from it to the strongest color. */
  readonly mid: number;
  readonly half: number;
}

export function clusteredHeatMap(x: Matrix, linkage: Linkage, metric: Metric, standardize: boolean): HeatMap {
  checkMatrix(x, 2);
  let values = x.map((row) => [...row]);
  if (standardize) {
    const { means, sds } = covariance(x, false);
    values = x.map((row) => row.map((v, j) => (v - means[j]) / sds[j]));
  }
  const rowMerges = agglomerate(distanceMatrix(values, metric), linkage);
  const colMerges = agglomerate(distanceMatrix(transpose(values), metric), linkage);
  const all = values.flat();
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  // A z-score is centered on 0; values as measured are centered on the middle of their range.
  const mid = standardize ? 0 : (lo + hi) / 2;
  const half = Math.max(Math.abs(hi - mid), Math.abs(lo - mid)) || 1;
  return {
    values,
    rowOrder: leafOrder(rowMerges, x.length),
    colOrder: leafOrder(colMerges, x[0].length),
    rowMerges,
    colMerges,
    mid,
    half,
  };
}

/** How strongly a cell is colored, from −1 (all low color) to 1 (all high color). */
export const shade = (map: HeatMap, v: number): number => Math.max(-1, Math.min(1, (v - map.mid) / map.half));

/**
 * Draws the heat map. High values take the first pen and low ones the second, more opaque the farther from the
 * middle; each cell also shows its value when there is room, so the colors are never the only way to read it.
 */
export function heatMapDrawing(map: HeatMap, rowNames: readonly string[], colNames: readonly string[]) {
  return (ctx: DrawContext): string => {
    const p = ctx.palette;
    const say = (id: string) => ctx.say(`${ctx.prefix}.plot.${id}`);
    const nr = map.rowOrder.length;
    const nc = map.colOrder.length;
    const left = 96;
    const top = 64;
    const cellW = Math.max(8, Math.min(56, (W - left - 16) / nc));
    const cellH = Math.max(6, Math.min(24, 420 / nr));
    const height = top + nr * cellH + 56;
    const room = cellW >= 30 && cellH >= 14;
    const parts = [`<rect width="${W}" height="${height}" fill="${p.surface}"/>`];
    map.colOrder.forEach((c, j) => {
      const x = left + (j + 0.5) * cellW;
      parts.push(
        `<g transform="translate(${x.toFixed(1)} ${top - 6}) rotate(-50)">` +
          `${svgText(0, 0, colNames[c], p.text, 'start', 11)}</g>`,
      );
    });
    map.rowOrder.forEach((r, i) => {
      const y = top + i * cellH;
      if (cellH >= 9) parts.push(svgText(left - 6, y + cellH / 2 + 4, rowNames[r], p.text, 'end', 11));
      map.colOrder.forEach((c, j) => {
        const v = map.values[r][c];
        const t = shade(map, v);
        const color = t >= 0 ? p.pens[0] : p.pens[1];
        const x = left + j * cellW;
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cellW.toFixed(1)}" height="${cellH.toFixed(1)}" ` +
            `fill="${escapeXml(color)}" fill-opacity="${(0.08 + 0.8 * Math.abs(t)).toFixed(2)}" ` +
            `stroke="${escapeXml(p.surface)}"/>`,
        );
        if (room) {
          const ink = Math.abs(t) > 0.55 ? p.surface : p.text;
          parts.push(svgText(x + cellW / 2, y + cellH / 2 + 4, v.toFixed(1), ink, 'middle', 10));
        }
      });
    });
    const keyY = top + nr * cellH + 24;
    const keyW = 160;
    const keyX = left;
    for (let s = 0; s < 16; s++) {
      const t = -1 + (2 * (s + 0.5)) / 16;
      parts.push(
        `<rect x="${(keyX + (s * keyW) / 16).toFixed(1)}" y="${keyY}" width="${(keyW / 16).toFixed(1)}" height="10" ` +
          `fill="${escapeXml(t >= 0 ? p.pens[0] : p.pens[1])}" fill-opacity="${(0.08 + 0.8 * Math.abs(t)).toFixed(2)}"/>`,
      );
    }
    parts.push(
      svgText(keyX, keyY + 24, `${say('low')} ${(map.mid - map.half).toPrecision(3)}`, p.muted, 'start', 10),
      svgText(keyX + keyW, keyY + 24, `${say('high')} ${(map.mid + map.half).toPrecision(3)}`, p.muted, 'end', 10),
    );
    return svg(parts, p, W, height);
  };
}
