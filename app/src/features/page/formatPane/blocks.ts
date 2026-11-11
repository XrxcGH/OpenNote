// What the Tabs and Borders and shading tabs write (text DESIGN.md 5.3): tab stops, paragraph borders, and shading.
// Each is a command over the paragraph keys `tabs`, `border`, and `shade`, so the same checks as for a command apply.
import type { EditorState } from '@tiptap/pm/state';
import type { Command } from '../../../editor/commands/command';
import { paraAt, selectionParaTargets, setPara, setParaEach } from '../../../editor/commands/paragraph';
import { BORDER_STYLES, MAX_TAB_STOPS, paraFormat } from '../../../editor/paragraph/attributes';
import type {
  Border,
  BorderSide,
  BorderSideName,
  Shade,
  TabAlign,
  TabLeader,
  TabStop,
} from '../../../editor/paragraph/attributes';
import { getDefaultTab, onDefaultTab, setDefaultTab } from '../../../editor/paragraph/defaultTab';
import { createStore } from '../../../state/store';
import { shownMounted } from '../pagesApi';

export const TAB_ALIGNS: readonly TabAlign[] = ['start', 'center', 'end', 'decimal', 'bar'];
export const TAB_LEADERS: readonly TabLeader[] = ['none', 'dot', 'hyphen', 'underscore', 'heavy', 'middleDot'];
export const BORDER_SIDES: readonly BorderSideName[] = ['top', 'bottom', 'start', 'end', 'between'];
export { BORDER_STYLES };

// ---- Tab stops ----

/** The tab stops of the first selected paragraph. */
export const tabsAt = (state: EditorState): TabStop[] => paraAt(state).tabs ?? [];

/** Sets a stop at a position, replacing the one there. Refuses the 65th stop. */
export function setTabStop(stop: TabStop): Command {
  // Each paragraph keeps its own other stops. One that is full refuses the whole change.
  return (state, dispatch) => {
    const tooMany = selectionParaTargets(state.doc, state.selection).some(
      ({ node }) => (paraFormat(node.attrs).tabs ?? []).filter((have) => have.pos !== stop.pos).length >= MAX_TAB_STOPS,
    );
    if (tooMany) return false;
    return setParaEach('tabs', (format) =>
      [...(format.tabs ?? []).filter((have) => have.pos !== stop.pos), stop].sort((a, b) => a.pos - b.pos),
    )(state, dispatch);
  };
}

/** Clears the stop at a position. */
export function clearTabStop(pos: number): Command {
  return setParaEach('tabs', (format) => {
    const next = (format.tabs ?? []).filter((have) => have.pos !== pos);
    return next.length > 0 ? next : null;
  });
}

/** Clears every stop of the selected paragraphs. */
export function clearAllTabStops(): Command {
  return setPara('tabs', null);
}

/** The default tab interval in points (Word's Default tab stops): the page's `view.text.defaultTab`. */
export const defaultTabInterval = createStore<number>(getDefaultTab(), 'default tab interval');
onDefaultTab(() => defaultTabInterval.set(getDefaultTab()));

/** Sets the default interval, 1 to 1584 points, and saves it with the page. 36 is the default, so it is removed. */
export function setDefaultTabInterval(points: number): boolean {
  if (!setDefaultTab(points)) return false;
  shownMounted.get()?.layout.patchView({ text: { defaultTab: points === 36 ? null : points } });
  return true;
}

// ---- Borders ----

export const borderAt = (state: EditorState): Border => paraAt(state).border ?? {};

/** What the border controls are set to before a side is chosen. */
export const DEFAULT_SIDE: BorderSide = { style: 'single', width: 0.5, space: 1, color: null };

const borderJson = (border: Border) => {
  const out: Record<string, unknown> = {};
  for (const side of BORDER_SIDES) {
    const have = border[side];
    if (have)
      out[side] = {
        style: have.style,
        width: have.width,
        space: have.space,
        ...(have.color ? { color: have.color } : {}),
      };
  }
  return Object.keys(out).length > 0 ? out : null;
};

/** Sets, or with null removes, one side of the border. */
export function setBorderSide(side: BorderSideName, spec: BorderSide | null): Command {
  return setParaEach('border', (format) => {
    const next: Border = { ...format.border };
    if (spec) next[side] = spec;
    else delete next[side];
    return borderJson(next);
  });
}

export type BorderPreset = 'none' | 'box' | 'lines';

/** A preset: none, a box (top, bottom, start, end), or lines above and below. */
export function applyBorderPreset(preset: BorderPreset, spec: BorderSide = DEFAULT_SIDE): Command {
  const sides: readonly BorderSideName[] =
    preset === 'box' ? ['top', 'bottom', 'start', 'end'] : preset === 'lines' ? ['top', 'bottom'] : [];
  const border: Border = Object.fromEntries(sides.map((side) => [side, spec]));
  return setPara('border', borderJson(border));
}

// ---- Shading ----

export const shadeAt = (state: EditorState): Shade | null => paraAt(state).shade ?? null;

/** Sets the shading, or removes it when there is no fill and the pattern is clear. */
export function setShade(shade: Shade | null): Command {
  const none = shade === null || (shade.fill === null && shade.pattern === 'clear');
  const json = none
    ? null
    : {
        ...(shade.fill ? { fill: shade.fill } : {}),
        pattern: shade.pattern,
        ...(shade.color ? { color: shade.color } : {}),
      };
  return setPara('shade', json);
}
