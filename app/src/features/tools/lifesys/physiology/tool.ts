// The physiology tool's calculations: what each form asks for, and which engine answers it. Pressures convert to
// mmHg, volumes to mL, flows to mL/min, and temperatures to °C before an engine runs.
import type { CalcSpec, FieldSpec, Reader, ToolSpec } from '../types';
import {
  acidBaseResult,
  alveolarResult,
  bmrResult,
  cardiacOutputResult,
  clearanceResult,
  couplingResult,
  contentResult,
  dissociationResult,
  ejectionResult,
  exerciseResult,
  fluidResult,
  kroghResult,
  laplaceResult,
  lmsResult,
  macroResult,
  osmolarityResult,
  pressureResult,
  pvLoopResult,
  resistanceResult,
  starlingResult,
  titrationResult,
  tubuleResult,
  ventilationResult,
  waterPotentialResult,
  type Activity,
} from './engine';
import { growthLms, type GrowthMeasure, type GrowthSex } from './growth';

const num = (id: string, label: FieldSpec['label'], initial: string, extra: Partial<FieldSpec> = {}): FieldSpec => ({
  id,
  label,
  initial,
  ...extra,
});
const opt = (id: string, label: FieldSpec['label'], extra: Partial<FieldSpec> = {}): FieldSpec =>
  num(id, label, '', { optional: true, ...extra });
const mmHg = { unit: 'pressure' } as const;
const select = (id: string, label: FieldSpec['label'], options: [string, FieldSpec['label']][]): FieldSpec => ({
  id,
  label,
  kind: 'select',
  options: options.map(([value, l]) => ({ value, label: l })),
});
const list = (read: Reader, id: string): number[] => (read.text(id).trim() === '' ? [] : read.rows(id).flat());

