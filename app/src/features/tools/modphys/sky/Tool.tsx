// The sky positions and sun paths tool. Each calculation is a form over engine.ts. Together they cover time systems,
// coordinate conversions, rise and set times, sun-path diagrams, and shadows; they place the Sun, the Moon, and the
// planets, and they chart the bright stars.
import type { kitModPhys } from '../../../../strings/en/kitModPhys';
import { t } from '../../../../strings/t';
import { present } from '../shared/calc';
import type { Calc } from '../shared/calc';
import { textOf, value } from '../shared/form';
import type { FieldSpec, Values } from '../shared/form';
import { ToolForms } from '../shared/ToolForms';
import type { FormDef } from '../shared/ToolForms';
import { parseDate, parseTime } from './astro';
import {
  PLANET_SOURCES,
  SKY_SOURCES,
  STAR_SOURCES,
  convertCalc,
  moonCalc,
  planetsCalc,
  riseSet,
  shadow,
  skyChart,
  sunCalc,
  sunPath,
  timeCalc,
} from './engine';
import type { Site, SkyKey } from './engine';

type Field = keyof typeof kitModPhys.sky.f;
type Note = keyof typeof kitModPhys.sky.notes;

const label = (key: SkyKey) => t(`kitModPhys.sky.out.${key}`);
const f = (key: Field) => t(`kitModPhys.sky.f.${key}`);
const num = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), initial });
const text = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), kind: 'text', initial });
const cite = (sources: readonly string[], calc: Calc<SkyKey>, ...notes: Note[]) =>
  present(calc, label, [
    ...notes.map((note) => t(`kitModPhys.sky.notes.${note}`)),
    ...sources.map((name) => t('kitModPhys.form.source', { name })),
  ]);
const show = (calc: Calc<SkyKey>, ...notes: Note[]) => cite(SKY_SOURCES, calc, ...notes);

const site = (withTime = true): FieldSpec[] => [
  text('date', '2000-01-01'),
  ...(withTime ? [text('time', '12:00')] : []),
  num('zone', '0'),
  num('lat', '51.4769'),
  num('lon', '-0.0005'),
];
const siteOf = (v: Values, withTime = true): Site => ({
  date: parseDate(textOf(v, 'date')),
  time: withTime ? parseTime(textOf(v, 'time')) : 12,
  zone: value(v, 'zone', 'zone'),
  lat: value(v, 'lat', 'latitude'),
  lon: value(v, 'lon', 'longitude'),
});
const object = (v: Values) => ({ ra: value(v, 'ra', 'rightAscension'), dec: value(v, 'dec', 'declination') });

export const FORMS: readonly FormDef[] = [
  {
    id: 'time',
    label: 'kitModPhys.sky.calcs.time',
    fields: () => site(),
    solve: (v) => show(timeCalc(siteOf(v)), 'universal'),
  },
  {
    id: 'sun',
    label: 'kitModPhys.sky.calcs.sun',
    fields: () => site(),
    solve: (v) => show(sunCalc(siteOf(v)), 'sun'),
  },
  {
    id: 'moon',
    label: 'kitModPhys.sky.calcs.moon',
    fields: () => site(),
    solve: (v) => show(moonCalc(siteOf(v)), 'moon'),
  },
  {
    id: 'planets',
    label: 'kitModPhys.sky.calcs.planets',
    fields: () => site(),
    solve: (v) => cite([...PLANET_SOURCES, ...SKY_SOURCES], planetsCalc(siteOf(v)), 'planets', 'universal'),
  },
  {
    id: 'chart',
    label: 'kitModPhys.sky.calcs.chart',
    fields: () => [
      text('date', '2000-01-01'),
      text('time', '22:00'),
      num('zone', '0'),
      num('lat', '51.4769'),
      num('lon', '-0.0005'),
    ],
    solve: (v) => cite([...STAR_SOURCES, ...PLANET_SOURCES, ...SKY_SOURCES], skyChart(siteOf(v)), 'chart'),
  },
  {
    id: 'convert',
    label: 'kitModPhys.sky.calcs.convert',
    fields: () => [num('ra', '6.7525'), num('dec', '-16.7161'), ...site()],
    solve: (v) => show(convertCalc(object(v), siteOf(v)), 'j2000'),
  },
  {
    id: 'riseSet',
    label: 'kitModPhys.sky.calcs.riseSet',
    fields: () => [
      {
        id: 'object',
        label: f('object'),
        kind: 'select',
        options: [
          { value: 'sun', label: t('kitModPhys.sky.objects.sun') },
          { value: 'typed', label: t('kitModPhys.sky.objects.typed') },
        ],
      },
      num('ra', '6.7525'),
      num('dec', '-16.7161'),
      ...site(false),
    ],
    solve: (v) => show(riseSet(siteOf(v, false), textOf(v, 'object') === 'typed' ? object(v) : null), 'riseSet'),
  },
  {
    id: 'sunPath',
    label: 'kitModPhys.sky.calcs.sunPath',
    fields: () => [
      num('lat', '51.4769'),
      {
        id: 'projection',
        label: f('projection'),
        kind: 'select',
        options: [
          { value: 'cylindrical', label: t('kitModPhys.sky.projections.cylindrical') },
          { value: 'stereographic', label: t('kitModPhys.sky.projections.stereographic') },
        ],
      },
    ],
    solve: (v) => show(sunPath(value(v, 'lat', 'latitude'), textOf(v, 'projection') === 'stereographic'), 'sunPath'),
  },
  {
    id: 'shadow',
    label: 'kitModPhys.sky.calcs.shadow',
    fields: () => [...site(), num('height', '1'), num('wall', '180'), num('window', '1.5')],
    solve: (v) => {
      const sunNow = sunCalc(siteOf(v));
      const at = (key: SkyKey) => sunNow.items.find((one) => one.key === key)!.value;
      return show(
        shadow(
          at('alt'),
          at('az'),
          value(v, 'height', 'height'),
          value(v, 'wall', 'azimuth'),
          value(v, 'window', 'windowHeight'),
        ),
        'shadow',
      );
    },
  },
];

export default function SkyTool() {
  return <ToolForms tool="sky" forms={FORMS} />;
}
