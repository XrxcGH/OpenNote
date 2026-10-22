// The chemistry calculators as forms: each is a list of fields and a function from what was typed to an answer with
// steps. The method lives in ../chem/calc; this file only reads the fields and words the result.
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { balance, splitEquation } from '../chem/calc/balance';
import { hillFormula, molarMass, parseFormula, percentComposition } from '../chem/calc/formula';
import {
  PRESSURE_UNITS,
  TEMPERATURE_UNITS,
  VOLUME_UNITS,
  combinedGas,
  fromAtm,
  fromKelvin,
  fromLiters,
  gasDensity,
  grahamRatio,
  idealGas,
  toAtm,
  toKelvin,
  toLiters,
} from '../chem/calc/gas';
import type { PressureUnit, TemperatureUnit, VolumeUnit } from '../chem/calc/gas';
import { buffer, dilution, dilutionPlan, molarity, phOf } from '../chem/calc/solution';
import type { Species } from '../chem/calc/solution';
import { limitingReagent, percentYield, sig } from '../chem/calc/stoich';
import { equivalenceVolume, summary, unknownConcentration } from '../chem/calc/titration';
import type { Analyte, Titration } from '../chem/calc/titration';
import { TitrationCurve } from './TitrationCurve';
import { num } from './ChemForm';
import type { ChemFormProps, FieldSpec, Outcome, Values } from './ChemForm';

const bad = (key: MessageKey): Outcome => ({ ok: false, message: t(key) });
const ok = (headline: string, steps: readonly string[] = [], figure?: React.ReactNode): Outcome => ({
  ok: true,
  headline,
  steps,
  figure,
});

type Form = Omit<ChemFormProps, 'intro'> & { intro?: MessageKey };

const field = (id: string, key: string, rest: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label: t(`chem.f.${key}` as MessageKey),
  ...rest,
});

const textOf = (values: Values, id: string) => (values.text[id] ?? '').trim();

// Balance an equation.
const balanceForm: Form = {
  name: 'balance',
  intro: 'chem.calc.balanceIntro',
  fields: [field('eq', 'equation', { kind: 'text', initial: 'C3H8 + O2 -> CO2 + H2O' })],
  solve(values) {
    const result = balance(textOf(values, 'eq'));
    if (!result.ok) return bad(`chem.calc.balanceErrors.${result.reason}`);
    const { reactants, products, text } = result.balanced;
    const steps = [...reactants, ...products].map((s) => {
      const mass = molarMass(s.text);
      return mass === null ? s.text : `${s.coefficient} ${s.text}: ${sig(mass)} g/mol`;
    });
    return ok(text, steps);
  },
};

// Molar mass and percent composition.
const molarForm: Form = {
  name: 'molar',
  fields: [field('f', 'formula', { kind: 'text', initial: 'Ca(OH)2' })],
  solve(values) {
    const text = textOf(values, 'f');
    const parts = parseFormula(text);
    const mass = molarMass(text);
    if (!parts || mass === null) return bad('chem.calc.formulaError');
    const percent = percentComposition(text) ?? [];
    return ok(
      `${hillFormula(parts)}: ${sig(mass, 5)} g/mol`,
      percent.map((p) => `${p.symbol}: ${sig(p.percent, 4)}%`),
    );
  },
};

