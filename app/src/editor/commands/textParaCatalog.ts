// Editor commands for paragraph formatting (alignment, indents, spacing, tabs, line height), spread into ENTRIES in
// catalog.ts. Owner: text:editor-commands (B10). text:scaffold wrote it empty, so lanes never edit catalog.ts for these.
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { PARA_KEYS } from '../paragraph/attributes';
import type { Align, ParaKey } from '../paragraph/attributes';
import { NUMBER_FORMATS } from '../paragraph/numbering';
import type { NumberFormat } from '../paragraph/numbering';
import type { CatalogEntry } from './catalog';
import {
  BULLET_LIBRARY,
  MULTILEVEL_PRESETS,
  NUMBER_LIBRARY,
  applyBullet,
  applyMultilevel,
  applyNumberLook,
  continueNumbering,
  defineNumberFormat,
  labelAt,
  restartNumbering,
  setNumberingValue,
} from './lists';
import type { MultilevelPreset, NumberLook } from './lists';
import {
  alignAt,
  hangingIndent,
  indentParagraph,
  paraAt,
  resetParagraph,
  setAlign,
  setLineMultiple,
  setPara,
  toggleSpaceBefore,
} from './paragraph';

const alignEntry = (align: Align, name: MessageKey): CatalogEntry => ({
  command: () => setAlign(align),
  on: (state) => alignAt(state) === align,
  name,
  say: () => t('textCommands.announce.align', { name: t(`textCommands.aligns.${align}`) }),
});

const indentSay: CatalogEntry['say'] = (state) =>
  t('textCommands.announce.indent', { points: String(paraAt(state).indent?.start ?? 0) });

const numberingSay: CatalogEntry['say'] = (state) => {
  const label = labelAt(state);
  return label ? t('textCommands.announce.numbering', { name: label }) : null;
};

const isKey = (key: string | undefined): key is ParaKey => (PARA_KEYS as readonly string[]).includes(key ?? '');

export const TEXT_PARA_ENTRIES: Record<string, CatalogEntry> = {
  'para.alignStart': alignEntry('start', 'textCommands.names.alignStart'),
  'para.alignCenter': alignEntry('center', 'textCommands.names.alignCenter'),
  'para.alignEnd': alignEntry('end', 'textCommands.names.alignEnd'),
  'para.justify': alignEntry('justify', 'textCommands.names.justify'),
  'para.distribute': alignEntry('distribute', 'textCommands.names.distribute'),
  'para.lineSpacing': {
    command: ({ value }) => (typeof value === 'number' ? setLineMultiple(value) : null),
    name: 'textCommands.names.lineSpacing',
    say: (_state, { value }) => t('textCommands.announce.lineSpacing', { value: String(value) }),
  },
  'para.spaceBefore': {
    command: () => toggleSpaceBefore(),
    name: 'textCommands.names.spaceBefore',
    say: (state) => {
      const before = paraAt(state).before;
      return t('textCommands.announce.spaceBefore', { points: String(typeof before === 'number' ? before : 0) });
    },
  },
  /** Any paragraph key in `key`, with `attrs.value` (null takes it off). */
  'para.set': {
    command: ({ key, attrs }) =>
      isKey(key) && key !== 'list' && attrs && 'value' in attrs ? setPara(key, attrs.value) : null,
    name: 'textCommands.names.paragraphFormat',
  },
  'para.indent': { command: () => indentParagraph(1), name: 'textCommands.names.indent', say: indentSay },
  'para.outdent': { command: () => indentParagraph(-1), name: 'textCommands.names.outdent', say: indentSay },
  'para.hanging': { command: () => hangingIndent(1), name: 'textCommands.names.hanging', say: indentSay },
  'para.removeHanging': { command: () => hangingIndent(-1), name: 'textCommands.names.removeHanging', say: indentSay },
  'para.reset': {
    command: () => resetParagraph(),
    name: 'textCommands.names.resetParagraph',
    say: () => t('textCommands.announce.reset'),
  },
  'list.bullet': {
    command: ({ value, attrs }) => {
      const symbol = typeof value === 'string' ? value : BULLET_LIBRARY[0];
      const font = typeof attrs?.font === 'string' ? attrs.font : null;
      return applyBullet(symbol, font);
    },
    name: 'textCommands.names.bulletLibrary',
    say: numberingSay,
  },
  'list.numberLook': {
    command: ({ value }) =>
      typeof value === 'string' && Object.hasOwn(NUMBER_LIBRARY, value) ? applyNumberLook(value as NumberLook) : null,
    name: 'textCommands.names.numberLibrary',
    say: numberingSay,
  },
  'list.defineNumber': {
    command: ({ attrs }) => {
      const format = attrs?.format;
      const text = attrs?.text;
      const start = typeof attrs?.start === 'number' ? attrs.start : 1;
      if (typeof format !== 'string' || !(NUMBER_FORMATS as readonly string[]).includes(format)) return null;
      return typeof text === 'string' ? defineNumberFormat(format as NumberFormat, text, start) : null;
    },
    name: 'textCommands.names.defineNumber',
    say: numberingSay,
  },
  'list.multilevel': {
    command: ({ value }) =>
      typeof value === 'string' && Object.hasOwn(MULTILEVEL_PRESETS, value)
        ? applyMultilevel(value as MultilevelPreset)
        : null,
    name: 'textCommands.names.multilevel',
    say: numberingSay,
  },
  'list.restart': {
    command: () => restartNumbering(),
    name: 'textCommands.names.restartNumbering',
    say: () => t('textCommands.announce.restarted'),
  },
  'list.continue': {
    command: () => continueNumbering(),
    name: 'textCommands.names.continueNumbering',
    say: () => t('textCommands.announce.continued'),
  },
  'list.setValue': {
    command: ({ value }) => (typeof value === 'number' ? setNumberingValue(value) : null),
    name: 'textCommands.names.setNumberingValue',
    say: (_state, { value }) => t('textCommands.announce.numberingValue', { value: String(value) }),
  },
};
