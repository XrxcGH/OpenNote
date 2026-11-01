// The spacecraft sizing tool's radio calculations: a link budget from transmitter to Eb/N0 margin, and a passive
// RFID tag's read range.
import '../text';
import type { MessageKey } from '../../../../strings/t';
import { fmt, q, qIn } from '../kit/format';
import type { KitStep, ModeDef, Outcome, ResultRow } from '../kit/types';
import { BOLTZMANN_DB, db, dishGain, freeSpaceLoss, linkBudget, rfidRange } from './engine';

const K = 'kitPhysics.spacecraft';
const dB = (value: number, unit = 'dB') => q(value, unit, 4);
const dbField = (id: string, label: MessageKey, initial: string, optional = false) => ({
  id,
  label,
  initial,
  ...(optional ? { optional: true } : {}),
});
const dbRow = (key: MessageKey, symbol: string, value: number, unit = 'dB', primary = false): ResultRow => ({
  key,
  symbol,
  value,
  unit,
  digits: 5,
  primary,
});

export const linkMode: ModeDef = {
  id: 'link',
  label: `${K}.modes.link`,
  fields: [
    { id: 'frequency', label: `${K}.f.frequency`, dim: 'frequency', unit: 'GHz', initial: '2.2' },
    { id: 'power', label: `${K}.f.txPower`, dim: 'power', unit: 'W', usUnit: 'W', initial: '5' },
    dbField('txGain', `${K}.f.txGain`, '6'),
    dbField('txLoss', `${K}.f.txLoss`, '1'),
    { id: 'distance', label: `${K}.f.distance`, dim: 'length', unit: 'km', usUnit: 'mi', initial: '1000' },
    dbField('otherLoss', `${K}.f.otherLoss`, '2'),
    dbField('rxGain', `${K}.f.rxGain`, '35'),
    {
      id: 'dish',
      label: `${K}.f.dish`,
      dim: 'length',
      unit: 'm',
      usUnit: 'ft',
      initial: '',
      optional: true,
      help: `${K}.help.dish`,
    },
    { id: 'efficiency', label: `${K}.f.dishEfficiency`, initial: '55' },
    { id: 'Ts', label: `${K}.f.noiseTemperature`, dim: 'temperature', unit: 'K', usUnit: 'K', initial: '200' },
    { id: 'rate', label: `${K}.f.rate`, dim: 'dataRate', unit: 'Mbit/s', initial: '1' },
    dbField('required', `${K}.f.required`, '9.6'),
  ],
  solve(read): Outcome {
    const frequency = read.num('frequency', 'positive');
    const dish = read.opt('dish', 'positive');
    const efficiency = read.num('efficiency', { above: 0, max: 100 }) / 100;
    const rxGain = dish === null ? read.num('rxGain') : dishGain(dish, frequency, efficiency);
    const input = {
      frequency,
      power: read.num('power', 'positive'),
      txGain: read.num('txGain'),
      txLoss: read.num('txLoss', 'nonNegative'),
      distance: read.num('distance', 'positive'),
      otherLoss: read.num('otherLoss', 'nonNegative'),
      rxGain,
      noiseTemperature: read.num('Ts', 'positive'),
      rate: read.num('rate', 'positive'),
      required: read.num('required'),
    };
    const out = linkBudget(input);
    const steps: KitStep[] = [
      {
        key: `${K}.s.eirp`,
        vars: {
          P: dB(out.powerDb, 'dBW'),
          Gt: dB(input.txGain, 'dBi'),
          Lt: dB(input.txLoss),
          eirp: dB(out.eirp, 'dBW'),
        },
      },
      {
        key: `${K}.s.fspl`,
        vars: { d: qIn(input.distance, 'length', 'km'), f: qIn(frequency, 'frequency', 'GHz'), L: dB(out.path) },
      },
    ];
    if (dish !== null)
      steps.push({
        key: `${K}.s.dish`,
        vars: { eta: fmt(efficiency), D: q(dish, 'm'), f: qIn(frequency, 'frequency', 'GHz'), G: dB(rxGain, 'dBi') },
      });
    steps.push(
      {
        key: `${K}.s.gOverT`,
        vars: { G: dB(rxGain, 'dBi'), Ts: q(input.noiseTemperature, 'K'), GT: dB(out.gOverT, 'dB/K') },
      },
      {
        key: `${K}.s.cn0`,
        vars: {
          eirp: dB(out.eirp, 'dBW'),
          L: dB(out.path),
          La: dB(input.otherLoss),
          GT: dB(out.gOverT, 'dB/K'),
          k: dB(BOLTZMANN_DB, 'dBW/(K·Hz)'),
          cn0: dB(out.cn0, 'dB·Hz'),
        },
      },
      {
        key: `${K}.s.ebn0`,
        vars: { cn0: dB(out.cn0, 'dB·Hz'), R: dB(db(input.rate), 'dB·bit/s'), ebn0: dB(out.ebn0) },
      },
      { key: `${K}.s.margin`, vars: { ebn0: dB(out.ebn0), req: dB(input.required), margin: dB(out.margin) } },
    );
    return {
      ok: true,
      rows: [
        dbRow(`${K}.r.margin`, 'M', out.margin, 'dB', true),
        dbRow(`${K}.r.ebn0`, 'Eb/N₀', out.ebn0, 'dB', true),
        dbRow(`${K}.r.eirp`, 'EIRP', out.eirp, 'dBW'),
        dbRow(`${K}.r.fspl`, 'L_s', out.path),
        dbRow(`${K}.r.received`, 'P_r', out.received, 'dBW'),
        dbRow(`${K}.r.gOverT`, 'G/T', out.gOverT, 'dB/K'),
        dbRow(`${K}.r.cn0`, 'C/N₀', out.cn0, 'dB·Hz'),
        ...(dish !== null ? [dbRow(`${K}.r.rxGain`, 'G_r', rxGain, 'dBi')] : []),
        {
          key: `${K}.r.closes`,
          value: '',
          word: out.margin >= 3 ? `${K}.kind.closes` : out.margin >= 0 ? `${K}.kind.thin` : `${K}.kind.fails`,
        },
      ],
      latex:
        '\\frac{E_b}{N_0}=\\mathrm{EIRP}-L_s-L_a+\\frac{G}{T}-10\\log_{10}k-10\\log_{10}R,\\qquad L_s=20\\log_{10}\\frac{4\\pi df}{c}',
      steps,
      notes: [{ key: `${K}.notes.link` }],
    };
  },
};