const cardio: CalcSpec[] = [
  {
    id: 'cardiacOutput',
    label: 'physiology.c.cardiacOutput',
    fields: (choice) => [
      select('mode', 'physiology.f.coMode', [
        ['hrsv', 'physiology.o.hrsv'],
        ['fick', 'physiology.o.fick'],
      ]),
      ...(choice('mode') === 'fick'
        ? [
            num('vo2', 'physiology.f.vo2', '250', { unit: 'flow' }),
            num('ca', 'physiology.f.cao2', '20'),
            num('cv', 'physiology.f.cvo2', '15'),
          ]
        : [num('hr', 'physiology.f.hr', '70'), num('sv', 'physiology.f.sv', '70', { unit: 'volume' })]),
    ],
    solve: (read) => {
      const fick = read.choice('mode') === 'fick';
      return cardiacOutputResult(
        fick ? 'fick' : 'hrsv',
        fick ? 0 : read.num('hr'),
        fick ? 0 : read.num('sv'),
        fick ? read.num('vo2') : 0,
        fick ? read.num('ca') : 0,
        fick ? read.num('cv') : 0,
      );
    },
  },
  {
    id: 'pressure',
    label: 'physiology.c.pressure',
    fields: [
      num('sys', 'physiology.f.sbp', '120', mmHg),
      num('dia', 'physiology.f.dbp', '80', mmHg),
      opt('co', 'physiology.f.co', { help: 'physiology.h.svr' }),
      opt('cvp', 'physiology.f.cvp', mmHg),
    ],
    solve: (read) => pressureResult(read.num('sys'), read.num('dia'), read.opt('cvp'), read.opt('co')),
  },
  {
    id: 'ejection',
    label: 'physiology.c.ejection',
    fields: [
      num('edv', 'physiology.f.edv', '120', { unit: 'volume' }),
      num('esv', 'physiology.f.esv', '50', { unit: 'volume' }),
      opt('hr', 'physiology.f.hr'),
    ],
    solve: (read) => ejectionResult(read.num('edv'), read.num('esv'), read.opt('hr')),
  },
  {
    id: 'resistance',
    label: 'physiology.c.resistance',
    fields: (choice) => {
      const mode = choice('mode') || 'flow';
      return [
        select('mode', 'physiology.f.resistanceMode', [
          ['flow', 'physiology.o.fromFlow'],
          ['series', 'physiology.o.series'],
          ['parallel', 'physiology.o.parallel'],
          ['poiseuille', 'physiology.o.poiseuille'],
        ]),
        ...(mode === 'series' || mode === 'parallel'
          ? [
              {
                id: 'list',
                label: 'physiology.f.resistances',
                kind: 'data',
                initial: '2 3 6',
                help: 'physiology.h.resistances',
              } as FieldSpec,
            ]
          : []),
        ...(mode === 'flow' || mode === 'poiseuille'
          ? [
              num('dp', mode === 'flow' ? 'physiology.f.dp' : 'physiology.f.dpOptional', mode === 'flow' ? '90' : '', {
                ...mmHg,
                optional: mode !== 'flow',
              }),
            ]
          : []),
        ...(mode === 'flow' ? [num('q', 'physiology.f.q', '5000', { unit: 'flow' })] : []),
        ...(mode === 'poiseuille'
          ? [
              num('eta', 'physiology.f.eta', '3.5'),
              num('length', 'physiology.f.length', '1'),
              num('radius', 'physiology.f.radius', '0.01', { unit: 'radius' }),
            ]
          : []),
      ];
    },
    solve: (read) => {
      const mode = (read.choice('mode') || 'flow') as 'flow' | 'series' | 'parallel' | 'poiseuille';
      const poise = mode === 'poiseuille';
      return resistanceResult(mode, {
        dp: mode === 'flow' ? read.num('dp') : poise ? (read.opt('dp') ?? 0) : 0,
        q: mode === 'flow' ? read.num('q') : 0,
        list: mode === 'series' || mode === 'parallel' ? list(read, 'list') : [],
        eta: poise ? read.num('eta') : 0,
        length: poise ? read.num('length') : 0,
        radius: poise ? read.num('radius') : 0,
      });
    },
  },
  {
    id: 'laplace',
    label: 'physiology.c.laplace',
    fields: [
      select('shape', 'physiology.f.shape', [
        ['sphere', 'physiology.o.sphere'],
        ['cylinder', 'physiology.o.cylinder'],
      ]),
      num('p', 'physiology.f.transmural', '100', mmHg),
      num('r', 'physiology.f.vesselRadius', '2.5', { unit: 'radius' }),
      opt('h', 'physiology.f.wall', { unit: 'radius' }),
      opt('dv', 'physiology.f.dv'),
      opt('dpc', 'physiology.f.dpc', mmHg),
    ],
    solve: (read) =>
      laplaceResult(
        read.choice('shape') === 'cylinder' ? 'cylinder' : 'sphere',
        read.num('p'),
        read.num('r'),
        read.opt('h'),
        read.opt('dv'),
        read.opt('dpc'),
      ),
  },
  {
    id: 'pvLoop',
    label: 'physiology.c.pvLoop',
    intro: 'physiology.i.pvLoop',
    manual: true,
    fields: [
      num('hr', 'physiology.f.hr', '75'),
      num('ts', 'physiology.f.systole', '0.3'),
      num('emax', 'physiology.f.emax', '2.5'),
      num('emin', 'physiology.f.emin', '0.08'),
      num('v0', 'physiology.f.v0', '10'),
      num('pla', 'physiology.f.pla', '8', mmHg),
      num('rmv', 'physiology.f.rmv', '0.005'),
      num('rao', 'physiology.f.rao', '0.01'),
      num('rs', 'physiology.f.rs', '1'),
      num('c', 'physiology.f.arterialC', '1.6'),
      num('beats', 'physiology.f.beats', '10'),
    ],
    solve: (read) =>
      pvLoopResult({
        hr: read.num('hr'),
        ts: read.num('ts'),
        emax: read.num('emax'),
        emin: read.num('emin'),
        v0: read.num('v0'),
        pla: read.num('pla'),
        rmv: read.num('rmv'),
        rao: read.num('rao'),
        rs: read.num('rs'),
        c: read.num('c'),
        beats: read.num('beats'),
      }),
  },
  {
    id: 'coupling',
    label: 'physiology.c.coupling',
    fields: [
      num('ees', 'physiology.f.ees', '2'),
      num('v0', 'physiology.f.v0', '10'),
      num('edv', 'physiology.f.edv', '120', { unit: 'volume' }),
      num('ea', 'physiology.f.ea', '2'),
    ],
    solve: (read) => couplingResult(read.num('ees'), read.num('v0'), read.num('edv'), read.num('ea')),
  },
];

