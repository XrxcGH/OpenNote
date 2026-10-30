// The electric and magnetic fields tool. Its calculations, in the order the window lists them: point charges; Gauss's
// law; capacitors; capacitor combinations; Biot-Savart segments; current sources; the Lorentz force; induction.
import type { ToolSpec } from '../kit/types';
import { capacitorMode, chargesMode, combinationMode, gaussMode } from './electric';
import { inductionMode } from './induction';
import { forceMode, segmentsMode, sourcesMode } from './magnetic';

export const FIELDS: ToolSpec = {
  id: 'fields',
  modes: [chargesMode, gaussMode, capacitorMode, combinationMode, segmentsMode, sourcesMode, forceMode, inductionMode],
};