export const rfidMode: ModeDef = {
  id: 'rfid',
  label: `${K}.modes.rfid`,
  fields: [
    { id: 'frequency', label: `${K}.f.frequency`, dim: 'frequency', unit: 'MHz', initial: '915' },
    dbField('eirp', `${K}.f.readerEirp`, '36'),
    dbField('tagGain', `${K}.f.tagGain`, '2.15'),
    dbField('sensitivity', `${K}.f.tagSensitivity`, '-18'),
    dbField('loss', `${K}.f.rfidLoss`, '0'),
    dbField('readerGain', `${K}.f.readerGain`, '', true),
    dbField('readerSensitivity', `${K}.f.readerSensitivity`, '', true),
    dbField('backscatter', `${K}.f.backscatter`, '', true),
  ],
  solve(read): Outcome {
    const frequency = read.num('frequency', 'positive');
    const readerGain = read.opt('readerGain');
    const readerSensitivity = read.opt('readerSensitivity');
    const backscatter = read.opt('backscatter', 'nonNegative');
    const input = {
      frequency,
      eirp: read.num('eirp'),
      tagGain: read.num('tagGain'),
      tagSensitivity: read.num('sensitivity'),
      loss: read.num('loss', 'nonNegative'),
      ...(readerGain !== null && readerSensitivity !== null ? { readerGain, readerSensitivity } : {}),
      ...(backscatter !== null ? { backscatterLoss: backscatter } : {}),
    };
    const out = rfidRange(input);
    const rows: ResultRow[] = [
      { key: `${K}.r.readRange`, symbol: 'r', value: out.range, dim: 'length', unit: 'm', usUnit: 'ft', primary: true },
      { key: `${K}.r.forward`, symbol: 'r_fwd', value: out.forward, dim: 'length', unit: 'm', usUnit: 'ft' },
      ...(out.reverse !== undefined
        ? [
            {
              key: `${K}.r.reverse` as MessageKey,
              symbol: 'r_rev',
              value: out.reverse,
              dim: 'length' as const,
              unit: 'm',
              usUnit: 'ft',
            },
          ]
        : []),
      { key: `${K}.r.wavelength`, symbol: 'λ', value: out.lambda, dim: 'length', unit: 'cm', usUnit: 'in' },
      dbRow(`${K}.r.fsplAt`, 'L_s', freeSpaceLoss(out.range, frequency)),
    ];
    const budget = input.eirp + input.tagGain - input.loss - input.tagSensitivity;
    const steps: KitStep[] = [
      {
        key: `${K}.s.wavelength`,
        vars: { f: qIn(frequency, 'frequency', 'MHz'), lambda: qIn(out.lambda, 'length', 'cm') },
      },
      {
        key: `${K}.s.forward`,
        vars: {
          eirp: dB(input.eirp, 'dBm'),
          G: dB(input.tagGain, 'dBi'),
          L: dB(input.loss),
          S: dB(input.tagSensitivity, 'dBm'),
          budget: dB(budget),
          r: qIn(out.forward, 'length', 'm'),
        },
      },
    ];
    if (out.reverse !== undefined) steps.push({ key: `${K}.s.reverse`, vars: { r: qIn(out.reverse, 'length', 'm') } });
    return {
      ok: true,
      rows,
      latex: 'r=\\frac{\\lambda}{4\\pi}\\,10^{(\\mathrm{EIRP}+G_t-L-P_{min})/20}',
      steps,
      notes: [{ key: `${K}.notes.rfid` }],
    };
  },
};
