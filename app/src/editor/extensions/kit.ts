// The editor kit (PLAN.md section 3.8, owned by WP0): the extension list of a text or table editor. It names one
// factory per extension file, so each owner changes only their own file, and later phases add extensions through
// the editorExtensions registry. The kit builds the same schema as editor/schema, which a test checks.
import { Editor } from '@tiptap/core';
import type { AnyExtension, Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { FlagId } from '../../app/flags';
import { createRegistry } from '../../registries/registry';
import type { Registry } from '../../registries/registry';
import type { BlockId, EditorHost } from '../host';
import * as marks from '../schema/marks';
import * as nodes from '../schema/nodes';
import { OneParagraphCell, OneParagraphHeader, TableDoc } from '../schema/schema';
import { Table, TableRow } from '@tiptap/extension-table';
import { tableKitExtensions } from '../table/tableKit';
import { autoChangeExtensions } from './autoChange';
import { autocorrectExtensions } from './autocorrect';
import { calloutExtensions } from './callout';
import { codeBlockExtensions } from './codeBlock';
import { crossBlockExtensions } from './crossBlock';
import { foldingExtensions } from './folding';
import { highlightExtensions } from './highlight';
import { imageExtensions } from './image';
import { keysExtensions } from './keys';
import { listItemExtensions } from './listItem';
import { graphFenceExtensions } from './graphFence';
import { mathBlockExtensions, mathInlineExtensions } from './math';
import { outlineExtensions } from './outline';
import { slashExtensions } from './slash';
import { spellingRangesExtensions } from './spellingRanges';
import { tabKeysExtensions } from './tabKeys';
import { textColorExtensions } from './textColor';
import { textSizeExtensions } from './textSize';

export type EditorKind = 'text' | 'table';

export interface KitOptions {
  kind: EditorKind;
  block: BlockId;
  host: EditorHost;
}

/** An extension a later package or phase adds to every editor of the given kinds, such as Phase 5's ink anchors. */
export interface EditorExtensionDef {
  id: string;
  order: number;
  flag?: FlagId;
  kinds: readonly EditorKind[];
  create(host: EditorHost): AnyExtension;
}

export const editorExtensions: Registry<EditorExtensionDef> = createRegistry<EditorExtensionDef>('editor extensions');

/** The marks in SPEC 7.7 nesting order, which is also their order in the schema. */
function markKit(host: EditorHost): Extensions {
  return [
    marks.Link,
    marks.Bold,
    marks.Italic,
    marks.Strike,
    marks.Underline,
    ...highlightExtensions(host),
    ...textColorExtensions(host),
    ...textSizeExtensions(host),
    marks.Subscript,
    marks.Superscript,
    marks.Code,
  ];
}

/** Behavior that adds no nodes or marks, shared by both kinds. */
function behaviorKit(host: EditorHost): Extensions {
  return [
    ...keysExtensions(host),
    ...autoChangeExtensions(host),
    ...autocorrectExtensions(host),
    ...spellingRangesExtensions(host),
  ];
}

function textKit(host: EditorHost): Extensions {
  return [
    nodes.Doc,
    nodes.TextNode,
    nodes.Paragraph,
    nodes.Heading,
    nodes.HardBreak,
    nodes.HorizontalRule,
    nodes.Blockquote,
    ...listItemExtensions(host),
    nodes.BulletList,
    nodes.OrderedList,
    nodes.CalloutTitle,
    ...calloutExtensions(host),
    ...codeBlockExtensions(host),
    ...mathBlockExtensions(host),
    ...mathInlineExtensions(host),
    ...graphFenceExtensions(host),
    ...imageExtensions(host),
    ...markKit(host),
    ...behaviorKit(host),
    ...crossBlockExtensions(host),
    ...outlineExtensions(host),
    ...foldingExtensions(host),
    ...slashExtensions(host),
    ...tabKeysExtensions(host),
  ];
}

function tableKit(host: EditorHost): Extensions {
  return [
    TableDoc,
    Table.configure({ resizable: false }),
    TableRow,
    OneParagraphHeader,
    OneParagraphCell,
    nodes.Paragraph,
    nodes.TextNode,
    nodes.HardBreak,
    ...mathInlineExtensions(host),
    ...imageExtensions(host),
    ...markKit(host),
    ...behaviorKit(host),
    ...tableKitExtensions(host),
  ];
}

/** The extensions of one editor: its kind's kit, then the registered extensions whose flags are on, in order. */
export function buildKit(options: KitOptions): AnyExtension[] {
  const { kind, host } = options;
  const own = kind === 'text' ? textKit(host) : tableKit(host);
  const added = editorExtensions
    .list()
    .filter((def) => def.kinds.includes(kind) && (!def.flag || host.flag(def.flag)))
    .sort((a, b) => a.order - b.order)
    .map((def) => def.create(host));
  return [...own, ...added];
}

/**
 * Mounts an editor in place of `root`'s static content, so the text doesn't move. The root keeps its element, so
 * the block's wrapper, its accessible name, and the caret's place on the page stay the same.
 */
export function createBlockEditor(root: HTMLElement, doc: PMNode, options: KitOptions): Editor {
  return new Editor({
    // The mount form: `root` itself becomes the editable, and its static children are replaced in the same task.
    element: { mount: root },
    extensions: buildKit(options),
    content: doc.toJSON(),
    injectCSS: false,
    editorProps: { attributes: { 'data-app-menu': '', 'data-block': options.block } },
  });
}
