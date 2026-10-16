// A stroke drawn with a pen's pressure curve: pressure rises along the stroke and falls again, and each dot is as wide
// as the curve makes it, so a person sees what soft, firm, or a custom curve does before writing with it.
import type { PenDevice } from '../../../platform/bindings/PenDevice';
import { buildPressureTable, mapPressure } from '../geometry/pressure';

const POINTS = 48;
const WIDTH = 240;
const HEIGHT = 56;
const MAX_RADIUS = 9;

/** The width of each dot of the preview, from the pen's curve and thinnest line. */
export function previewRadii(pen: Pick<PenDevice, 'curve' | 'customCurve' | 'minWidth'>): number[] {
  const c = pen.customCurve;
  const table = buildPressureTable({
    curve: pen.curve,
    custom: c ? { x1: c[0], y1: c[1], x2: c[2], y2: c[3] } : undefined,
    minimum: pen.minWidth,
  });
  return Array.from({ length: POINTS }, (_, i) => {
    const pressure = Math.sin((i / (POINTS - 1)) * Math.PI);
    return 1 + (MAX_RADIUS - 1) * mapPressure(table, pressure);
  });
}

export function CurvePreview({ pen, label }: { pen: PenDevice; label: string }) {
  const radii = previewRadii(pen);
  return (
    <svg role="img" aria-label={label} width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`}>
      {radii.map((r, i) => {
        const along = i / (POINTS - 1);
        const x = 12 + along * (WIDTH - 24);
        const y = HEIGHT / 2 + Math.sin(along * Math.PI * 2) * 12;
        return <circle key={i} cx={x} cy={y} r={r / 2} fill="var(--color-text-primary)" />;
      })}
    </svg>
  );
}
