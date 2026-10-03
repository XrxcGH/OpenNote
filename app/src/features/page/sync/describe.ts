// What an undo or redo did, in words (ARCHITECTURE.md section 10.5; owner: WP2): "Undid moving a text box." or
// "Redid deleting 2 blocks.". It compares the frame with the blocks as the sync knew them before the frame.
import type { AppliedFrame } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import type { Mirror } from './mirror';

type Action = 'editing' | 'moving' | 'adding' | 'deleting';

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The sentence for the step, or null when the frame changed nothing the person can see. */
export function describeStep(frame: AppliedFrame, mirror: Mirror, direction: 'undo' | 'redo'): string | null {
  const back = frame.blocks.filter((block) => !mirror.get(block.id));
  const kept = frame.blocks.filter((block) => mirror.get(block.id));
  const moved = kept.filter((block) => {
    const was = mirror.get(block.id);
    return !same(was?.frame, block.frame) || was?.order !== block.order;
  });
  let action: Action;
  let types: string[];
  if (frame.removed.length > 0 && frame.blocks.length === 0) {
    // Undo takes away what the step added; redo takes away what it deleted.
    action = direction === 'undo' ? 'adding' : 'deleting';
    types = frame.removed.map((id) => mirror.get(id)?.type ?? 'block');
  } else if (back.length > 0 && kept.length === 0 && frame.removed.length === 0) {
    action = direction === 'undo' ? 'deleting' : 'adding';
    types = back.map((block) => block.type);
  } else if (frame.blocks.length > 0 && moved.length === frame.blocks.length) {
    action = 'moving';
    types = moved.map((block) => block.type);
  } else if (frame.blocks.length > 0 || frame.removed.length > 0) {
    action = 'editing';
    types = [...frame.blocks.map((block) => block.type), ...frame.removed.map((id) => mirror.get(id)?.type ?? '')];
  } else {
    return frame.page ? t(direction === 'undo' ? 'pageSync.undid.page' : 'pageSync.redid.page') : null;
  }
  const values = { count: types.length, thing: types.length === 1 ? types[0] : 'other' };
  return direction === 'undo' ? t(`pageSync.undid.${action}`, values) : t(`pageSync.redid.${action}`, values);
}
