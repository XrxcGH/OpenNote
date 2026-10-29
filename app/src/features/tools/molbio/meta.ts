// The tools of the molecular biology kit, in tab order. The window and the palette registration both read this list.
import type { IconName } from '../../../ui/icons';

export const MOLBIO_TOOLS = [
  { id: 'sequence', icon: 'Dna' },
  { id: 'cloning', icon: 'Scissors' },
  { id: 'protein', icon: 'Atom' },
  { id: 'align', icon: 'Rows' },
  { id: 'phylo', icon: 'TreeStructure' },
  { id: 'crosses', icon: 'GridFour' },
  { id: 'popgen', icon: 'ChartLine' },
] as const satisfies readonly {
  id: string;
  icon: IconName;
}[];

export type MolToolId = (typeof MOLBIO_TOOLS)[number]['id'];
