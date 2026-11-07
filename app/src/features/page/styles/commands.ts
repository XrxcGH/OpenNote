// The style commands (text DESIGN.md 4.3). Applying a style changes the selected elements in one editor
// transaction: it sets their `style` (saved in `data.styles`), and a heading style also makes the element a heading
// of that level, so headings stay real headings. Headings 7 to 9 are paragraphs with an outline level (SPEC
// R-STY-3). The other commands change the notebook's styles, one notebook change each.
import type { Editor } from '@tiptap/core';
import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { deepHeadingAttrs, paraFormat } from '../../../editor/paragraph/attributes';
import { selectedTextblocks } from '../../../editor/commands/command';
import type { Change } from '../../../editor/commands/command';
import { HEADING_STYLES, LOOK_KEYS, PARA_STYLE_KEYS, V1_TWINS, patchStyle, styleType, userStyleName } from './model';
import type { LookKey, StyleJson, StyleSheetJson } from './model';
import { differingFromInherited, resolveStyle } from './resolve';
import type { StyleContext } from './resolve';

/** The style an element has: its own `style`, else its heading level, else `normal`. */
export function styleOfNode(node: PMNode): string {
  const own = node.attrs.style;
  if (typeof own === 'string' && own !== '') return own;
  if (node.type.name === 'heading') return `h${Math.min(6, Math.max(1, Number(node.attrs.level) || 1))}`;
  return 'normal';
}

const level = (name: string) => (HEADING_STYLES.includes(name) ? Number(name.slice(1)) : 0);

/** The node type, attributes, and style an element gets for a paragraph style. */
function target(node: PMNode, name: string): { type: string; attrs: Record<string, unknown> } {
  const n = level(name);
  const attrs: Record<string, unknown> = {};
  const previous = level(styleOfNode(node));
  // A paragraph that was heading 7 to 9 drops that outline level with its style.
  if (previous >= 7 && paraFormat(node.attrs).outline === previous) attrs.outline = null;
  if (n >= 1 && n <= 6) return { type: 'heading', attrs: { ...attrs, level: n, style: null } };
  if (n >= 7) return { type: 'paragraph', attrs: { ...attrs, ...deepHeadingAttrs(n as 7 | 8 | 9) } };
  return { type: 'paragraph', attrs: { ...attrs, style: name === 'normal' ? null : name } };
}

/** Applies a paragraph style to every selected paragraph and heading. List items keep their type. */
export function applyParagraphStyle(name: string): Change {
  return (tr) => {
    let changed = false;
    for (const { node, pos } of selectedTextblocks(tr)) {
      if (node.type.name !== 'paragraph' && node.type.name !== 'heading') continue;
      const want = target(node, name);
      const at = tr.mapping.map(pos);
      const $at = tr.doc.resolve(at);
      const index = $at.index();
      let type = tr.doc.type.schema.nodes[want.type];
      // A heading can't stand where the schema allows only paragraphs (a list item): it keeps the style only.
      if (!$at.parent.canReplaceWith(index, index + 1, type)) type = node.type;
      const declared = type.spec.attrs ?? {};
      const attrs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(node.attrs)) if (key in declared) attrs[key] = value;
      for (const [key, value] of Object.entries(want.attrs)) if (key in declared) attrs[key] = value;
      if (type === node.type && type.name === 'paragraph' && want.type === 'heading') attrs.style = name;
      if (type === node.type && Object.entries(attrs).every(([key, value]) => node.attrs[key] === value)) continue;
      tr.setNodeMarkup(at, type, attrs);
      changed = true;
    }
    return changed;
  };
}

/** Applies a character style to the selection, or to what is typed next when nothing is selected. */
export function applyCharacterStyle(name: string): Change {
  return (tr) => {
    const type = tr.doc.type.schema.marks.charStyle;
    if (!type) return false;
    const mark = type.create({ style: name });
    const { from, to, empty } = tr.selection;
    if (empty) tr.addStoredMark(mark);
    else tr.addMark(from, to, mark);
    return true;
  };
}

