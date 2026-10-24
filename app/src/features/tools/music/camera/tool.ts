// The camera, timing, and lighting tool: exposure, depth of field, field of view, shutter angle, timecode, and footage,
// animation timing, light levels and color temperature, and media storage.
import type { ToolSpec } from '../spec';
import { degrees, fail, fixed, fmt, ok, positive, readNumber } from '../shared';
import type { KitOk, KitRow, KitStep, Values } from '../shared';
import {
  RATES,
  SENSORS,
  angleOfView,
  animation,
  apertureStops,
  circleOfConfusion,
  cropFactor,
  depthOfField,
  diagonal,
  equivalentShutter,
  exposureValue,
  exposureValueAtIso,
  feetAndFrames,
  focalForAngle,
  framesToTimecode,
  parseTimecode,
  reciprocityTime,
  shutterAngle,
  shutterTime,
  spacing,
  timecodeText,
  timecodeToFrames,
  validTimecode,
} from './engine';
import type { Easing, Sensor } from './engine';

import { FIELDS, mode } from './fields';
import { beam, color, inverse, media, ratio } from './lightModes';

function sensorOf(v: Values): Sensor {
  if (v.sensor === 'custom')
    return { width: positive(v, 'sw', 'camSensorWidth'), height: positive(v, 'sh', 'camSensorHeight') };
  return SENSORS[v.sensor ?? 'fullframe'] ?? SENSORS.fullframe!;
}

/** A shutter time: "1/125" or "0.008". */
const seconds = (n: number): string => (n > 0 && n < 1 ? `1/${fmt(1 / n, 4)}` : fmt(n));

function exposure(v: Values): KitOk {
  const n = positive(v, 'aperture', 'camAperture');
  const t = positive(v, 'shutter', 'camShutterTime');
  const iso = positive(v, 'iso', 'camIso');
  const ev = exposureValue(n, t);
  const rows: KitRow[] = [
    { key: 'ev100', value: fixed(ev, 2) },
    { key: 'evIso', value: fixed(exposureValueAtIso(n, t, iso), 2), vars: { iso: fmt(iso) } },
  ];
  const steps: KitStep[] = [
    { key: 'expEv', vars: { n: fmt(n), t: seconds(t), ev: fixed(ev, 2) } },
    {
      key: 'expIso',
      vars: { iso: fmt(iso), add: fixed(Math.log2(iso / 100), 2), ev: fixed(exposureValueAtIso(n, t, iso), 2) },
    },
  ];
  let answer = `EV ${fixed(ev, 2)} (f/${fmt(n)}, ${seconds(t)} s, ISO 100)`;
  const n2 = readNumber(v.newAperture ?? '');
  if (n2 !== null && n2 > 0) {
    const t2 = equivalentShutter(t, n, n2);
    const stops = apertureStops(n, n2);
    rows.push(
      { key: 'stopsChange', value: fixed(stops, 2) },
      { key: 'equivShutter', value: `${seconds(t2)} s`, vars: { n: fmt(n2) } },
    );
    steps.push({ key: 'expEquiv', vars: { from: fmt(n), to: fmt(n2), stops: fixed(stops, 2), t: seconds(t2) } });
    answer = `f/${fmt(n)} at ${seconds(t)} s matches f/${fmt(n2)} at ${seconds(t2)} s (EV ${fixed(ev, 2)})`;
  }
  const p = readNumber(v.recip ?? '');
  if (p !== null) {
    if (p < 1) fail('camRecipRange');
    const corrected = reciprocityTime(t, p);
    rows.push({ key: 'correctedTime', value: `${fmt(corrected)} s` });
    steps.push({ key: 'expRecip', vars: { t: fmt(t), p: fmt(p), corrected: fmt(corrected) } });
  }
  return ok({ rows, steps, answer, notes: ['camNoteEv'] });
}

const MM = { m: 1000, ft: 304.8 } as const;

function depth(v: Values): KitOk {
  const f = positive(v, 'focal', 'camFocal');
  const n = positive(v, 'aperture', 'camAperture');
  const sensor = sensorOf(v);
  const typed = readNumber(v.coc ?? '');
  if (typed !== null && typed <= 0) fail('positive', { field: 'camCoc' });
  const coc = typed ?? circleOfConfusion(sensor);
  const unit = v.units === 'ft' ? 'ft' : 'm';
  const s = positive(v, 'distance', 'camSubject') * MM[unit];
  if (s <= f) fail('camFocusClose', { f: fmt(f) });
  const d = depthOfField(f, n, coc, s);
  const show = (mm: number) => `${fmt(mm / MM[unit], 4)} ${unit}`;
  const farText = Number.isFinite(d.far) ? show(d.far) : '∞';
  const rows: KitRow[] = [
    { key: 'hyperfocal', value: show(d.hyperfocal) },
    { key: 'nearLimit', value: show(d.near) },
    { key: 'farLimit', value: farText },
    { key: 'dofTotal', value: Number.isFinite(d.far) ? show(d.total) : '∞' },
    { key: 'cocUsed', value: `${fmt(coc, 3)} mm` },
  ];
  const steps: KitStep[] = [
    { key: 'dofCoc', vars: { coc: fmt(coc, 3), diag: fmt(diagonal(sensor), 4) } },
    { key: 'dofHyper', vars: { f: fmt(f), n: fmt(n), coc: fmt(coc, 3), h: show(d.hyperfocal) } },
    { key: 'dofNear', vars: { near: show(d.near), s: show(s) } },
    Number.isFinite(d.far) ? { key: 'dofFar', vars: { far: farText, s: show(s) } } : { key: 'dofInfinity' },
  ];
  return ok({
    rows,
    steps,
    answer: `${fmt(f)} mm at f/${fmt(n)} focused at ${show(s)}: sharp from ${show(d.near)} to ${farText}`,
    notes: ['camNoteDof'],
  });
}

