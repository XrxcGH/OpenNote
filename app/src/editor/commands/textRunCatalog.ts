// Editor commands for character formatting (fonts, weights, underline styles, spacing, case), spread into ENTRIES in
// catalog.ts. Owner: text:editor-commands (B10). text:scaffold wrote it empty, so lanes never edit catalog.ts for these.
import type { EditorState } from '@tiptap/pm/state';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import type { CatalogEntry, EditorCommandArgs } from './catalog';
import { CASE_MODES, changeCase } from './changeCase';
import type { CaseMode } from './changeCase';
import type { Command } from './command';
import { clearFormatting, currentTextSize, growFont, nudgeFont, setTextSize } from './marks';
import { copyFormatting, pasteFormatting } from './painter';
import { repeatLast, lastRepeatable } from './repeat';
import { runMarkOn, setRunMark, setRunValue, setWeight, toggleRunMark, weightAt } from './runFormat';
import { similarRanges, selectSimilar } from './similar';
import { BODY_POINTS, parseSizeInput, pointsOf, sizeText, validSize } from './sizes';
import { describeFormat } from './speakFormat';
import { markAttrs } from './state';

const text = (args: EditorCommandArgs): string | null | undefined =>
  args.value === undefined ? undefined : args.value === null ? null : String(args.value);

/** A command that sets a single-attribute mark from `args.value`; null takes it off. */
const valueEntry = (mark: string, name: MessageKey): CatalogEntry => ({
  command: (args) => {
    const value = text(args);
    return value === undefined ? null : setRunValue(mark, value);
  },
  name,
});

/** A toggle of a mark with fixed attributes. */
const toggleEntry = (mark: string, attrs: Record<string, unknown> | null, name: MessageKey): CatalogEntry => ({
  command: () => toggleRunMark(mark, attrs),
  on: (state) => runMarkOn(state, mark, attrs ?? undefined),
  name,
  announce: 'toggle',
});

/** "Font size 14 points." for the size at the selection. */
export function sizeAnnouncement(state: EditorState): string {
  const points = pointsOf(currentTextSize(state), BODY_POINTS) ?? BODY_POINTS;
  return t('textCommands.announce.size', { points: String(points) });
}

const sizeEntry = (command: Command, name: MessageKey): CatalogEntry => ({
  command: () => command,
  name,
  say: sizeAnnouncement,
});

/** A pointless command that only reads the selection, for commands that announce or copy. */
const reading =
  (read: (state: EditorState) => void): Command =>
  (state) => {
    read(state);
    return true;
  };

