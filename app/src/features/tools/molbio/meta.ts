// The tools of the molecular biology kit, in tab order. The window and the palette registration both read this list.
import type { IconName } from '../../../ui/icons';

export const MOLBIO_TOOLS = [
  { id: 'sequence', icon: 'Dna' },
  { id: 'protein', icon: 'Atom' },
  { id: 'align', icon: 'Rows' },
  { id: 'crosses', icon: 'GridFour' },
] as const satisfies readonly {
  id: string;
  icon: IconName;
}[];

export type MolToolId = (typeof MOLBIO_TOOLS)[number]['id'];