// Stoichiometry: grams of each reactant, the limiting reagent, the yield, and percent yield.
const stoichForm: Form = {
  name: 'stoich',
  intro: 'chem.calc.stoichIntro',
  fields(values) {
    const sides = splitEquation(textOf(values, 'eq') || 'N2 + H2 -> NH3');
    const result = balance(textOf(values, 'eq') || 'N2 + H2 -> NH3');
    const reactants = sides?.left.map((s) => s.replace(/^\d+\s*/, '')) ?? [];
    const products = result.ok ? result.balanced.products.map((p) => p.text) : [];
    return [
      field('eq', 'equation', { kind: 'text', initial: 'N2 + H2 -> NH3' }),
      ...reactants.map((r) => ({ id: `m:${r}`, label: t('chem.f.massOf', { name: r }) })),
      field('actual', 'actualYield'),
      ...(products.length > 1
        ? [
            field('product', 'yieldOf', {
              kind: 'select' as const,
              options: products.map((p) => ({ value: p, label: p })),
            }),
          ]
        : []),
    ];
  },
  solve(values) {
    const equation = textOf(values, 'eq');
    const result = balance(equation);
    if (!result.ok) return bad(`chem.calc.balanceErrors.${result.reason}`);
    const given: Record<string, number> = {};
    for (const r of result.balanced.reactants) {
      const grams = num(values, `m:${r.text}`);
      if (grams !== null && Number.isNaN(grams)) return bad('chem.calc.notNumber');
      if (grams !== null && grams > 0) given[r.text] = grams;
    }
    const out = limitingReagent(equation, given);
    if (!out.ok) return bad('chem.calc.stoichGiven');
    const products = out.lines.filter((l) => result.balanced.products.some((p) => p.text === l.text));
    const chosen = products.find((p) => p.text === values.text.product) ?? products[0];
    const steps = [...out.steps];
    for (const line of out.lines) {
      if (line.leftover !== undefined && line.leftover > 1e-9)
        steps.push(t('chem.calc.leftover', { name: line.text, grams: sig(line.leftover) }));
    }
    const actual = num(values, 'actual');
    let headline = products.map((p) => `${p.text}: ${sig(p.grams ?? 0)} g`).join(', ');
    if (actual !== null && actual > 0 && chosen?.grams) {
      const percent = percentYield(actual, chosen.grams);
      steps.push(`Percent yield = ${sig(actual)} g ÷ ${sig(chosen.grams)} g × 100 = ${sig(percent)}%`);
      headline = `${t('chem.calc.percentYield')}: ${sig(percent)}%`;
    }
    return ok(
      out.limiting && Object.keys(given).length > 1
        ? `${t('chem.calc.limiting', { name: out.limiting })}. ${headline}`
        : headline,
      steps,
    );
  },
};

// The ideal gas law.
const idealForm: Form = {
  name: 'ideal',
  intro: 'chem.calc.leaveEmpty',
  fields: [
    field('p', 'pressure', { units: PRESSURE_UNITS, initial: '1', initialUnit: 'atm' }),
    field('v', 'volume', { units: VOLUME_UNITS, initial: '', initialUnit: 'L' }),
    field('n', 'moles', { initial: '1' }),
    field('t', 'temperature', { units: TEMPERATURE_UNITS, initial: '0', initialUnit: '°C' }),
  ],
  solve(values) {
    const read = (id: string) => num(values, id);
    const all = ['p', 'v', 'n', 't'].map(read);
    if (all.some((x) => x !== null && Number.isNaN(x))) return bad('chem.calc.notNumber');
    const out = idealGas({
      p: { value: all[0], unit: values.unit.p as PressureUnit },
      v: { value: all[1], unit: values.unit.v as VolumeUnit },
      n: all[2],
      t: { value: all[3], unit: values.unit.t as TemperatureUnit },
    });
    if (!out.ok) return bad(out.reason === 'count' ? 'chem.calc.oneEmpty' : 'chem.calc.positive');
    return ok(
      `${t(`chem.f.${{ p: 'pressure', v: 'volume', n: 'moles', t: 'temperature' }[out.unknown]}` as MessageKey)} = ${sig(out.value)} ${out.unit}`,
      out.steps,
    );
  },
};

