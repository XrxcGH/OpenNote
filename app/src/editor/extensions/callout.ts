// Callouts (ARCHITECTURE.md section 8.2; owner: WP4): a note named by its type and title, a type menu, and the
// fold button of a foldable callout. A callout's fold is content (SPEC 7.2's `[!type]-`), so the button changes the
// Markdown in one undo step and folds it for everyone. Backspace at the start of the title unwraps the callout.
import type { Editor, Extensions } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { NodeView, ViewMutationRecord } from '@tiptap/pm/view';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { fromChange, runCommand } from '../commands/command';
import type { EditorHost } from '../host';
import { META_COMMAND } from '../meta';
import { CALLOUT_TYPES } from '../schema/constants';
import { Callout } from '../schema/nodes';
import styles from './content.module.css';

/** The type's name in words; an unknown type reads as a note (SPEC 7.2). */
export function calloutTypeName(type: string): string {
  const known = (CALLOUT_TYPES as readonly string[]).includes(type) ? type : 'note';
  return t(`editor.callout.types.${known}` as MessageKey);
}

/** "Warning: Mind the gap", or the type alone when the title is empty. */
export function calloutName(node: PMNode): string {
  const type = calloutTypeName(node.attrs.type as string);
  const title = node.firstChild?.textContent.trim() ?? '';
  return title ? t('editor.callout.named', { type, title }) : type;
}

function button(className: string, onPress: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.tabIndex = -1;
  element.className = className;
  element.addEventListener('mousedown', (event) => event.preventDefault());
  element.addEventListener('click', onPress);
  return element;
}

class CalloutView implements NodeView {
  dom: HTMLDivElement;
  contentDOM: HTMLDivElement;
  private typeButton: HTMLButtonElement;
  private foldButton: HTMLButtonElement;

  constructor(
    private node: PMNode,
    private editor: Editor,
    private getPos: () => number | undefined,
    private host: EditorHost,
  ) {
    this.dom = document.createElement('div');
    this.dom.setAttribute('role', 'note');
    this.dom.className = styles.callout;
    const controls = document.createElement('span');
    controls.contentEditable = 'false';
    controls.className = styles.calloutControls;
    this.typeButton = button(styles.calloutType, () => void this.chooseType());
    this.typeButton.setAttribute('aria-haspopup', 'menu');
    this.foldButton = button(styles.foldButton, () => this.toggleFold());
    controls.append(this.typeButton, this.foldButton);
    this.contentDOM = document.createElement('div');
    this.contentDOM.className = styles.calloutBody;
    this.dom.append(controls, this.contentDOM);
    this.render();
  }

  private render(): void {
    const { type, fold } = this.node.attrs as { type: string; fold: string };
    const name = calloutName(this.node);
    this.dom.dataset.callout = type;
    if (fold) this.dom.dataset.fold = fold;
    else delete this.dom.dataset.fold;
    this.dom.setAttribute('aria-label', name);
    this.typeButton.setAttribute('aria-label', t('editor.callout.typeButton', { type: calloutTypeName(type) }));
    this.typeButton.hidden = !this.editor.isEditable;
    this.foldButton.hidden = fold === '';
    this.foldButton.setAttribute('aria-expanded', String(fold !== '-'));
    const title = this.node.firstChild?.textContent.trim() || calloutTypeName(type);
    this.foldButton.setAttribute(
      'aria-label',
      t(fold === '-' ? 'editor.fold.expand' : 'editor.fold.collapse', { name: title }),
    );
  }

  private setAttrs(attrs: Record<string, unknown>): void {
    const pos = this.getPos();
    if (pos === undefined || !this.editor.isEditable) return;
    const tr = this.editor.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, ...attrs });
    this.editor.view.dispatch(tr.setMeta(META_COMMAND, true));
  }

  private toggleFold(): void {
    const folded = this.node.attrs.fold === '-';
    this.setAttrs({ fold: folded ? '+' : '-' });
    this.host.announce(
      t(folded ? 'editor.fold.expanded' : 'editor.fold.collapsedCallout', { name: calloutName(this.node) }),
    );
  }

  private async chooseType(): Promise<void> {
    const current = this.node.attrs.type as string;
    const items = CALLOUT_TYPES.map((type) => ({
      id: type,
      label: calloutTypeName(type),
      kind: 'radio' as const,
      checked: type === current,
    }));
    const chosen = await this.host.openMenu({ label: t('editor.callout.typeMenu'), items, anchor: this.typeButton });
    if (chosen && chosen !== current) this.setAttrs({ type: chosen });
  }

  update(node: PMNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    return true;
  }

  stopEvent(event: Event): boolean {
    return (
      event.target instanceof Element && event.target.closest('button') !== null && this.dom.contains(event.target)
    );
  }

  ignoreMutation(mutation: ViewMutationRecord): boolean {
    return mutation.type !== 'selection' && !this.contentDOM.contains(mutation.target);
  }
}

/** Backspace at the very start of a callout's title turns the callout back into text. */
function unwrapAtTitleStart(editor: Editor): boolean {
  const { $from, empty } = editor.state.selection;
  if (!empty || $from.parentOffset !== 0 || $from.parent.type.name !== 'calloutTitle') return false;
  const pos = $from.before(-1);
  return runCommand(
    editor,
    fromChange((tr) => {
      const callout = tr.doc.nodeAt(pos);
      if (!callout) return false;
      const schema = tr.doc.type.schema;
      const title = callout.firstChild;
      const blocks: PMNode[] = [schema.nodes.paragraph.create(null, title?.content)];
      callout.forEach((child, _offset, index) => {
        if (index > 0) blocks.push(child);
      });
      tr.replaceWith(pos, pos + callout.nodeSize, blocks);
      tr.setSelection(TextSelection.create(tr.doc, pos + 1));
      return true;
    }),
  );
}

export function calloutExtensions(host: EditorHost): Extensions {
  return [
    Callout.extend({
      addNodeView() {
        return ({ node, editor, getPos }) => new CalloutView(node, editor, getPos, host);
      },
      addKeyboardShortcuts() {
        return { Backspace: () => unwrapAtTitleStart(this.editor) };
      },
    }),
  ];
}
