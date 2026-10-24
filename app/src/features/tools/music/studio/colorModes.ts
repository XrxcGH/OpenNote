// checks-disable-file brand-consistency: color values are data here, not styling
// The studio tool's color modes: conversions, contrast, differences, vision simulation, palettes, and type scales.
import { fail, fixed, fmt, ok, positive, readNumber } from '../shared';
import type { FieldKey, KitOk, KitRow, KitStep, RowKey, Values } from '../shared';
import {
  confusablePairs,
  contrast,
  deltaE2000,
  labToLch,
  palette,
  parseColor,
  rgbToCmyk,
  rgbToHsl,
  rgbToHsv,
  rgbToLab,
  rgbToXyz,
  simulate,
  toHex,
  typeScale,
  wcag,
} from './color';
import type { Deficiency, Harmony, Rgb } from './color';

function read(v: Values, id: string, label: FieldKey): Rgb {
  const parsed = parseColor(v[id] ?? '');
  return parsed ?? fail('stuColorFormat', { field: label });
}

const pct = (x: number): string => `${fixed(x * 100, 1)}%`;

/** Color swatches as SVG, each with its hex written underneath. */
export function swatches(colors: readonly Rgb[], names: readonly string[] = []): string {
  const w = 96;
  const cells = colors
    .map((c, i) => {
      const hex = toHex(c);
      const label = names[i] ? `${names[i]} ${hex}` : hex;
      return (
        `<rect x="${i * w + 4}" y="4" width="${w - 8}" height="56" rx="4" fill="${hex}" stroke="currentColor" ` +
        `stroke-opacity="0.4"/><text x="${i * w + w / 2}" y="78" font-size="11" text-anchor="middle" ` +
        `fill="currentColor">${label}</text>`
      );
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${colors.length * w} 88">${cells}</svg>`;
}

export function convert(v: Values): KitOk {
  const rgb = read(v, 'color', 'stuColor');
  const [h, s, l] = rgbToHsl(rgb);
  const [hv, sv, val] = rgbToHsv(rgb);
  const cmyk = rgbToCmyk(rgb);
  const xyz = rgbToXyz(rgb);
  const lab = rgbToLab(rgb);
  const lch = labToLch(lab);
  const rounded = rgb.map((c) => Math.round(c));
  const rows: KitRow[] = [
    { key: 'hexOut', value: toHex(rgb) },
    { key: 'rgbOut', value: `rgb(${rounded.join(', ')})` },
    { key: 'hslOut', value: `hsl(${fixed(h, 1)}, ${pct(s)}, ${pct(l)})` },
    { key: 'hsvOut', value: `hsv(${fixed(hv, 1)}, ${pct(sv)}, ${pct(val)})` },
    { key: 'cmykOut', value: cmyk.map(pct).join(', ') },
    { key: 'xyzOut', value: xyz.map((x) => fixed(x, 4)).join(', ') },
    { key: 'labOut', value: lab.map((x) => fixed(x, 2)).join(', ') },
    { key: 'lchOut', value: lch.map((x) => fixed(x, 2)).join(', ') },
  ];
  const steps: KitStep[] = [
    { key: 'convGamma', vars: { rgb: rounded.join(', ') } },
    { key: 'convXyz', vars: { xyz: xyz.map((x) => fixed(x, 4)).join(', ') } },
    { key: 'convLab', vars: { lab: lab.map((x) => fixed(x, 2)).join(', ') } },
    { key: 'convCmyk' },
  ];
  return ok({
    rows,
    steps,
    answer: `${toHex(rgb)} is rgb(${rounded.join(', ')}), Lab ${lab.map((x) => fixed(x, 1)).join(', ')}`,
    svg: { markup: swatches([rgb]), label: toHex(rgb) },
    notes: ['stuNoteConvert', 'stuNoteCmyk'],
  });
}

export function contrastMode(v: Values): KitOk {
  const fg = read(v, 'fg', 'stuForeground');
  const bg = read(v, 'bg', 'stuBackground');
  const ratio = contrast(fg, bg);
  const grade = wcag(ratio);
  const word = (pass: boolean): string => (pass ? 'Pass' : 'Fail');
  const verdict = (key: RowKey, pass: boolean): KitRow => ({ key, value: '', word: pass ? 'wordPass' : 'wordFail' });
  const rows: KitRow[] = [
    { key: 'contrastRatio', value: `${fixed(ratio, 2)} : 1` },
    verdict('aaNormal', grade.aaNormal),
    verdict('aaaNormal', grade.aaaNormal),
    verdict('aaLarge', grade.aaLarge),
    verdict('aaaLarge', grade.aaaLarge),
  ];
  return ok({
    rows,
    steps: [
      { key: 'contrastLum', vars: { fg: toHex(fg), bg: toHex(bg) } },
      { key: 'contrastRatioStep', vars: { ratio: fixed(ratio, 2) } },
      { key: 'contrastLimits' },
    ],
    answer: `${toHex(fg)} on ${toHex(bg)} has contrast ${fixed(ratio, 2)}:1 (AA text ${word(grade.aaNormal)})`,
    svg: { markup: swatches([fg, bg], ['text', 'back']), label: `${toHex(fg)} on ${toHex(bg)}` },
    notes: ['stuNoteContrast'],
  });
}

export function difference(v: Values): KitOk {
  const a = read(v, 'colorA', 'stuColorA');
  const b = read(v, 'colorB', 'stuColorB');
  const labA = rgbToLab(a);
  const labB = rgbToLab(b);
  const d = deltaE2000(labA, labB);
  const verdict: RowKey = d < 1 ? 'wordUnseen' : d < 2.3 ? 'wordBarely' : d < 10 ? 'wordClose' : 'wordClearly';
  return ok({
    rows: [
      { key: 'deltaE', value: fixed(d, 2) },
      { key: 'deltaVerdict', value: '', word: verdict },
    ],
    steps: [
      {
        key: 'deltaLabs',
        vars: { a: labA.map((x) => fixed(x, 2)).join(', '), b: labB.map((x) => fixed(x, 2)).join(', ') },
      },
      { key: 'deltaFormula', vars: { d: fixed(d, 2) } },
    ],
    answer: `${toHex(a)} and ${toHex(b)} differ by ΔE00 ${fixed(d, 2)}`,
    svg: { markup: swatches([a, b]), label: `${toHex(a)} and ${toHex(b)}` },
    notes: ['stuNoteDelta'],
    source: 'Sharma, Wu, and Dalal (2005), CIEDE2000',
  });
}

const KINDS: readonly Deficiency[] = ['protan', 'deutan', 'tritan'];

export function vision(v: Values): KitOk {
  const rgb = read(v, 'color', 'stuColor');
  const seen = KINDS.map((kind) => simulate(rgb, kind));
  const names = ['normal', 'protan', 'deutan', 'tritan'];
  return ok({
    rows: KINDS.map((kind, i) => ({ key: `${kind}Out` as const, value: toHex(seen[i]!) })),
    steps: [{ key: 'visionMatrix' }, { key: 'visionLinear' }],
    answer: `${toHex(rgb)} appears as ${KINDS.map((k, i) => `${k} ${toHex(seen[i]!)}`).join(', ')}`,
    svg: { markup: swatches([rgb, ...seen], names), label: toHex(rgb) },
    notes: ['stuNoteVision'],
    source: 'Machado, Oliveira, and Fernandes (2009)',
  });
}

export function paletteMode(v: Values): KitOk {
  const base = read(v, 'color', 'stuColor');
  const colors = palette(base, (v.harmony ?? 'triadic') as Harmony);
  const clash = confusablePairs(colors);
  const rows: KitRow[] = colors.map((c, i) => ({ key: 'paletteColor', value: toHex(c), vars: { n: String(i + 1) } }));
  rows.push({
    key: 'paletteCheck',
    value: clash.map((p) => `${p.a + 1} and ${p.b + 1} (${p.kind})`).join(', '),
    ...(clash.length === 0 ? { word: 'wordNoClash' as const } : {}),
  });
  return ok({
    rows,
    steps: [{ key: 'paletteHsl' }, { key: 'paletteCheckStep' }],
    answer: colors.map(toHex).join(', '),
    svg: { markup: swatches(colors), label: colors.map(toHex).join(', ') },
    notes: ['stuNotePalette'],
  });
}

export function typeScaleMode(v: Values): KitOk {
  const base = positive(v, 'tsBase', 'stuTypeBase');
  const ratio = positive(v, 'tsRatio', 'stuTypeRatio');
  if (ratio === 1) fail('stuRatioOne');
  const down = readNumber(v.tsDown ?? '');
  const up = readNumber(v.tsUp ?? '');
  if (down === null || up === null || !Number.isInteger(down) || !Number.isInteger(up) || down < 0 || up < 0) {
    return fail('stuStepsWhole');
  }
  if (down + up > 20) fail('stuTooManySteps');
  const sizes = typeScale(base, ratio, -down, up);
  return ok({
    rows: sizes.map((s) => ({ key: 'typeStep' as const, value: `${fmt(s.size, 6)}`, vars: { n: String(s.step) } })),
    steps: [{ key: 'typeFormula', vars: { base: fmt(base), ratio: fmt(ratio) } }],
    answer: sizes.map((s) => fmt(s.size, 5)).join(', '),
    notes: [],
  });
}
