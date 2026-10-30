// checks-disable-file length: worked-step formulas are written as one line each

// The machining tool: speeds and feeds for turning, drilling and milling, Taylor tool life and its economics, and the
// chip: Merchant's shear angle and the forces on the tool. The engine is ../machining.ts.
import type { ToolSpec, Values } from '../kit/spec';
import {
  drilling,
  economics,
  forces,
  merchantShearAngle,
  milling,
  shearAngleFromRatio,
  toolLife,
  turning,
  speedForLife,
} from '../machining';
import type { CutResult } from '../machining';
import { fmt } from '../types';
import { choiceField, failed, modeField, numField, success } from './helpers';

const cut = (r: CutResult, ...more: string[]) =>
  success({
    rows: [
      { id: 'rpm', value: r.rpm, dim: 'rpm', sym: 'N', answer: true },
      { id: 'feedRate', value: r.feedRate, dim: 'mm/min', sym: 'v_f', answer: true },
      { id: 'mrr', value: r.mrrMin, dim: 'mm3/min', sym: '\\mathrm{MRR}', answer: true },
      { id: 'time', value: r.time, dim: 'min', sym: 't', answer: true },
    ],
    steps: r.steps,
    notes: ['cut', ...more],
  });

function run(v: Values) {
  const n = (id: string) => v[id] as number;
  switch (v.mode) {
    case 'turning': {
      const r = turning({ d: n('d'), v: n('v'), f: n('f'), depth: n('depth'), length: n('length') });
      return r.ok ? cut(r) : failed(r);
    }
    case 'drilling': {
      const r = drilling({ d: n('d'), v: n('v'), f: n('f'), depth: n('depth'), pointAngle: n('pointAngle') });
      return r.ok ? cut(r) : failed(r);
    }
    case 'milling': {
      const kind = v.kind === 'peripheral' ? 'peripheral' : 'slot';
      const r = milling({
        d: n('d'),
        v: n('v'),
        fz: n('fz'),
        teeth: n('teeth'),
        width: n('width'),
        depth: n('depth'),
        length: n('length'),
        kind,
      });
      const slotMismatch = kind === 'slot' && Math.abs(n('width') - n('d')) > 1e-9;
      return r.ok ? cut(r, ...(slotMismatch ? ['slotWidth'] : [])) : failed(r);
    }
    case 'life':
      return life(v);
    case 'economics':
      return costs(v);
    case 'shear':
      return shear(v);
    default:
      return thrust(v);
  }
}

function life(v: Values) {
  const n = v.n as number;
  const c = v.c as number;
  if (v.find === 'speed') {
    const r = speedForLife(n, c, v.life as number);
    if (!r.ok) return failed(r);
    const back = toolLife(n, c, r.v);
    return success({
      rows: [{ id: 'speed', value: r.v, dim: 'm/min', sym: 'V', answer: true }],
      steps: back.ok ? back.steps : [],
      notes: ['taylor'],
    });
  }
  const r = toolLife(n, c, v.v as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [{ id: 'life', value: r.life, dim: 'min', sym: 'T', answer: true }],
    steps: r.steps,
    notes: ['taylor'],
  });
}

function costs(v: Values) {
  const r = economics(v.n as number, v.c as number, v.changeTime as number, v.edgeCost as number, v.rate as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'costLife', value: r.costLife, dim: 'min', sym: 'T_c', answer: true },
      { id: 'costSpeed', value: r.costSpeed, dim: 'm/min', sym: 'V_c', answer: true },
      r.rateLife === null
        ? { id: 'rateLife', word: 'notDefined' }
        : { id: 'rateLife', value: r.rateLife, dim: 'min', sym: 'T_p' },
      r.rateSpeed === null
        ? { id: 'rateSpeed', word: 'notDefined' }
        : { id: 'rateSpeed', value: r.rateSpeed, dim: 'm/min', sym: 'V_p' },
    ],
    steps: r.steps,
    notes: r.rateLife === null ? ['taylor', 'economics', 'noChangeTime'] : ['taylor', 'economics'],
  });
}