function view(v: Values): KitOk {
  const f = positive(v, 'focal', 'camFocal');
  const sensor = sensorOf(v);
  const diag = diagonal(sensor);
  const h = degrees(angleOfView(sensor.width, f));
  const vert = degrees(angleOfView(sensor.height, f));
  const dg = degrees(angleOfView(diag, f));
  const crop = cropFactor(sensor);
  const rows: KitRow[] = [
    { key: 'hfov', value: `${fixed(h, 2)}°` },
    { key: 'vfov', value: `${fixed(vert, 2)}°` },
    { key: 'dfov', value: `${fixed(dg, 2)}°` },
    { key: 'cropFactor', value: fixed(crop, 2) },
    { key: 'equivFocal', value: `${fmt(f * crop, 4)} mm` },
    { key: 'equivAperture', value: `×${fixed(crop, 2)}` },
  ];
  const steps: KitStep[] = [
    { key: 'fovAngle', vars: { dim: fmt(sensor.width, 4), f: fmt(f), a: fixed(h, 2) } },
    { key: 'fovCrop', vars: { crop: fixed(crop, 3), diag: fmt(diag, 4) } },
    { key: 'fovEquiv', vars: { f: fmt(f), crop: fixed(crop, 3), eq: fmt(f * crop, 4) } },
  ];
  const wide = focalForAngle(36, (h * Math.PI) / 180);
  steps.push({ key: 'fovFull', vars: { a: fixed(h, 2), f: fmt(wide, 4) } });
  return ok({
    rows,
    steps,
    answer:
      `${fmt(f)} mm on a ${fmt(sensor.width, 4)} mm wide sensor: ${fixed(h, 1)}° horizontal, ` +
      `${fmt(f * crop, 4)} mm full-frame equivalent`,
    notes: ['camNoteFov'],
  });
}

function shutter(v: Values): KitOk {
  const angle = positive(v, 'angle', 'camAngle');
  if (angle > 360) fail('camAngleRange');
  const fps = positive(v, 'fps', 'camFps');
  const t = shutterTime(angle, fps);
  const rows: KitRow[] = [{ key: 'shutterSpeed', value: `${seconds(t)} s` }];
  const steps: KitStep[] = [{ key: 'shutterFromAngle', vars: { angle: fmt(angle), fps: fmt(fps), t: seconds(t) } }];
  const typed = readNumber(v.time ?? '');
  if (typed !== null) {
    if (typed <= 0) fail('positive', { field: 'camExposureTime' });
    const a = shutterAngle(typed, fps);
    rows.push({ key: 'shutterAngleFor', value: `${fixed(a, 2)}°` });
    steps.push({ key: 'shutterToAngle', vars: { t: seconds(typed), fps: fmt(fps), angle: fixed(a, 2) } });
    if (a > 360) fail('camTimeLong', { fps: fmt(fps) });
  }
  return ok({ rows, steps, answer: `${fmt(angle)}° at ${fmt(fps)} fps is ${seconds(t)} s`, notes: ['camNoteShutter'] });
}

