// The clipboard serializer (ADR 0084). It is ProseMirror's own DOM serializer for the schema, with each mark and
// paragraph also writing inline CSS in points (style.ts), so Word and Google Docs read fonts, sizes, colors,
// alignment, indents, and spacing. Every `data-` attribute stays, so OpenNote reads its own copy back exactly.
// Paragraph formatting has no DOM attribute of its own, so `data-paste-para` carries it as JSON for the paste side.
import { DOMSerializer } from '@tiptap/pm/model';
import type { DOMOutputSpec, Mark, Node as PMNode, Schema } from '@tiptap/pm/model';
import { markDeclarations, paraDeclarations, portableFormat, styleText } from './style';
import type { Declarations } from './style';
import { paraFormat } from '../paragraph/attributes';
import { PARA_DATA } from './paraData';

const isAttrs = (value: unknown): value is Record<string, string> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !('nodeType' in value);

/** Where our style waits until the end: ProseMirror sets a spec's `style` through the browser's style parser, which
 * rewrites colors as rgb() and drops properties it doesn't know, such as the mso- hints. */
const PENDING = 'data-copy-style';

/** The spec with extra attributes. A `style` already in the spec keeps its place, and the new one follows it. */
function withAttrs(spec: DOMOutputSpec, extra: Record<string, string>): DOMOutputSpec {
  if (!Array.isArray(spec) || Object.keys(extra).length === 0) return spec;
  const [tag, second, ...rest] = spec as unknown[];
  const own = isAttrs(second) ? second : {};
  const merged: Record<string, string> = { ...own };
  for (const [name, value] of Object.entries(extra)) {
    const key = name === 'style' ? PENDING : name;
    merged[key] = key === PENDING && own[PENDING] ? `${own[PENDING]};${value}` : value;
  }
  const tail = isAttrs(second) || second === undefined ? rest : [second, ...rest];
  return [tag, merged, ...tail] as unknown as DOMOutputSpec;
}

function styleAttr(declarations: Declarations): Record<string, string> {
  return Object.keys(declarations).length === 0 ? {} : { style: styleText(declarations) };
}

function paraExtra(node: PMNode, withStyle: boolean): Record<string, string> {
  const portable = portableFormat(node.attrs);
  if (Object.keys(portable).length === 0) return {};
  const style = withStyle ? styleAttr(paraDeclarations(paraFormat(node.attrs))) : {};
  return { ...style, [PARA_DATA]: JSON.stringify(portable) };
}

/**
 * One span in a span that holds nothing else is one span with both sets of attributes, so a run in Georgia 13 pt
 * red is one `<span>` whose style holds all three. Attributes of the same name keep the outer one, except `style`.
 */
export function mergeSpans(root: ParentNode): void {
  let changed = true;
  while (changed) {
    changed = false;
    for (const outer of Array.from(root.querySelectorAll('span'))) {
      const only = outer.childNodes.length === 1 ? outer.firstElementChild : null;
      if (!only || only.tagName !== 'SPAN') continue;
      const joined = (name: string) => name === 'style' || name === PENDING;
      const clash = Array.from(only.attributes).some((a) => !joined(a.name) && outer.hasAttribute(a.name));
      if (clash) continue;
      for (const a of Array.from(only.attributes)) {
        if (joined(a.name) && outer.hasAttribute(a.name)) {
          outer.setAttribute(a.name, `${outer.getAttribute(a.name)};${a.value}`);
        } else outer.setAttribute(a.name, a.value);
      }
      outer.replaceChildren(...Array.from(only.childNodes));
      changed = true;
      break;
    }
  }
}

/** Moves each pending style into `style`, after the style the spec had, as text exactly as we wrote it. */
function writeStyles(root: ParentNode): void {
  root.querySelectorAll(`[${PENDING}]`).forEach((element) => {
    const own = element.getAttribute('style');
    element.setAttribute(
      'style',
      own ? `${own.replace(/;\s*$/, '')};${element.getAttribute(PENDING)}` : (element.getAttribute(PENDING) as string),
    );
    element.removeAttribute(PENDING);
  });
}

class CopySerializer extends DOMSerializer {
  override serializeFragment(...args: Parameters<DOMSerializer['serializeFragment']>) {
    const out = super.serializeFragment(...args);
    mergeSpans(out);
    writeStyles(out);
    return out;
  }
}

/** A serializer for the schema that writes inline CSS beside the data attributes. */
export function clipboardSerializer(schema: Schema): DOMSerializer {
  const nodes = DOMSerializer.nodesFromSchema(schema);
  const marks = DOMSerializer.marksFromSchema(schema);
  for (const name of ['paragraph', 'heading', 'listItem']) {
    const original = nodes[name];
    if (!original) continue;
    nodes[name] = (node: PMNode) => withAttrs(original(node), paraExtra(node, name !== 'listItem'));
  }
  for (const name of Object.keys(marks)) {
    const original = marks[name];
    marks[name] = (mark: Mark, inline: boolean) =>
      withAttrs(original(mark, inline), styleAttr(markDeclarations(name, mark.attrs)));
  }
  return new CopySerializer(nodes, marks);
}