const respiratory: CalcSpec[] = [
  {
    id: 'alveolar',
    label: 'physiology.c.alveolar',
    fields: [
      num('fio2', 'physiology.f.fio2', '0.21'),
      num('patm', 'physiology.f.patm', '760', mmHg),
      num('ph2o', 'physiology.f.ph2o', '47', mmHg),
      num('paco2', 'physiology.f.paco2', '40', mmHg),
      num('r', 'physiology.f.rq', '0.8'),
      opt('pao2', 'physiology.f.pao2Optional', mmHg),
      opt('age', 'physiology.f.ageOptional'),
    ],
    solve: (read) =>
      alveolarResult(
        read.num('fio2'),
        read.num('patm'),
        read.num('ph2o'),
        read.num('paco2'),
        read.num('r'),
        read.opt('pao2'),
        read.opt('age'),
      ),
  },
  {
    id: 'content',
    label: 'physiology.c.content',
    fields: [
      num('hb', 'physiology.f.hb', '15'),
      num('sao2', 'physiology.f.sao2', '0.98'),
      num('pao2', 'physiology.f.pao2', '100', mmHg),
      opt('co', 'physiology.f.co'),
    ],
    solve: (read) => contentResult(read.num('hb'), read.num('sao2'), read.num('pao2'), read.opt('co')),
  },
  {
    id: 'dissociation',
    label: 'physiology.c.dissociation',
    fields: [
      num('po2', 'physiology.f.po2', '40', mmHg),
      num('ph', 'physiology.f.ph', '7.4'),
      num('pco2', 'physiology.f.pco2', '40', mmHg),
      num('T', 'physiology.f.T', '37', { unit: 'temperature' }),
    ],
    solve: (read) => dissociationResult(read.num('po2'), read.num('ph'), read.num('pco2'), read.num('T')),
  },
  {
    id: 'ventilation',
    label: 'physiology.c.ventilation',
    fields: [
      num('vt', 'physiology.f.vt', '500', { unit: 'volume' }),
      num('rr', 'physiology.f.rr', '12'),
      opt('vd', 'physiology.f.vd', { unit: 'volume' }),
      opt('paco2', 'physiology.f.paco2Optional', mmHg),
      opt('peco2', 'physiology.f.peco2', mmHg),
    ],
    solve: (read) =>
      ventilationResult(read.num('vt'), read.num('rr'), read.opt('vd'), read.opt('paco2'), read.opt('peco2')),
  },
  {
    id: 'krogh',
    label: 'physiology.c.krogh',
    intro: 'physiology.i.krogh',
    fields: [
      num('pc', 'physiology.f.pcO2', '40', mmHg),
      num('rc', 'physiology.f.rcUm', '3'),
      num('R', 'physiology.f.rUm', '30'),
      num('m', 'physiology.f.uptake', '5'),
      num('d', 'physiology.f.diffusion', '1.5e-5'),
      num('alpha', 'physiology.f.solubility', '3e-5'),
      opt('hb', 'physiology.f.hbOptional'),
      opt('speed', 'physiology.f.speed'),
      opt('length', 'physiology.f.capLength'),
    ],
    solve: (read) =>
      kroghResult({
        pc: read.num('pc'),
        rcUm: read.num('rc'),
        rUm: read.num('R'),
        m: read.num('m'),
        d: read.num('d'),
        alpha: read.num('alpha'),
        hb: read.opt('hb'),
        speed: read.opt('speed'),
        length: read.opt('length'),
      }),
  },
];

