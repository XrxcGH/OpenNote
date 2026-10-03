// "Size and position" (ARCHITECTURE.md section 11.3; owner WP3): exact X, Y, width, and height for one block, the
// single-pointer and keyboard alternative to every move and resize drag. Text boxes have no height field, since
// they are as tall as their content, and a flowing block has no X or Y.
import type { BlockId, Frame } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import type { PageBlockLayer } from '../blocks/blockLayer';
import { isFloating } from '../blocks/textBlock';
import { frameValue } from '../objects/arrange';
import { MIN_TEXT_WIDTH } from '../objects/objects';
import type { Objects } from '../objects/objects';
import styles from './sizePosition.module.css';

type Field = 'x' | 'y' | 'w' | 'h';

const LABELS: Record<Field, MessageKey> = {
  x: 'page.object.x',
  y: 'page.object.y',
  w: 'page.object.width',
  h: 'page.object.height',
};

let open: (() => void) | null = null;

function field(form: HTMLFormElement, name: Field, value: number): HTMLInputElement {
  const label = form.ownerDocument.createElement('label');
  label.className = styles.field;
  label.textContent = t(LABELS[name]);
  const input = form.ownerDocument.createElement('input');
  input.type = 'number';
  input.name = name;
  input.step = '1';
  input.min = '0';
  input.value = String(Math.round(value * 100) / 100);
  label.append(input);
  form.append(label);
  return input;
}

/** Opens the popover beside a block. Apply sends one moveBlock; Escape or a click outside closes it. */
export function openSizeAndPosition(
  container: HTMLElement,
  objects: Objects,
  layer: PageBlockLayer,
  id: BlockId,
): void {
  open?.();
  const block = layer.block(id);
  const view = layer.view(id);
  if (!block || !view) return;
  const rect = view.measure();
  const doc = container.ownerDocument;
  const form = doc.createElement('form');
  form.className = styles.popover;
  form.setAttribute('role', 'dialog');
  form.setAttribute('aria-label', t('page.object.sizeAndPosition'));
  const floating = isFloating(block);
  const inputs: Partial<Record<Field, HTMLInputElement>> = {};
  if (floating) {
    inputs.x = field(form, 'x', block.frame?.x ?? rect.x);
    inputs.y = field(form, 'y', block.frame?.y ?? rect.y);
  }
  inputs.w = field(form, 'w', block.frame?.w ?? rect.w);
  if (block.type !== 'text') inputs.h = field(form, 'h', block.frame?.h ?? rect.h);
  const apply = doc.createElement('button');
  apply.type = 'submit';
  apply.textContent = t('page.object.apply');
  form.append(apply);
  const box = view.element.getBoundingClientRect();
  const origin = container.getBoundingClientRect();
  form.style.insetInlineStart = `${Math.max(8, box.left - origin.left)}px`;
  form.style.insetBlockStart = `${Math.max(8, box.bottom - origin.top + 8)}px`;
  container.append(form);

  const close = () => {
    open = null;
    form.remove();
    doc.removeEventListener('pointerdown', onOutside, true);
    view.element.focus({ preventScroll: true });
  };
  const onOutside = (event: Event) => {
    if (!(event.target instanceof Node) || !form.contains(event.target)) close();
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = (name: Field) => {
      const raw = inputs[name]?.valueAsNumber;
      return raw === undefined || Number.isNaN(raw) ? undefined : raw;
    };
    const frame: Frame = { ...block.frame };
    if (value('x') !== undefined) frame.x = frameValue(value('x')!);
    if (value('y') !== undefined) frame.y = frameValue(value('y')!);
    if (value('w') !== undefined) frame.w = frameValue(value('w')!, block.type === 'text' ? MIN_TEXT_WIDTH : 16);
    if (value('h') !== undefined) frame.h = frameValue(value('h')!, 16);
    if (!objects.locked(block)) objects.commitFrames(new Map([[id, frame]]));
    close();
  });
  form.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  });
  doc.addEventListener('pointerdown', onOutside, true);
  open = close;
  (inputs.x ?? inputs.w)?.focus();
}
