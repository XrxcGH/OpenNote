// What a pen's own choices do to its strokes: the pressure table from its curve and thinnest line, and the steady pen. A
// pen with no choices made draws as it always did, so nothing changes until the person opens the settings.
import { isEnabled } from '../../../app/flags';
import { buildPressureTable } from '../geometry/pressure';
import { inkPrefs, penDevice } from './prefs';

/** The pen's own pressure table and steady pen, once the person has chosen them. Without a choice, none. */
const tables = new Map<string, Float32Array>();

export function penFeel(
  pen: string,
  zoom: number,
): { pressureTable?: Float32Array; steady?: { strength: number; zoom: number } } {
  if (!isEnabled('ink.steadyPen')) return {};
  const prefs = inkPrefs.get();
  if (!prefs.pens[pen] && !prefs.pens.default) return {};
  const device = penDevice(pen, prefs);
  const key = JSON.stringify([device.curve, device.customCurve, device.minWidth]);
  let table = tables.get(key);
  if (!table) {
    const c = device.customCurve;
    table = buildPressureTable({
      curve: device.curve,
      custom: c ? { x1: c[0], y1: c[1], x2: c[2], y2: c[3] } : undefined,
      minimum: device.minWidth,
    });
    tables.set(key, table);
  }
  return { pressureTable: table, ...(device.steady > 0 ? { steady: { strength: device.steady, zoom } } : {}) };
}
