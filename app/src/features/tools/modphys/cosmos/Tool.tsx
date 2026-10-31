// The cosmology, galaxies, and telescopes tool: distances and ages in an expanding universe, the Hubble law,
// rotation curves, telescope numbers, the CCD equation, and photons from a magnitude, each a form over engine.ts.
import type { kitModPhys } from '../../../../strings/en/kitModPhys';
import { t } from '../../../../strings/t';
import { present } from '../shared/calc';
import type { Calc } from '../shared/calc';
import { ASTRO, CONSTANT_SOURCES, MASS_SUN } from '../shared/constants';
import { optional, si, value } from '../shared/form';
import type { FieldSpec, Values } from '../shared/form';
import { ToolForms } from '../shared/ToolForms';
import type { FormDef } from '../shared/ToolForms';
import { AB_JY, COSMOS_SOURCES, ccd, cosmology, hubbleLaw, photons, rotation, telescope } from './engine';
import type { CosmosKey } from './engine';

type Field = keyof typeof kitModPhys.cosmos.f;
type Note = keyof typeof kitModPhys.cosmos.notes;

const label = (key: CosmosKey) => t(`kitModPhys.cosmos.out.${key}`);
const f = (key: Field) => t(`kitModPhys.cosmos.f.${key}`);
const num = (id: Field, initial: string): FieldSpec => ({ id, label: f(id), initial });
const show = (calc: Calc<CosmosKey>, ...notes: Note[]) =>
  present(calc, label, [
    ...notes.map((note) => t(`kitModPhys.cosmos.notes.${note}`)),
    ...[...COSMOS_SOURCES, ...CONSTANT_SOURCES].map((name) => t('kitModPhys.form.source', { name })),
  ]);

/** Solar masses per cubic parsec, in kg/m³. */
const SUN_PER_PC3 = MASS_SUN / ASTRO.pc ** 3;

const len = (id: Field, initial: string, unit: string): FieldSpec => ({
  id,
  label: f(id),
  dimension: 'length',
  initial,
  initialUnit: unit,
});
const far = (id: Field, initial: string): FieldSpec => ({
  id,
  label: f(id),
  dimension: 'distance',
  initial,
  initialUnit: 'kpc',
});
const mass = (id: Field, initial: string): FieldSpec => ({
  id,
  label: f(id),
  dimension: 'mass',
  initial,
  initialUnit: 'M☉',
});