export const TEXT_RUN_ENTRIES: Record<string, CatalogEntry> = {
  'format.font': {
    ...valueEntry('font', 'textCommands.names.font'),
    say: (state) => {
      const font = markAttrs(state, 'font')?.font;
      return typeof font === 'string' ? t('textCommands.announce.font', { name: font }) : null;
    },
  },
  'format.fontSize': {
    command: (args) => {
      if (args.value === null) return setTextSize(null);
      const points =
        typeof args.value === 'number'
          ? validSize(args.value)
            ? args.value
            : null
          : parseSizeInput(String(args.value ?? ''));
      return points === null || args.value === undefined ? null : setTextSize(sizeText(points));
    },
    name: 'textCommands.names.fontSize',
    say: sizeAnnouncement,
  },
  'format.growFont': sizeEntry(growFont(1), 'textCommands.names.growFont'),
  'format.shrinkFont': sizeEntry(growFont(-1), 'textCommands.names.shrinkFont'),
  'format.fontSizeUp': sizeEntry(nudgeFont(1), 'textCommands.names.fontSizeUp'),
  'format.fontSizeDown': sizeEntry(nudgeFont(-1), 'textCommands.names.fontSizeDown'),
  'format.weight': {
    command: ({ value, faces }) => (typeof value === 'number' ? setWeight(value, faces) : null),
    name: 'textCommands.names.weight',
    say: (state) =>
      t('textCommands.announce.weight', { name: t(`textCommands.weights.w${weightAt(state)}` as MessageKey) }),
  },
  'format.strikeDouble': toggleEntry('strike', { line: 'double' }, 'textCommands.names.strikeDouble'),
  'format.underlineStyle': {
    command: (args) => {
      const value = text(args);
      if (value === undefined) return null;
      return value === null
        ? setRunMark('underline', null)
        : setRunMark('underline', { line: value === 'single' ? null : value });
    },
    name: 'textCommands.names.underlineStyle',
  },
  'format.underlineColor': {
    command: (args) => {
      const value = text(args);
      if (value === undefined) return null;
      return (state, dispatch) => {
        const line = (markAttrs(state, 'underline')?.line as string | null | undefined) ?? null;
        return setRunMark('underline', { line, color: value })(state, dispatch);
      };
    },
    name: 'textCommands.names.underlineColor',
  },
  'format.shade': valueEntry('shade', 'textCommands.names.shade'),
  'format.smallCaps': toggleEntry('caps', { caps: 'small' }, 'textCommands.names.smallCaps'),
  'format.allCaps': toggleEntry('caps', { caps: 'all' }, 'textCommands.names.allCaps'),
  'format.tracking': valueEntry('tracking', 'textCommands.names.tracking'),
  'format.scale': valueEntry('scale', 'textCommands.names.scale'),
  'format.shift': valueEntry('shift', 'textCommands.names.shift'),
  'format.kern': valueEntry('kern', 'textCommands.names.kern'),
  'format.otf': valueEntry('otf', 'textCommands.names.otf'),
  'format.effect': valueEntry('effect', 'textCommands.names.effect'),
  'format.box': {
    command: (args) => {
      const value = text(args);
      if (value === undefined) return null;
      return setRunMark('box', value === null ? null : { style: value, color: null });
    },
    name: 'textCommands.names.box',
  },
  'format.language': valueEntry('lang', 'textCommands.names.language'),
  'format.direction': valueEntry('dir', 'textCommands.names.direction'),
  'format.charStyle': valueEntry('charStyle', 'textCommands.names.charStyle'),
  /** Any run format by mark name in `key`, with `attrs` (null takes it off). */
  'format.mark': {
    command: ({ key, attrs }) => (key === undefined || attrs === undefined ? null : setRunMark(key, attrs)),
  },
  'format.clearCharacter': {
    command: () => clearFormatting(),
    name: 'textCommands.names.clearCharacter',
    say: () => t('textCommands.announce.cleared'),
  },
  'format.changeCase': {
    command: ({ value }) =>
      typeof value === 'string' && (CASE_MODES as readonly string[]).includes(value)
        ? changeCase(value as CaseMode)
        : null,
    name: 'textCommands.names.changeCase',
    say: (_state, { value }) => t('textCommands.announce.case', { name: t(`textCommands.cases.${value as CaseMode}`) }),
  },
  'format.cycleCase': { command: () => changeCase('cycle'), name: 'textCommands.names.cycleCase' },
  'format.copyFormat': {
    command: () => reading((state) => void copyFormatting(state)),
    name: 'textCommands.names.copyFormat',
    say: () => t('textCommands.announce.copied'),
  },
  'format.pasteFormat': {
    command: () => pasteFormatting(),
    name: 'textCommands.names.pasteFormat',
    say: () => t('textCommands.announce.pasted'),
  },
  'format.repeat': {
    command: () => repeatLast(),
    name: 'textCommands.names.repeat',
    say: () => {
      const last = lastRepeatable();
      return last ? null : t('textCommands.announce.nothingToRepeat');
    },
  },
  'format.selectSimilar': {
    command: () => selectSimilar(),
    name: 'textCommands.names.selectSimilar',
    say: (state) => t('textCommands.announce.similar', { count: similarRanges(state).length }),
  },
  'format.speak': {
    command: () => reading(() => undefined),
    name: 'textCommands.names.speakFormat',
    say: (state) => describeFormat(state),
  },
};