function shear(v: Values) {
  const r =
    v.from === 'ratio'
      ? shearAngleFromRatio(v.ratio as number, v.rake as number)
      : merchantShearAngle(v.rake as number, v.friction as number);
  if (!r.ok) return failed(r);
  return success({
    rows: [{ id: 'phi', value: r.phi, dim: 'deg', sym: '\\phi', answer: true }],
    steps: [
      {
        key: 'shearAngle',
        latex:
          v.from === 'ratio'
            ? `\\tan\\phi=\\dfrac{r\\cos\\alpha}{1-r\\sin\\alpha},\\ r=${fmt(v.ratio as number)},\\ \\alpha=${fmt(v.rake as number)}^\\circ \\Rightarrow \\phi=${fmt(r.phi)}^\\circ`
            : `\\phi=45^\\circ+\\dfrac{\\alpha}{2}-\\dfrac{\\beta}{2}=45^\\circ+\\dfrac{${fmt(v.rake as number)}}{2}-\\dfrac{${fmt(v.friction as number)}}{2}=${fmt(r.phi)}^\\circ`,
      },
    ],
    notes: ['shear'],
  });
}

function thrust(v: Values) {
  const r = forces(
    v.fc as number,
    v.ft as number,
    v.rake as number,
    v.phi as number,
    v.t0 as number,
    v.w as number,
    v.v as number,
  );
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'friction', value: r.friction, dim: 'N', sym: 'F', answer: true },
      { id: 'normal', value: r.normal, dim: 'N', sym: 'N', answer: true },
      { id: 'shearForce', value: r.shear, dim: 'N', sym: 'F_s' },
      { id: 'shearNormal', value: r.shearNormal, dim: 'N', sym: 'F_n' },
      { id: 'mu', value: r.mu, sym: '\\mu', answer: true },
      { id: 'beta', value: r.beta, dim: 'deg', sym: '\\beta' },
      { id: 'shearStress', value: r.shearStress, dim: 'MPa', sym: '\\tau_s' },
      { id: 'power', value: r.power, dim: 'W', sym: 'P' },
      { id: 'specificEnergy', value: r.specificEnergy, dim: 'MPa', sym: 'u' },
    ],
    steps: r.steps,
    notes: ['circle'],
  });
}

const cutting = ['turning', 'drilling', 'milling'];

export const machiningSpec: ToolSpec = {
  fields: [
    modeField(['turning', 'drilling', 'milling', 'life', 'economics', 'shear', 'forces']),
    numField('d', '50', 'mm', ...cutting),
    numField('v', '150', 'm/min', ...cutting, 'life', 'forces'),
    numField('f', '0.25', 'mm/rev', 'turning', 'drilling'),
    numField('fz', '0.1', 'mm/tooth', 'milling'),
    numField('teeth', '4', undefined, 'milling'),
    choiceField('kind', ['slot', 'peripheral'], 'slot', 'milling'),
    numField('depth', '2', 'mm', ...cutting),
    numField('width', '20', 'mm', 'milling'),
    numField('length', '200', 'mm', 'turning', 'milling'),
    numField('pointAngle', '118', 'deg', 'drilling'),
    choiceField('find', ['life', 'speed'], 'life', 'life'),
    numField('n', '0.25', undefined, 'life', 'economics'),
    numField('c', '400', 'm/min', 'life', 'economics'),
    { ...numField('life', '30', 'min'), when: (x) => x.mode === 'life' && x.find === 'speed' },
    numField('changeTime', '2', 'min', 'economics'),
    numField('edgeCost', '4', undefined, 'economics'),
    numField('rate', '1', undefined, 'economics'),
    choiceField('from', ['merchant', 'ratio'], 'merchant', 'shear'),
    numField('rake', '10', 'deg', 'shear', 'forces'),
    { ...numField('friction', '30', 'deg'), when: (x) => x.mode === 'shear' && x.from === 'merchant' },
    { ...numField('ratio', '0.5', undefined), when: (x) => x.mode === 'shear' && x.from === 'ratio' },
    numField('fc', '1200', 'N', 'forces'),
    numField('ft', '500', 'N', 'forces'),
    numField('phi', '30', 'deg', 'forces'),
    numField('t0', '0.25', 'mm', 'forces'),
    numField('w', '3', 'mm', 'forces'),
  ],
  run,
  examples: [
    { id: 'turn', values: { mode: 'turning' } },
    { id: 'drill', values: { mode: 'drilling', d: '10', v: '30', f: '0.2', depth: '20' } },
    { id: 'mill', values: { mode: 'milling', d: '20', v: '60', depth: '3', length: '100' } },
    { id: 'taylor', values: { mode: 'life', v: '150' } },
    { id: 'cost', values: { mode: 'economics' } },
    { id: 'chip', values: { mode: 'shear', rake: '10', friction: '30' } },
  ],
};