// The combined gas law.
const combinedForm: Form = {
  name: 'combined',
  intro: 'chem.calc.leaveEmpty',
  fields: ['1', '2'].flatMap((k) => [
    field(`p${k}`, `pressure${k}`, { units: PRESSURE_UNITS, initial: k === '1' ? '1' : '2', initialUnit: 'atm' }),
    field(`v${k}`, `volume${k}`, { units: VOLUME_UNITS, initial: k === '1' ? '5' : '', initialUnit: 'L' }),
    field(`t${k}`, `temperature${k}`, {
      units: TEMPERATURE_UNITS,
      initial: k === '1' ? '300' : '350',
      initialUnit: 'K',
    }),
  ]),
  solve(values) {
    const keys = ['p1', 'v1', 't1', 'p2', 'v2', 't2'] as const;
    const raw = keys.map((k) => num(values, k));
    if (raw.some((x) => x !== null && Number.isNaN(x))) return bad('chem.calc.notNumber');
    const conv = (k: (typeof keys)[number], x: number): number =>
      k[0] === 'p'
        ? toAtm(x, values.unit[k] as PressureUnit)
        : k[0] === 'v'
          ? toLiters(x, values.unit[k] as VolumeUnit)
          : toKelvin(x, values.unit[k] as TemperatureUnit);
    const input = Object.fromEntries(
      keys.map((k, i) => [k, raw[i] === null ? null : conv(k, raw[i]!)]),
    ) as unknown as Parameters<typeof combinedGas>[0];
    const out = combinedGas(input);
    if (!out.ok) return bad('chem.calc.oneEmpty');
    const unit = values.unit[out.key];
    const shown =
      out.key[0] === 'p'
        ? fromAtm(out.value, unit as PressureUnit)
        : out.key[0] === 'v'
          ? fromLiters(out.value, unit as VolumeUnit)
          : fromKelvin(out.value, unit as TemperatureUnit);
    return ok(`${out.key.toUpperCase()} = ${sig(shown)} ${unit}`, [
      out.steps[0],
      `${out.key.toUpperCase()} = ${sig(out.value)} (${out.key[0] === 'p' ? 'atm' : out.key[0] === 'v' ? 'L' : 'K'})`,
    ]);
  },
};

// Graham's law and gas density.
const grahamForm: Form = {
  name: 'graham',
  fields: [field('m1', 'molarMass1', { initial: '2.016' }), field('m2', 'molarMass2', { initial: '31.998' })],
  solve(values) {
    const a = num(values, 'm1');
    const b = num(values, 'm2');
    if (a === null || b === null || !(a > 0) || !(b > 0)) return bad('chem.calc.positive');
    const r = grahamRatio(a, b);
    return ok(`rate₁ / rate₂ = ${sig(r)}`, [`rate₁/rate₂ = √(M₂/M₁) = √(${sig(b)} ÷ ${sig(a)}) = ${sig(r)}`]);
  },
};

const densityForm: Form = {
  name: 'density',
  fields: [
    field('m', 'molarMass', { initial: '28.014' }),
    field('p', 'pressure', { units: PRESSURE_UNITS, initial: '1', initialUnit: 'atm' }),
    field('t', 'temperature', { units: TEMPERATURE_UNITS, initial: '0', initialUnit: '°C' }),
  ],
  solve(values) {
    const m = num(values, 'm');
    const p = num(values, 'p');
    const tt = num(values, 't');
    if (m === null || p === null || tt === null || Number.isNaN(m + p + tt) || !(m > 0 && p > 0))
      return bad('chem.calc.positive');
    const k = toKelvin(tt, values.unit.t as TemperatureUnit);
    const atm = toAtm(p, values.unit.p as PressureUnit);
    if (!(k > 0)) return bad('chem.calc.positive');
    const d = gasDensity(m, atm, k);
    return ok(`ρ = ${sig(d)} g/L`, [`ρ = PM/RT = (${sig(atm)} × ${sig(m)}) ÷ (0.08206 × ${sig(k)}) = ${sig(d)} g/L`]);
  },
};

