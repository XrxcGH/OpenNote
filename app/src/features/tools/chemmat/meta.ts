// The tools of the kit, by name: the id, the strings, and the icon. The palette reads this list at start-up, so it
// holds no engines; each tool's code loads with the window (see tools.ts).
import type { MessageKey } from '../../../strings/t';

export interface ChemMatMeta {
  id: string;
  title: MessageKey;
  open: MessageKey;
  keywords: MessageKey;
  icon: string;
}

export const CHEMMAT_META: readonly ChemMatMeta[] = [
  {
    id: 'thermochem',
    title: 'kitChemMat.thermo.title',
    open: 'kitChemMat.thermo.open',
    keywords: 'kitChemMat.thermo.keywords',
    icon: 'Flask',
  },
  {
    id: 'equilibrium',
    title: 'kitChemMat.eq.title',
    open: 'kitChemMat.eq.open',
    keywords: 'kitChemMat.eq.keywords',
    icon: 'Flask',
  },
  {
    id: 'acidbase',
    title: 'kitChemMat.ab.title',
    open: 'kitChemMat.ab.open',
    keywords: 'kitChemMat.ab.keywords',
    icon: 'Flask',
  },
  {
    id: 'electrochem',
    title: 'kitChemMat.ec.title',
    open: 'kitChemMat.ec.open',
    keywords: 'kitChemMat.ec.keywords',
    icon: 'Flask',
  },
  {
    id: 'kinetics',
    title: 'kitChemMat.kin.title',
    open: 'kitChemMat.kin.open',
    keywords: 'kitChemMat.kin.keywords',
    icon: 'Flask',
  },
  {
    id: 'solutions',
    title: 'kitChemMat.sol.title',
    open: 'kitChemMat.sol.open',
    keywords: 'kitChemMat.sol.keywords',
    icon: 'Flask',
  },
  {
    id: 'crystals',
    title: 'kitChemMat.cx.title',
    open: 'kitChemMat.cx.open',
    keywords: 'kitChemMat.cx.keywords',
    icon: 'Flask',
  },
  {
    id: 'diffusion',
    title: 'kitChemMat.df.title',
    open: 'kitChemMat.df.open',
    keywords: 'kitChemMat.df.keywords',
    icon: 'Flask',
  },
];