const renal: CalcSpec[] = [
  {
    id: 'clearance',
    label: 'physiology.c.clearance',
    fields: [
      num('u', 'physiology.f.u', '30'),
      num('v', 'physiology.f.urineFlow', '1', { unit: 'flow' }),
      num('p', 'physiology.f.p', '0.25'),
      opt('pahU', 'physiology.f.pahU'),
      opt('pahP', 'physiology.f.pahP'),
      opt('hct', 'physiology.f.hct'),
    ],
    solve: (read) =>
      clearanceResult(read.num('u'), read.num('v'), read.num('p'), read.opt('pahU'), read.opt('pahP'), read.opt('hct')),
  },
  {
    id: 'tubule',
    label: 'physiology.c.tubule',
    fields: [
      num('uNa', 'physiology.f.uNa', '40'),
      num('pNa', 'physiology.f.pNa', '140'),
      num('uCr', 'physiology.f.uCr', '100'),
      num('pCr', 'physiology.f.pCr', '1'),
      opt('v', 'physiology.f.urineFlowOptional', { unit: 'flow' }),
      opt('uOsm', 'physiology.f.uOsm'),
      opt('pOsm', 'physiology.f.pOsm'),
    ],
    solve: (read) =>
      tubuleResult(
        read.num('uNa'),
        read.num('pNa'),
        read.num('uCr'),
        read.num('pCr'),
        read.opt('v'),
        read.opt('uOsm'),
        read.opt('pOsm'),
      ),
  },
  {
    id: 'titration',
    label: 'physiology.c.titration',
    fields: [
      num('gfr', 'physiology.f.gfr', '125', { unit: 'flow' }),
      num('p', 'physiology.f.glucose', '300'),
      num('tm', 'physiology.f.tm', '375'),
      num('theta', 'physiology.f.theta', '0.98', { help: 'physiology.h.theta' }),
    ],
    solve: (read) => titrationResult(read.num('gfr'), read.num('p'), read.num('tm'), read.num('theta')),
  },
  {
    id: 'acidBase',
    label: 'physiology.c.acidBase',
    fields: [
      num('hco3', 'physiology.f.hco3', '24'),
      num('pco2', 'physiology.f.pco2', '40', mmHg),
      select('time', 'physiology.f.duration', [
        ['acute', 'physiology.o.acute'],
        ['chronic', 'physiology.o.chronic'],
      ]),
      opt('na', 'physiology.f.na'),
      opt('cl', 'physiology.f.cl'),
      opt('alb', 'physiology.f.albumin'),
    ],
    solve: (read) =>
      acidBaseResult(
        read.num('hco3'),
        read.num('pco2'),
        read.choice('time') === 'chronic',
        read.opt('na'),
        read.opt('cl'),
        read.opt('alb'),
      ),
  },
];