// Dilution.
const dilutionForm: Form = {
  name: 'dilution',
  intro: 'chem.calc.leaveEmpty',
  fields: [
    field('c1', 'c1', { initial: '6' }),
    field('v1', 'v1', { initial: '50' }),
    field('c2', 'c2', { initial: '0.5' }),
    field('v2', 'v2', { initial: '' }),
  ],
  solve(values) {
    const read = (k: string) => num(values, k);
    const all = ['c1', 'v1', 'c2', 'v2'].map(read);
    if (all.some((x) => x !== null && Number.isNaN(x))) return bad('chem.calc.notNumber');
    const out = dilution({ c1: all[0], v1: all[1], c2: all[2], v2: all[3] });
    if (!out.ok) return bad('chem.calc.oneEmpty');
    const steps = [...out.steps];
    const stock = out.key === 'c1' ? out.value : all[0];
    const target = out.key === 'c2' ? out.value : all[2];
    const final = out.key === 'v2' ? out.value : all[3];
    const plan = stock && target && final ? dilutionPlan(stock, target, final) : null;
    if (plan) steps.push(t('chem.calc.dilutePlan', { stock: sig(plan.stockVolume), water: sig(plan.water) }));
    return ok(`${out.key.toUpperCase()} = ${sig(out.value)}`, steps);
  },
};

// Molarity from mass.
const molarityForm: Form = {
  name: 'molarity',
  fields: [
    field('f', 'formula', { kind: 'text', initial: 'NaCl' }),
    field('g', 'grams', { initial: '5.85' }),
    field('l', 'liters', { initial: '0.5' }),
  ],
  solve(values) {
    const mass = molarMass(textOf(values, 'f'));
    const g = num(values, 'g');
    const l = num(values, 'l');
    if (mass === null) return bad('chem.calc.formulaError');
    if (g === null || l === null || !(g > 0 && l > 0)) return bad('chem.calc.positive');
    const c = molarity(g, mass, l);
    return ok(`${sig(c)} M`, [
      `Moles = ${sig(g)} g ÷ ${sig(mass)} g/mol = ${sig(g / mass)} mol`,
      `Molarity = ${sig(g / mass)} mol ÷ ${sig(l)} L = ${sig(c)} M`,
    ]);
  },
};

// pH of an acid or base.
const phForm: Form = {
  name: 'ph',
  fields: [
    field('kind', 'kind', {
      kind: 'select',
      options: (['strongAcid', 'weakAcid', 'strongBase', 'weakBase'] as const).map((k) => ({
        value: k,
        label: t(`chem.kinds.${k}`),
      })),
      initial: 'weakAcid',
    }),
    field('c', 'concentration', { initial: '0.1' }),
    field('k', 'kValue', { initial: '1.8e-5', help: t('chem.calc.kHelp') }),
  ],
  solve(values) {
    const c = num(values, 'c');
    const k = num(values, 'k');
    if (c === null || Number.isNaN(c) || !(c > 0)) return bad('chem.calc.positive');
    const out = phOf(values.text.kind as Species, c, k ?? 0);
    if (!out) return bad('chem.calc.needK');
    return ok(`pH = ${out.ph.toFixed(2)}`, [...out.steps, `pOH = ${out.poh.toFixed(2)}`]);
  },
};

const bufferForm: Form = {
  name: 'buffer',
  fields: [
    field('pka', 'pKa', { initial: '4.74' }),
    field('base', 'baseConc', { initial: '0.2' }),
    field('acid', 'acidConc', { initial: '0.1' }),
  ],
  solve(values) {
    const a = num(values, 'pka');
    const b = num(values, 'base');
    const c = num(values, 'acid');
    if (a === null || b === null || c === null || Number.isNaN(a + b + c)) return bad('chem.calc.notNumber');
    const out = buffer(a, b, c);
    return out ? ok(`pH = ${out.ph.toFixed(2)}`, out.steps) : bad('chem.calc.positive');
  },
};

