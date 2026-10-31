// The light and media modes of the camera tool: light level and distance, beam width, key to fill ratio, color
// temperature and gels, and media storage.
import { fail, fixed, fmt, ok, positive } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import {
  LUX_PER_FOOTCANDLE,
  audioBitRate,
  beamDiameter,
  inverseSquare,
  mired,
  miredShift,
  ratioStops,
  storageBytes,
  videoBitRate,
} from './engine';

export function inverse(v: Values): KitOk {
  const e0 = positive(v, 'lux0', 'camLevel');
  const unit = v.units === 'ft' ? 'ft' : 'm';
  const d1 = positive(v, 'd1', 'camFromDistance');
  const d2 = positive(v, 'd2', 'camToDistance');
  const e1 = inverseSquare(e0, d1, d2);
  const asLux = unit === 'ft' ? e1 * LUX_PER_FOOTCANDLE : e1;
  const asFc = unit === 'ft' ? e1 : e1 / LUX_PER_FOOTCANDLE;
  const stops = Math.log2(e0 / e1);
  const rows: KitRow[] = [
    { key: 'newLevel', value: `${fmt(e1, 4)} ${unit === 'ft' ? 'fc' : 'lux'}` },
    { key: 'levelFc', value: `${fmt(asFc, 4)} fc` },
    { key: 'levelLux', value: `${fmt(asLux, 4)} lux` },
    { key: 'stopsChange', value: fixed(-stops, 2) },
  ];
  const steps: KitStep[] = [
    { key: 'lightInverse', vars: { e0: fmt(e0), d1: fmt(d1), d2: fmt(d2), e1: fmt(e1, 4) } },
    { key: 'lightStops', vars: { stops: fixed(stops, 2) } },
    { key: 'lightLux', vars: { fc: fmt(asFc, 4), lux: fmt(asLux, 4) } },
  ];
  return ok({
    rows,
    steps,
    answer: `${fmt(e0)} at ${fmt(d1)} ${unit} becomes ${fmt(e1, 4)} at ${fmt(d2)} ${unit} (${fixed(-stops, 2)} stops)`,
    notes: ['camNoteInverse'],
  });
}

export function beam(v: Values): KitOk {
  const unit = v.units === 'ft' ? 'ft' : 'm';
  const d = positive(v, 'throw', 'camThrow');
  const spread = positive(v, 'spread', 'camSpread');
  if (spread >= 180) fail('camSpreadRange');
  const w = beamDiameter(d, spread);
  return ok({
    rows: [{ key: 'beamDiameter', value: `${fmt(w, 4)} ${unit}` }],
    steps: [{ key: 'beamWidth', vars: { d: fmt(d), a: fmt(spread), w: `${fmt(w, 4)} ${unit}` } }],
    answer: `A ${fmt(spread)}° beam is ${fmt(w, 4)} ${unit} wide at ${fmt(d)} ${unit}`,
    notes: ['camNoteBeam'],
  });
}

export function ratio(v: Values): KitOk {
  const key = positive(v, 'key', 'camKey');
  const fill = positive(v, 'fill', 'camFill');
  if (fill > key) fail('camFillBright');
  const stops = ratioStops(key, fill);
  return ok({
    rows: [
      { key: 'lightRatio', value: `${fmt(key / fill, 4)} : 1` },
      { key: 'ratioStops', value: fixed(stops, 2) },
    ],
    steps: [
      { key: 'ratioSteps', vars: { key: fmt(key), fill: fmt(fill), r: fmt(key / fill, 4), stops: fixed(stops, 2) } },
    ],
    answer: `Key to fill ${fmt(key / fill, 4)}:1 is ${fixed(stops, 2)} stops`,
    notes: [],
  });
}

export function color(v: Values): KitOk {
  const k1 = positive(v, 'k1', 'camKelvinFrom');
  const k2 = positive(v, 'k2', 'camKelvinTo');
  const shift = miredShift(k1, k2);
  return ok({
    rows: [
      { key: 'miredFrom', value: fixed(mired(k1), 2) },
      { key: 'miredTo', value: fixed(mired(k2), 2) },
      { key: 'miredShift', value: fixed(shift, 2) },
    ],
    steps: [
      {
        key: 'colorMired',
        vars: { k1: fmt(k1), k2: fmt(k2), m1: fixed(mired(k1), 2), m2: fixed(mired(k2), 2), shift: fixed(shift, 2) },
      },
      { key: shift < 0 ? 'colorBlue' : 'colorAmber' },
    ],
    answer: `${fmt(k1)} K to ${fmt(k2)} K needs a ${fixed(shift, 2)} mired shift`,
    notes: [],
  });
}

const gigabytes = (bytes: number): string => `${fmt(bytes / 1e9, 4)} GB`;

export function media(v: Values): KitOk {
  const secs = positive(v, 'seconds', 'camSeconds');
  if (v.media === 'raw') {
    const video = videoBitRate(
      positive(v, 'vw', 'camWidth'),
      positive(v, 'vh', 'camHeight'),
      positive(v, 'bpp', 'camBitsPerPixel'),
      positive(v, 'vfps', 'camFps'),
    );
    const audio = audioBitRate(
      positive(v, 'rateHz', 'camSampleRate'),
      positive(v, 'depth', 'camBitDepth'),
      positive(v, 'channels', 'camChannels'),
    );
    const total = video + audio;
    return ok({
      rows: [
        { key: 'videoRate', value: `${fmt(video / 1e6, 5)} Mb/s` },
        { key: 'audioRate', value: `${fmt(audio / 1e6, 5)} Mb/s` },
        { key: 'storage', value: gigabytes(storageBytes(total, secs)) },
      ],
      steps: [
        { key: 'mediaRaw', vars: { video: fmt(video / 1e6, 5), audio: fmt(audio / 1e6, 5) } },
        {
          key: 'mediaStorage',
          vars: { rate: fmt(total / 1e6, 5), s: fmt(secs), gb: gigabytes(storageBytes(total, secs)) },
        },
      ],
      answer: `${fmt(secs)} s uncompressed needs ${gigabytes(storageBytes(total, secs))}`,
      notes: ['camNoteMedia'],
    });
  }
  const mbps = positive(v, 'mbps', 'camMbps');
  const bytes = storageBytes(mbps * 1e6, secs);
  return ok({
    rows: [{ key: 'storage', value: gigabytes(bytes) }],
    steps: [{ key: 'mediaStorage', vars: { rate: fmt(mbps), s: fmt(secs), gb: gigabytes(bytes) } }],
    answer: `${fmt(mbps)} Mb/s for ${fmt(secs)} s is ${gigabytes(bytes)}`,
    notes: ['camNoteMedia'],
  });
}