export const FORMS: readonly FormDef[] = [
  {
    id: 'distances',
    label: 'kitModPhys.cosmos.calcs.distances',
    fields: () => [num('h0', '70'), num('om', '0.3'), num('or', '0'), num('ol', '0.7'), num('z', '1'), num('size', '')],
    solve: (v: Values) => {
      const size = optional(v, 'size', 'size', NaN);
      return show(
        cosmology(
          {
            h0: value(v, 'h0', 'hubble'),
            om: value(v, 'om', 'omegaM'),
            or: value(v, 'or', 'omegaR'),
            ol: value(v, 'ol', 'omegaL'),
          },
          value(v, 'z', 'redshift'),
          Number.isNaN(size) ? undefined : size,
        ),
        'distances',
      );
    },
  },
  {
    id: 'hubble',
    label: 'kitModPhys.cosmos.calcs.hubble',
    fields: () => [num('z', '0.5'), num('h0', '70')],
    solve: (v) => show(hubbleLaw(value(v, 'z', 'redshift'), value(v, 'h0', 'hubble')), 'hubble'),
  },
  {
    id: 'rotation',
    label: 'kitModPhys.cosmos.calcs.rotation',
    fields: () => [
      far('radius', '8'),
      mass('point', '1e10'),
      mass('disk', '5e10'),
      far('diskScale', '3'),
      num('isoRho', '0'),
      far('isoCore', '2'),
      num('nfwRho', '0.01'),
      far('nfwScale', '20'),
    ],
    solve: (v) =>
      show(
        rotation({
          r: si(v, 'radius', 'distance', 'radius'),
          point: si(v, 'point', 'mass', 'pointMass'),
          disk: si(v, 'disk', 'mass', 'diskMass'),
          diskScale: si(v, 'diskScale', 'distance', 'scaleLength'),
          isoRho: value(v, 'isoRho', 'density') * SUN_PER_PC3,
          isoCore: si(v, 'isoCore', 'distance', 'coreRadius'),
          nfwRho: value(v, 'nfwRho', 'density') * SUN_PER_PC3,
          nfwScale: si(v, 'nfwScale', 'distance', 'scaleRadius'),
        }),
        'rotation',
        'tullyFisher',
      ),
  },
  {
    id: 'telescope',
    label: 'kitModPhys.cosmos.calcs.telescope',
    fields: () => [
      len('aperture', '200', 'mm'),
      len('focal', '2000', 'mm'),
      len('pixel', '3.76', 'µm'),
      num('nx', '6248'),
      num('ny', '4176'),
      len('wavelength', '550', 'nm'),
      { id: 'seeing', label: f('seeing'), dimension: 'angle', initial: '2', initialUnit: 'arcsec' },
      len('eyepiece', '', 'mm'),
    ],
    solve: (v) => {
      const eyepiece = optional(v, 'eyepiece', 'eyepiece', 0);
      return show(
        telescope({
          d: si(v, 'aperture', 'length', 'aperture'),
          f: si(v, 'focal', 'length', 'focalLength'),
          pixel: si(v, 'pixel', 'length', 'pixel'),
          nx: value(v, 'nx', 'pixels'),
          ny: value(v, 'ny', 'pixels'),
          lambda: si(v, 'wavelength', 'length', 'wavelength'),
          seeing: si(v, 'seeing', 'angle', 'seeing'),
          eyepiece: eyepiece === 0 ? 0 : si(v, 'eyepiece', 'length', 'eyepiece'),
        }),
        'telescope',
      );
    },
  },
  {
    id: 'ccd',
    label: 'kitModPhys.cosmos.calcs.ccd',
    fields: () => [
      num('source', '100'),
      num('time', '30'),
      num('npix', '20'),
      num('sky', '5'),
      num('dark', '0.1'),
      num('read', '10'),
      num('gain', '1.5'),
      num('target', '100'),
    ],
    solve: (v) =>
      show(
        ccd({
          source: value(v, 'source', 'sourceRate'),
          time: value(v, 'time', 'exposure'),
          npix: value(v, 'npix', 'pixels'),
          sky: value(v, 'sky', 'skyRate'),
          dark: value(v, 'dark', 'darkRate'),
          read: value(v, 'read', 'readNoise'),
          gain: value(v, 'gain', 'gain'),
          target: value(v, 'target', 'snr'),
        }),
        'ccd',
      ),
  },
  {
    id: 'photons',
    label: 'kitModPhys.cosmos.calcs.photons',
    fields: () => [
      num('magnitude', '15'),
      num('zero', String(AB_JY)),
      len('wavelength', '550', 'nm'),
      len('band', '90', 'nm'),
      len('aperture', '200', 'mm'),
      num('obstruction', '0.3'),
      num('throughput', '0.5'),
    ],
    solve: (v) =>
      show(
        photons(
          value(v, 'magnitude', 'magnitude'),
          value(v, 'zero', 'zeroPoint'),
          si(v, 'wavelength', 'length', 'wavelength'),
          si(v, 'band', 'length', 'bandwidth'),
          si(v, 'aperture', 'length', 'aperture'),
          value(v, 'obstruction', 'obstruction'),
          value(v, 'throughput', 'throughput'),
        ),
        'zeroPoint',
      ),
  },
];

export default function CosmosTool() {
  return <ToolForms tool="cosmos" forms={FORMS} />;
}