// Titration: the curve and the equivalence point.
const curveForm: Form = {
  name: 'curve',
  fields: [
    field('analyte', 'analyte', {
      kind: 'select',
      options: (['strongAcid', 'weakAcid', 'strongBase', 'weakBase'] as const).map((k) => ({
        value: k,
        label: t(`chem.kinds.${k}`),
      })),
      initial: 'weakAcid',
    }),
    field('ca', 'analyteConc', { initial: '0.1' }),
    field('va', 'analyteVolume', { initial: '25' }),
    field('k', 'kValue', { initial: '1.8e-5', help: t('chem.calc.kHelp') }),
    field('ct', 'titrantConc', { initial: '0.1' }),
  ],
  solve(values) {
    const ca = num(values, 'ca');
    const va = num(values, 'va');
    const ct = num(values, 'ct');
    const k = num(values, 'k');
    const analyte = values.text.analyte as Analyte;
    if ([ca, va, ct].some((x) => x === null || Number.isNaN(x) || !(x! > 0))) return bad('chem.calc.positive');
    const weak = analyte === 'weakAcid' || analyte === 'weakBase';
    if (weak && (k === null || Number.isNaN(k) || !(k > 0))) return bad('chem.calc.needK');
    const titration: Titration = {
      analyte,
      concentration: ca!,
      volume: va!,
      k: weak ? k! : undefined,
      titrantConcentration: ct!,
    };
    const s = summary(titration);
    const eq = equivalenceVolume(titration);
    return ok(
      t('chem.calc.equivalence', { volume: sig(s.equivalence), ph: s.phEquivalence.toFixed(2) }),
      s.steps,
      <TitrationCurve titration={titration} equivalence={eq} />,
    );
  },
};

const unknownForm: Form = {
  name: 'unknown',
  fields: [
    field('ct', 'titrantConc', { initial: '0.1' }),
    field('vt', 'titrantVolume', { initial: '23.45' }),
    field('va', 'analyteVolume', { initial: '25' }),
    field('ratio', 'ratio', { initial: '1', help: t('chem.calc.ratioHelp') }),
  ],
  solve(values) {
    const [ct, vt, va, ratio] = ['ct', 'vt', 'va', 'ratio'].map((k) => num(values, k));
    if ([ct, vt, va, ratio].some((x) => x === null || Number.isNaN(x) || !(x! > 0))) return bad('chem.calc.positive');
    const out = unknownConcentration(ct!, vt!, va!, ratio!);
    return ok(`${sig(out.c)} M`, out.steps);
  },
};

export type CalcTab = 'balance' | 'molar' | 'stoich' | 'gas' | 'solution' | 'titration';

export const CALC_TABS: readonly CalcTab[] = ['balance', 'molar', 'stoich', 'gas', 'solution', 'titration'];

export const SUB_FORMS: Record<CalcTab, readonly { id: string; label: MessageKey; form: Form }[]> = {
  balance: [{ id: 'balance', label: 'chem.calc.tabs.balance', form: balanceForm }],
  molar: [{ id: 'molar', label: 'chem.calc.tabs.molar', form: molarForm }],
  stoich: [{ id: 'stoich', label: 'chem.calc.tabs.stoich', form: stoichForm }],
  gas: [
    { id: 'ideal', label: 'chem.calc.forms.ideal', form: idealForm },
    { id: 'combined', label: 'chem.calc.forms.combined', form: combinedForm },
    { id: 'graham', label: 'chem.calc.forms.graham', form: grahamForm },
    { id: 'density', label: 'chem.calc.forms.density', form: densityForm },
  ],
  solution: [
    { id: 'dilution', label: 'chem.calc.forms.dilution', form: dilutionForm },
    { id: 'molarity', label: 'chem.calc.forms.molarity', form: molarityForm },
    { id: 'ph', label: 'chem.calc.forms.ph', form: phForm },
    { id: 'buffer', label: 'chem.calc.forms.buffer', form: bufferForm },
  ],
  titration: [
    { id: 'curve', label: 'chem.calc.forms.curve', form: curveForm },
    { id: 'unknown', label: 'chem.calc.forms.unknown', form: unknownForm },
  ],
};
