// The command bar's icons for the Home tab, one Phosphor module per icon, keyed by command id (docs/BRAND.md section 8).
// This table ships at start-up. Insert, View, and Draw are in commandIcons.lazy.ts and load with their tab.
//
// A group is all one kind: glyph tools show the icon only, named tools show the icon and the name, and plain tools
// show the name only. A command with no entry in either table has no icon. Bar icons use the text colors, never an
// accent.

import { createElement } from 'react';
import type { ReactElement } from 'react';
import type { IconComponent } from './icons';
import { ArrowUUpLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowUUpLeft';
import { BinocularsIcon } from '@phosphor-icons/react/dist/csr/Binoculars';
import { CheckSquareIcon } from '@phosphor-icons/react/dist/csr/CheckSquare';
import { ChecksIcon } from '@phosphor-icons/react/dist/csr/Checks';
import { ExportIcon } from '@phosphor-icons/react/dist/csr/Export';
import { FileArrowDownIcon } from '@phosphor-icons/react/dist/csr/FileArrowDown';
import { FilePdfIcon } from '@phosphor-icons/react/dist/csr/FilePdf';
import { FilePlusIcon } from '@phosphor-icons/react/dist/csr/FilePlus';
import { FolderOpenIcon } from '@phosphor-icons/react/dist/csr/FolderOpen';
import { FolderSimplePlusIcon } from '@phosphor-icons/react/dist/csr/FolderSimplePlus';
import { HighlighterCircleIcon } from '@phosphor-icons/react/dist/csr/HighlighterCircle';
import { HouseIcon } from '@phosphor-icons/react/dist/csr/House';
import { ListBulletsIcon } from '@phosphor-icons/react/dist/csr/ListBullets';
import { ListChecksIcon } from '@phosphor-icons/react/dist/csr/ListChecks';
import { ListNumbersIcon } from '@phosphor-icons/react/dist/csr/ListNumbers';
import { MicrophoneIcon } from '@phosphor-icons/react/dist/csr/Microphone';
import { NotePencilIcon } from '@phosphor-icons/react/dist/csr/NotePencil';
import { NotebookIcon } from '@phosphor-icons/react/dist/csr/Notebook';
import { RecordIcon } from '@phosphor-icons/react/dist/csr/Record';
import { ShareNetworkIcon } from '@phosphor-icons/react/dist/csr/ShareNetwork';
import { TextAUnderlineIcon } from '@phosphor-icons/react/dist/csr/TextAUnderline';
import { TextAaIcon } from '@phosphor-icons/react/dist/csr/TextAa';
import { TextBIcon } from '@phosphor-icons/react/dist/csr/TextB';
import { TextIndentIcon } from '@phosphor-icons/react/dist/csr/TextIndent';
import { TextItalicIcon } from '@phosphor-icons/react/dist/csr/TextItalic';
import { TextOutdentIcon } from '@phosphor-icons/react/dist/csr/TextOutdent';
import { TextStrikethroughIcon } from '@phosphor-icons/react/dist/csr/TextStrikethrough';
import { TextSubscriptIcon } from '@phosphor-icons/react/dist/csr/TextSubscript';
import { TextSuperscriptIcon } from '@phosphor-icons/react/dist/csr/TextSuperscript';
import { TextTSlashIcon } from '@phosphor-icons/react/dist/csr/TextTSlash';
import { TextUnderlineIcon } from '@phosphor-icons/react/dist/csr/TextUnderline';

export const HOME_ICONS: Readonly<Record<string, IconComponent>> = {
  'notes.newPage': FilePlusIcon,
  'notes.newSection': FolderSimplePlusIcon,
  'notes.newNotebook': NotebookIcon,
  'edit.undo': ArrowUUpLeftIcon,
  'format.bold': TextBIcon,
  'format.italic': TextItalicIcon,
  'format.underline': TextUnderlineIcon,
  'format.strike': TextStrikethroughIcon,
  'format.highlight': HighlighterCircleIcon,
  'format.subscript': TextSubscriptIcon,
  'format.superscript': TextSuperscriptIcon,
  'format.clear': TextTSlashIcon,
  'format.textColor': TextAUnderlineIcon,
  'format.textSize': TextAaIcon,
  'block.bulletList': ListBulletsIcon,
  'block.orderedList': ListNumbersIcon,
  'block.checklist': ListChecksIcon,
  'outline.promote': TextOutdentIcon,
  'outline.demote': TextIndentIcon,
  'block.toggleCheck': CheckSquareIcon,
  'checklist.checkAll': ChecksIcon,
  'page.find': BinocularsIcon,
  'audio.record': RecordIcon,
  'intel.dictate': MicrophoneIcon,
  'app.home': HouseIcon,
  'app.quickNote': NotePencilIcon,
  'interop.import': FileArrowDownIcon,
  'interop.export': ExportIcon,
  'interop.openFile': FolderOpenIcon,
  'interop.share': ShareNetworkIcon,
  'pdf.import': FilePdfIcon,
};

/** The 13 universal letterforms. They show their icon only, at every width, with a tooltip that gives name and shortcut. */
export const GLYPH_COMMANDS: ReadonlySet<string> = new Set([
  'format.bold',
  'format.italic',
  'format.underline',
  'format.strike',
  'format.highlight',
  'format.subscript',
  'format.superscript',
  'format.clear',
  'block.bulletList',
  'block.orderedList',
  'block.checklist',
  'outline.promote',
  'outline.demote',
]);

/** The groups whose tools carry icons, by tab. Every other group shows names only. */
export const ICON_GROUPS: Readonly<Record<string, ReadonlySet<string>>> = {
  home: new Set(['new', 'edit', 'text', 'paragraph', 'find', 'recording', 'go', 'share']),
  insert: new Set(['text', 'blocks', 'dates', 'tables', 'media']),
  view: new Set(['panes', 'navigation', 'pageTools', 'outline']),
  draw: new Set(['shapes', 'view']),
};

/** The tabs that keep part of their icons in the lazy module. */
export const LAZY_TABS: ReadonlySet<string> = new Set(['insert', 'view', 'draw']);

let lazyTable: Readonly<Record<string, IconComponent>> | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Loads the Insert, View, and Draw icons once. Until then the bar keeps a blank 20 px where an icon goes. */
export function loadLazyIcons(): Promise<void> {
  loading ??= import('./commandIcons.lazy').then((module) => {
    lazyTable = module.LAZY_ICONS;
    listeners.forEach((listener) => listener());
  });
  return loading;
}

export function lazyIconsLoaded(): boolean {
  return lazyTable !== null;
}

export function subscribeLazyIcons(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The icon of a Phosphor name such as 'Moon', when a table holds that icon. Icons are never loaded by name. */
function byName(name: string): IconComponent | undefined {
  const find = (table: Readonly<Record<string, IconComponent>> | null) =>
    table ? Object.values(table).find((component) => component.displayName === `${name}Icon`) : undefined;
  return find(HOME_ICONS) ?? find(lazyTable);
}

/** The icon for a command id: the tables first, then the command's own `icon` name when a table holds that icon. */
export function iconFor(id: string, iconName?: string): IconComponent | undefined {
  return HOME_ICONS[id] ?? lazyTable?.[id] ?? (iconName ? byName(iconName) : undefined);
}

/** The icon for a command id as an element, so the bar can draw it without creating a component while it renders. */
export function iconElementFor(id: string): ReactElement | undefined {
  const Icon = iconFor(id);
  return Icon ? createElement(Icon, { 'aria-hidden': true }) : undefined;
}

/** Whether a tool in this tab and group is drawn with an icon: a group is all icons or none. */
export function groupHasIcons(tab: string, group: string): boolean {
  return ICON_GROUPS[tab]?.has(group) ?? false;
}
