// The geometry of an economics graph, shared by the on-screen Plot and the SVG that Insert graph stores.
import type { PlotProps } from './Plot';

export const W = 360;
export const H = 240;
export const PAD = { left: 44, right: 14, top: 12, bottom: 34 };

function ticks(lo: number, hi: number, count = 4): number[] {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step)
    out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

export function layoutPlot({ curves, areas = [], marks = [] }: PlotProps) {
  const all = [
    ...curves.flatMap((c) => c.points),
    ...areas.flatMap((a) => a.points),
    ...marks.map((m) => [m.x, m.y] as const),
  ];
  const xLow = Math.min(0, ...all.map((p) => p[0]));
  const yLow = Math.min(0, ...all.map((p) => p[1]));
  const xHigh = Math.max(...all.map((p) => p[0]), xLow + 1e-9);
  const yHigh = Math.max(...all.map((p) => p[1]), yLow + 1e-9);
  const xt = ticks(xLow, xHigh);
  const yt = ticks(yLow, yHigh);
  const x0 = Math.min(xLow, xt[0]);
  const y0 = Math.min(yLow, yt[0]);
  const x1 = Math.max(xHigh, xt[xt.length - 1]);
  const y1 = Math.max(yHigh, yt[yt.length - 1]);
  const sx = (x: number) => PAD.left + ((x - x0) / (x1 - x0)) * (W - PAD.left - PAD.right);
  const sy = (y: number) => H - PAD.bottom - ((y - y0) / (y1 - y0)) * (H - PAD.top - PAD.bottom);
  const path = (pts: readonly (readonly [number, number])[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p[0]).toFixed(1)} ${sy(p[1]).toFixed(1)}`).join(' ');
  return { xt, yt, sx, sy, path };
}
