// A kit tool's typed values, kept as the form controls of its panel: what a live calculation block saves so Open in
// tool brings the same inputs back. A kit marks the panel that holds the open tool with data-kit-form (its kit id)
// and data-kit-tool (the tool's id). The values are read from the controls by their labels, and put back by setting
// the controls the way a person would, so a tool needs no code of its own to take part. Nothing here throws.
import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { onKitInputs, takeKitInputs } from './registry';

export const PANEL_FORM_ATTRIBUTE = 'data-kit-form';
export const PANEL_TOOL_ATTRIBUTE = 'data-kit-tool';

/** One control's saved value: its label, which of the controls with that label it is, and its text or checked state. */
export interface PanelField {
  key: string;
  at: number;
  value: string | boolean;
}

/** A panel's controls. `panel` is the format's version, so a block from a later version is told apart. */
export interface PanelForm {
  panel: 1;
  fields: PanelField[];
}

type Control = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

const SKIPPED_INPUTS = new Set(['button', 'submit', 'reset', 'file', 'hidden', 'password', 'image']);
const VALUE_LIMIT = 4000;
const FIELD_LIMIT = 200;

function controlsOf(root: ParentNode): Control[] {
  return Array.from(root.querySelectorAll<Control>('input, select, textarea')).filter((control) => {
    if (control instanceof HTMLInputElement && SKIPPED_INPUTS.has(control.type)) return false;
    return !control.disabled && !control.closest('[role="tablist"]');
  });
}

/** A label's words without the controls it wraps (a wrapped select would add the text of all its options). */
function labelWords(label: HTMLLabelElement): string {
  const copy = label.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('select, input, textarea, button, [aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent ?? '';
}

/** What names a control: its label, its aria-label, its name, or its placeholder, as plain text. */
function keyOf(control: Control): string {
  const labelled = Array.from(control.labels ?? [])
    .map(labelWords)
    .join(' ');
  const raw = labelled || control.getAttribute('aria-label') || control.getAttribute('name') || '';
  const text = raw || (control as HTMLInputElement).placeholder || control.id || control.tagName.toLowerCase();
  return text.replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** Pairs each control with its key and its place among the controls that share the key. */
function keyed(root: ParentNode): { control: Control; key: string; at: number }[] {
  const seen = new Map<string, number>();
  return controlsOf(root).map((control) => {
    const key = keyOf(control);
    const at = seen.get(key) ?? 0;
    seen.set(key, at + 1);
    return { control, key, at };
  });
}

const isToggle = (control: Control): control is HTMLInputElement =>
  control instanceof HTMLInputElement && (control.type === 'checkbox' || control.type === 'radio');

/** The panel's typed values, or null when there is nothing to keep. */
export function readPanelForm(root: ParentNode): PanelForm | null {
  try {
    const fields: PanelField[] = [];
    for (const { control, key, at } of keyed(root)) {
      if (fields.length >= FIELD_LIMIT) break;
      if (isToggle(control)) {
        // A radio group is kept by the choice that is on; the others need nothing.
        if (control.type === 'radio' && !control.checked) continue;
        fields.push({ key, at, value: control.checked });
      } else if (control.value.length <= VALUE_LIMIT) {
        fields.push({ key, at, value: control.value });
      }
    }
    return fields.length ? { panel: 1, fields } : null;
  } catch {
    return null;
  }
}

/** The form as a block's saved inputs read it, or null when they are something else. */
export function readSavedPanelForm(inputs: unknown): PanelForm | null {
  if (!inputs || typeof inputs !== 'object') return null;
  const { panel, fields } = inputs as { panel?: unknown; fields?: unknown };
  if (panel !== 1 || !Array.isArray(fields)) return null;
  const kept = fields.filter(
    (field): field is PanelField =>
      !!field &&
      typeof field === 'object' &&
      typeof (field as PanelField).key === 'string' &&
      typeof (field as PanelField).at === 'number' &&
      (typeof (field as PanelField).value === 'string' || typeof (field as PanelField).value === 'boolean'),
  );
  return kept.length ? { panel: 1, fields: kept } : null;
}

/** Sets a control the way typing or clicking would, so a framework that watches it sees the change. */
function setControl(control: Control, value: string | boolean): boolean {
  if (isToggle(control)) {
    if (typeof value !== 'boolean' || control.checked === value) return false;
    control.click();
    return true;
  }
  if (typeof value !== 'string' || control.value === value) return false;
  if (control instanceof HTMLSelectElement && !Array.from(control.options).some((one) => one.value === value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(control) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(control, value);
  else control.value = value;
  control.dispatchEvent(new Event(control instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
  return true;
}

/** Puts the saved values back into the panel's controls. Returns how many it changed on this pass. */
export function applyPanelForm(root: ParentNode, form: PanelForm): number {
  let changed = 0;
  try {
    const now = keyed(root);
    for (const field of form.fields) {
      const match = now.find((one) => one.key === field.key && one.at === field.at);
      if (match && setControl(match.control, field.value)) changed += 1;
    }
  } catch {
    // The tool stays as it is.
  }
  return changed;
}

/** When, after a block hands its inputs over, the panel is set again: a tool that loads late or redraws on a change. */
const PASSES = [0, 60, 200, 450, 900, 1600];

/**
 * Brings a live calculation block's inputs back into the open tool. The kit window calls this with its kit id, the
 * tool it is showing and the panel that holds it (marked with data-kit-form).
 */
export function useKitReopen(kit: string, tool: string, panel: RefObject<HTMLElement | null>): void {
  const [arrivals, setArrivals] = useState(0);
  useEffect(() => onKitInputs(kit, () => setArrivals((count) => count + 1)), [kit]);
  useEffect(() => {
    const form = readSavedPanelForm(takeKitInputs(kit, tool));
    if (!form) return;
    const timers = PASSES.map((delay) =>
      window.setTimeout(() => {
        if (panel.current) applyPanelForm(panel.current, form);
      }, delay),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [kit, tool, arrivals, panel]);
}

/** The panel an Insert button sits in, and the tool it shows. */
export function panelOf(from: Element): { root: HTMLElement; kit: string; tool: string; title: string } | null {
  const root = from.closest<HTMLElement>(`[${PANEL_FORM_ATTRIBUTE}]`);
  const kit = root?.getAttribute(PANEL_FORM_ATTRIBUTE);
  const tool = root?.getAttribute(PANEL_TOOL_ATTRIBUTE);
  if (!root || !kit || !tool) return null;
  // The tool's name is the tab that labels the panel, when there is one.
  const tab = document.getElementById(root.getAttribute('aria-labelledby') ?? '');
  return { root, kit, tool, title: tab?.textContent?.trim() || root.getAttribute('aria-label') || tool };
}