const body: CalcSpec[] = [
  {
    id: 'osmolarity',
    label: 'physiology.c.osmolarity',
    fields: [
      num('na', 'physiology.f.naPlasma', '140'),
      num('glu', 'physiology.f.glucoseMg', '90'),
      num('bun', 'physiology.f.bun', '14'),
      opt('measured', 'physiology.f.measuredOsm'),
    ],
    solve: (read) => osmolarityResult(read.num('na'), read.num('glu'), read.num('bun'), read.opt('measured')),
  },
  {
    id: 'fluid',
    label: 'physiology.c.fluid',
    fields: [
      num('w', 'physiology.f.weight', '70', { unit: 'bodyMass' }),
      num('tbw', 'physiology.f.tbw', '0.6'),
      num('osm', 'physiology.f.osmStart', '290'),
      num('v', 'physiology.f.infused', '1'),
      num('fosm', 'physiology.f.fluidOsm', '308', { help: 'physiology.h.fluidOsm' }),
    ],
    solve: (read) => fluidResult(read.num('w'), read.num('tbw'), read.num('osm'), read.num('v'), read.num('fosm')),
  },
  {
    id: 'starling',
    label: 'physiology.c.starling',
    fields: [
      num('pc', 'physiology.f.pc', '32', mmHg),
      num('pi', 'physiology.f.pi', '1', mmHg),
      num('oc', 'physiology.f.oc', '25', mmHg),
      num('oi', 'physiology.f.oi', '3', mmHg),
      num('sigma', 'physiology.f.sigma', '0.9'),
      num('kf', 'physiology.f.kf', '1'),
    ],
    solve: (read) =>
      starlingResult(read.num('pc'), read.num('pi'), read.num('oc'), read.num('oi'), read.num('sigma'), read.num('kf')),
  },
  {
    id: 'bmr',
    label: 'physiology.c.bmr',
    fields: [
      select('sex', 'physiology.f.sex', [
        ['male', 'physiology.o.male'],
        ['female', 'physiology.o.female'],
      ]),
      num('w', 'physiology.f.weight', '70', { unit: 'bodyMass' }),
      num('h', 'physiology.f.height', '175', { unit: 'height' }),
      num('age', 'physiology.f.age', '25'),
      select('activity', 'physiology.f.activity', [
        ['sedentary', 'physiology.o.sedentary'],
        ['light', 'physiology.o.light'],
        ['moderate', 'physiology.o.moderate'],
        ['active', 'physiology.o.active'],
        ['veryActive', 'physiology.o.veryActive'],
      ]),
    ],
    solve: (read) =>
      bmrResult(
        read.choice('sex') === 'female' ? 'female' : 'male',
        read.num('w'),
        read.num('h'),
        read.num('age'),
        (read.choice('activity') || 'sedentary') as Activity,
      ),
  },
  {
    id: 'macros',
    label: 'physiology.c.macros',
    fields: [
      num('carb', 'physiology.f.carb', '250'),
      num('protein', 'physiology.f.protein', '80'),
      num('fat', 'physiology.f.fat', '70'),
      num('alcohol', 'physiology.f.alcohol', '0'),
    ],
    solve: (read) => macroResult(read.num('carb'), read.num('protein'), read.num('fat'), read.num('alcohol')),
  },
  {
    id: 'exercise',
    label: 'physiology.c.exercise',
    fields: [
      opt('vo2', 'physiology.f.vo2kg', { initial: '35' }),
      opt('vco2', 'physiology.f.vco2kg', { initial: '30' }),
      opt('age', 'physiology.f.ageOptional', { initial: '25' }),
      opt('rest', 'physiology.f.hrRest', { initial: '60' }),
      opt('intensity', 'physiology.f.intensity', { initial: '70' }),
    ],
    solve: (read) =>
      exerciseResult(read.opt('vo2'), read.opt('vco2'), read.opt('age'), read.opt('rest'), read.opt('intensity')),
  },
  {
    id: 'lms',
    label: 'physiology.c.lms',
    intro: 'physiology.i.lms',
    fields: (choice) => [
      select('source', 'physiology.f.lmsSource', [
        ['tables', 'physiology.o.lmsTables'],
        ['manual', 'physiology.o.lmsManual'],
      ]),
      ...(choice('source') === 'manual'
        ? [
            num('x', 'physiology.f.x', '20'),
            num('l', 'physiology.f.l', '-1.5'),
            num('m', 'physiology.f.m', '17'),
            num('s', 'physiology.f.s', '0.12'),
          ]
        : [
            select('measure', 'physiology.f.lmsMeasure', [
              ['bmi', 'physiology.o.lmsBmi'],
              ['weight', 'physiology.o.lmsWeight'],
              ['stature', 'physiology.o.lmsStature'],
            ]),
            select('sex', 'physiology.f.sex', [
              ['female', 'physiology.o.female'],
              ['male', 'physiology.o.male'],
            ]),
            num('age', 'physiology.f.age', '10'),
            num('x', 'physiology.f.x', '20'),
          ]),
      opt('p', 'physiology.f.percentileOptional'),
    ],
    solve: (read) => {
      if (read.choice('source') === 'manual') {
        return lmsResult(read.num('x'), read.num('l'), read.num('m'), read.num('s'), read.opt('p'));
      }
      const years = read.num('age');
      const measure = (read.choice('measure') || 'bmi') as GrowthMeasure;
      const sex = (read.choice('sex') || 'female') as GrowthSex;
      const { l, m, s } = growthLms(measure, sex, years * 12);
      return lmsResult(read.num('x'), l, m, s, read.opt('p'), { years });
    },
  },
  {
    id: 'water',
    label: 'physiology.c.water',
    fields: [
      num('c', 'physiology.f.molarity', '0.1'),
      num('i', 'physiology.f.vantHoff', '1', { help: 'physiology.h.vantHoff' }),
      num('T', 'physiology.f.T', '21.85', { unit: 'temperature' }),
      num('psiP', 'physiology.f.psiP', '0'),
    ],
    solve: (read) => waterPotentialResult(read.num('i'), read.num('c'), read.num('T'), read.num('psiP')),
  },
];

export const tool: ToolSpec = { calcs: [...cardio, ...respiratory, ...renal, ...body], clinical: true };
