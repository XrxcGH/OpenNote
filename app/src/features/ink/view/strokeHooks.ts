// What happens around a finished pen stroke beyond storing it: a pen edit of typed text may take the stroke, the writing
// pen reads the words a moment after, and a grid drawn in lines is offered as a table. input.ts calls these two points.
import type { InkStroke } from '../model/types';
import { createGridWatch } from './gridTable';
import { createWritingPen } from './handwriting';
import type { InkHost } from './host';
import { penEdit } from './penEditing';
import type { DrawTool } from './state';
import type { InkSurface } from './surface';

export function createStrokeHooks(host: InkHost, surfaceOf: () => InkSurface | null) {
  const writing = createWritingPen(host, surfaceOf);
  const grid = createGridWatch(host, surfaceOf);
  return {
    /** Before the stroke is added: true when it edited typed text, so it is not added as ink. */
    before(stroke: InkStroke, surface: InkSurface): Promise<boolean> {
      return penEdit(host, surface, stroke);
    },
    /** After the strokes were added. */
    after(strokes: readonly InkStroke[], tool: DrawTool): void {
      if (tool === 'writing') writing.note(strokes);
      if (strokes.length === 1) grid.note(strokes[0]);
    },
    toggleWrittenInk: () => writing.toggleInk(),
    destroy: () => writing.destroy(),
  };
}

export type StrokeHooks = ReturnType<typeof createStrokeHooks>;

let current: StrokeHooks | null = null;

/** The hooks of the installed pen tool, for the commands that reach them. */
export function setStrokeHooks(hooks: StrokeHooks | null): void {
  current = hooks;
}

export function strokeHooks(): StrokeHooks | null {
  return current;
}