/** Applies a style of either type in one transaction. */
export function applyStyle(editor: Editor, name: string, sheet: StyleSheetJson): boolean {
  const change = styleType(sheet[name]) === 'character' ? applyCharacterStyle(name) : applyParagraphStyle(name);
  const tr = editor.state.tr;
  if (!change(tr)) return false;
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** The look a run's marks give, as style keys (SPEC 7.10 to style keys). */
function markLook(marks: readonly Mark[]): Partial<Record<LookKey, unknown>> {
  const look: Partial<Record<LookKey, unknown>> = {};
  for (const mark of marks) {
    const { attrs } = mark;
    switch (mark.type.name) {
      case 'bold':
        look.weight = 700;
        break;
      case 'weight':
        look.weight = Number(attrs.weight);
        break;
      case 'italic':
        look.italic = true;
        break;
      case 'font':
        look.font = attrs.font;
        break;
      case 'textSize':
        if (/^\d+(\.\d+)?$/.test(String(attrs.size))) look.sizePt = Number(attrs.size);
        break;
      case 'textColor':
        if (attrs.color) look.textColor = attrs.color;
        break;
      case 'underline':
        look.underline = attrs.line ?? 'single';
        break;
      case 'strike':
        look.strike = attrs.line ?? 'single';
        break;
      case 'caps':
        look.caps = attrs.caps;
        break;
      case 'tracking':
        look.tracking = Number(attrs.tracking);
        break;
      case 'highlight':
        look.highlight = attrs.color ?? 'honey';
        break;
      default:
    }
  }
  return look;
}

/** The selection's effective look: its paragraph's style, the paragraph's own formatting, then the caret's marks. */
export function selectionLook(
  editor: Editor,
  ctx: StyleContext,
): { style: string; look: Partial<Record<LookKey, unknown>> } {
  const { $from } = editor.state.selection;
  const node = $from.parent;
  const style = styleOfNode(node);
  const look: Partial<Record<LookKey, unknown>> = { ...resolveStyle(ctx, style).values };
  const para = paraFormat(node.attrs) as Record<string, unknown>;
  for (const key of PARA_STYLE_KEYS) if (para[key] !== undefined) look[key] = para[key];
  Object.assign(look, markLook(editor.state.storedMarks ?? $from.marks()));
  return { style, look };
}

/** A style with its look keys replaced by `look`, keeping its other keys (type, label, basedOn, unknown ones). */
export function withLook(raw: StyleJson | undefined, look: Partial<Record<LookKey, unknown>>): StyleJson {
  const cleared: Record<string, unknown> = {};
  for (const key of LOOK_KEYS) {
    cleared[key] = undefined;
    const twin = V1_TWINS[key as keyof typeof V1_TWINS];
    if (twin) cleared[twin] = undefined;
  }
  return patchStyle(patchStyle(raw, cleared), look);
}

/** "Update style to match selection": the notebook's styles with `name` holding only what differs from inherited. */
export function updatedToMatch(
  ctx: StyleContext,
  name: string,
  effective: Partial<Record<LookKey, unknown>>,
): StyleSheetJson {
  const look = differingFromInherited(ctx, name, effective);
  return { ...ctx.notebook, [name]: withLook(ctx.notebook[name], look) };
}

/** "New style from selection": a user style based on the selection's style, holding what differs from it. */
export function createdFromSelection(
  ctx: StyleContext,
  label: string,
  basedOn: string,
  effective: Partial<Record<LookKey, unknown>>,
): { name: string; styles: StyleSheetJson } {
  const taken = [...Object.keys(ctx.app), ...Object.keys(ctx.notebook), ...Object.keys(ctx.page ?? {})];
  const name = userStyleName(label, taken);
  const seed: StyleJson = { label, basedOn };
  const withSeed: StyleContext = { ...ctx, notebook: { ...ctx.notebook, [name]: seed } };
  const look = differingFromInherited(withSeed, name, effective);
  return { name, styles: { ...ctx.notebook, [name]: withLook(seed, look) } };
}

/** The notebook's styles without a user style. Built-in styles can only be hidden. */
export function withoutStyle(sheet: StyleSheetJson, name: string): StyleSheetJson | null {
  if (!name.startsWith('u-')) return null;
  const next: Record<string, StyleJson> = { ...sheet };
  delete next[name];
  return next;
}

/** The notebook's styles with a style hidden from or shown in the gallery. */
export function withHidden(sheet: StyleSheetJson, name: string, hidden: boolean): StyleSheetJson {
  return { ...sheet, [name]: patchStyle(sheet[name], { hidden: hidden ? true : undefined }) };
}

/** The notebook's styles with `name` one place earlier or later in `order`, numbering the whole order again. */
export function withMoved(sheet: StyleSheetJson, order: readonly string[], name: string, by: -1 | 1): StyleSheetJson {
  const at = order.indexOf(name);
  const to = at + by;
  if (at < 0 || to < 0 || to >= order.length) return sheet;
  const next = [...order];
  [next[at], next[to]] = [next[to], next[at]];
  const out: Record<string, StyleJson> = { ...sheet };
  next.forEach((style, index) => {
    out[style] = patchStyle(out[style], { order: index });
  });
  return out;
}
