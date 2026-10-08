// The styles the person can choose: the five built in, the style files that come with the app, and the style files
// the person added. A style file is turned into a style here, and added to the table of styles.
import { createStore } from '../../state/store';
import { t } from '../../strings/t';
import { fill } from './csl';
import type { StyleFile } from './csl';
import { BUNDLED_STYLES } from './cslStyles';
import { BUILTIN_STYLE_IDS, STYLES } from './styles';
import type { CitationStyle, StyleId } from './styles';

/** The style a style file describes. */
export function styleFromFile(file: StyleFile): CitationStyle {
  return {
    numbered: file.numbered,
    inline: (source, number = 1) => fill(file.inline, source, file.names, number),
    reference: (source, number = 1) => fill(file.entry[source.type] ?? file.entry.book, source, file.names, number),
  };
}

/** The title each style file gave itself, by id. */
const titles = new Map<StyleId, string>();

/** Style files the person added, which the Citations window can list and remove. */
export const addedStyles = createStore<readonly StyleFile[]>([], 'citation style files');

export function registerStyleFile(file: StyleFile): void {
  STYLES[file.id] = styleFromFile(file);
  titles.set(file.id, file.title);
}

for (const file of BUNDLED_STYLES) registerStyleFile(file);

/** Whether this id is one the app owns, which a style file may not replace. */
export const isOwnStyle = (id: StyleId): boolean =>
  (BUILTIN_STYLE_IDS as readonly string[]).includes(id) || BUNDLED_STYLES.some((file) => file.id === id);

/** Adds a style file the person chose. A file with an id the app owns is refused. Returns whether it was added. */
export function addStyleFile(file: StyleFile): boolean {
  if (isOwnStyle(file.id)) return false;
  registerStyleFile(file);
  addedStyles.set((current) => [...current.filter((one) => one.id !== file.id), file]);
  return true;
}

export function removeStyleFile(id: StyleId): void {
  if (isOwnStyle(id)) return;
  delete STYLES[id];
  titles.delete(id);
  addedStyles.set((current) => current.filter((one) => one.id !== id));
}

export interface StyleChoice {
  id: StyleId;
  label: string;
  /** A style file the person added. */
  added: boolean;
}

/** Every style in the order the list shows them: built in, bundled, then added. */
export function styleChoices(): StyleChoice[] {
  const bundled = new Set(BUNDLED_STYLES.map((file) => file.id));
  const built = BUILTIN_STYLE_IDS.map((id) => ({
    id: id as StyleId,
    label: t(`study.citations.styles.${id}`),
    added: false,
  }));
  return [
    ...built,
    ...Object.keys(STYLES)
      .filter((id) => !(BUILTIN_STYLE_IDS as readonly string[]).includes(id))
      .sort((a, b) => Number(bundled.has(b)) - Number(bundled.has(a)))
      .map((id) => ({ id, label: titles.get(id) ?? id, added: !bundled.has(id) })),
  ];
}