function timecode(v: Values): KitOk {
  const rate = RATES[v.rate ?? '29.97df'] ?? RATES['29.97df']!;
  const drop = rate.drop > 0;
  const typedFrames = readNumber(v.frames ?? '');
  const rows: KitRow[] = [];
  const steps: KitStep[] = [];
  let answer: string;
  if (typedFrames !== null) {
    if (!Number.isInteger(typedFrames) || typedFrames < 0) fail('camFramesInteger');
    const tc = framesToTimecode(typedFrames, rate);
    const text = timecodeText(tc, drop);
    rows.push(
      { key: 'timecodeOut', value: text },
      { key: 'runningTime', value: `${fmt(typedFrames / rate.fps, 6)} s` },
    );
    steps.push({ key: drop ? 'tcDropToTc' : 'tcToTc', vars: { frames: fmt(typedFrames), tc: text } });
    answer = `${fmt(typedFrames)} frames at ${fmt(rate.fps, 5)} fps is ${text}`;
  } else {
    const tc = parseTimecode(v.tc ?? '');
    if (!tc) return fail('camTimecodeFormat');
    if (!validTimecode(tc, rate)) {
      const skipped = rate.drop > 0 && tc.seconds === 0 && tc.frames < rate.drop;
      return fail(skipped ? 'camTimecodeDropped' : 'camTimecodeRange', { rate: fmt(rate.nominal) });
    }
    const frames = timecodeToFrames(tc, rate);
    rows.push(
      { key: 'frameCount', value: fmt(frames) },
      { key: 'runningTime', value: `${fmt(frames / rate.fps, 6)} s` },
    );
    const minutes = tc.hours * 60 + tc.minutes;
    const total = (minutes * 60 + tc.seconds) * rate.nominal + tc.frames;
    steps.push({ key: 'tcCount', vars: { n: fmt(rate.nominal), total: fmt(total) } });
    if (drop) {
      const dropped = rate.drop * (minutes - Math.floor(minutes / 10));
      steps.push({
        key: 'tcDrop',
        vars: { drop: fmt(rate.drop), minutes: fmt(minutes), dropped: fmt(dropped), frames: fmt(frames) },
      });
    }
    answer = `${timecodeText(tc, drop)} is frame ${fmt(frames)} (${fmt(frames / rate.fps, 6)} s)`;
  }
  return ok({ rows, steps, answer, notes: drop ? ['camNoteDrop'] : [] });
}

function footage(v: Values): KitOk {
  const perFoot = Number(v.gauge ?? '16');
  const fps = positive(v, 'fps', 'camFps');
  const typed = readNumber(v.frames ?? '');
  let frames: number;
  if (typed !== null) {
    if (!Number.isInteger(typed) || typed < 0) fail('camFramesInteger');
    frames = typed;
  } else {
    frames = Math.round(positive(v, 'seconds', 'camSeconds') * fps);
  }
  const ff = feetAndFrames(frames, perFoot);
  const rows: KitRow[] = [
    { key: 'frameCount', value: fmt(frames) },
    { key: 'footageFeet', value: `${ff.feet} ft + ${ff.frames} frames` },
    { key: 'footageLength', value: `${fmt((frames / perFoot) * 0.3048, 4)} m` },
    { key: 'runningTime', value: `${fmt(frames / fps, 6)} s` },
  ];
  const steps: KitStep[] = [
    { key: 'footageCount', vars: { frames: fmt(frames), fps: fmt(fps) } },
    {
      key: 'footageFeet',
      vars: { frames: fmt(frames), per: fmt(perFoot), feet: String(ff.feet), rest: String(ff.frames) },
    },
  ];
  return ok({
    rows,
    steps,
    answer: `${fmt(frames)} frames of ${perFoot === 16 ? '35' : '16'} mm film is ${ff.feet} ft + ${ff.frames} frames`,
    notes: ['camNoteFootage'],
  });
}

const HOLDS: Record<number, string> = { 1: 'on ones', 2: 'on twos', 3: 'on threes' };

function animate(v: Values): KitOk {
  const secs = positive(v, 'seconds', 'camSeconds');
  const fps = positive(v, 'fps', 'camFps');
  const hold = Number(v.hold ?? '2');
  const a = animation(secs, fps, hold);
  const count = Math.round(positive(v, 'steps', 'camSteps'));
  if (count < 2 || count > 48) fail('camStepsRange');
  const easing = (v.easing ?? 'inout') as Easing;
  const chart = spacing(count, easing).map((p, i) => `${i}: ${fixed(p * 100, 1)}%`);
  const sheet = a.sheet.slice(0, 48).map((r) => `${r.drawing}\t${r.from}-${r.to}`);
  const rows: KitRow[] = [
    { key: 'frameCount', value: fmt(a.frames) },
    { key: 'drawingCount', value: fmt(a.drawings) },
    { key: 'spacingChart', value: chart.join('  ') },
  ];
  const steps: KitStep[] = [
    { key: 'animFrames', vars: { s: fmt(secs), fps: fmt(fps), frames: fmt(a.frames) } },
    { key: 'animDrawings', vars: { frames: fmt(a.frames), hold: fmt(hold), drawings: fmt(a.drawings) } },
    { key: 'animSpacing', vars: { count: fmt(count) } },
  ];
  return ok({
    rows,
    steps,
    answer:
      `${fmt(secs)} s at ${fmt(fps)} fps, ${HOLDS[hold] ?? 'held'}: ` +
      `${fmt(a.drawings)} drawings over ${fmt(a.frames)} frames`,
    code: `Drawing\tFrames\n${sheet.join('\n')}${a.sheet.length > 48 ? '\n…' : ''}`,
    notes: [],
  });
}

const RUN: Record<string, (v: Values) => KitOk> = {
  exposure,
  depth,
  view,
  shutter,
  timecode,
  footage,
  animation: animate,
  inverse,
  beam,
  ratio,
  color,
  media,
};

export const spec: ToolSpec = {
  id: 'camera',
  fields: FIELDS,
  run: (values) => (RUN[mode(values)] ?? exposure)(values),
};
