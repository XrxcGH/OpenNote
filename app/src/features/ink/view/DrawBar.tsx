// The Draw tab (design 5.2): the tools, then the pens. Each pen is a slot from settings with its own tool, color,
// and width; choosing one picks the pen tool with it. Color and Width change the active slot. Every control is a
// real button with a name, and the toolbar's arrow keys reach each one through `toolProps`.
import { isEnabled, useFlag } from '../../../app/flags';
import type { CommandBarComponentProps } from '../../../registries/types';
import type { PenSlot } from '../../../platform/bindings/PenSlot';
import { getSettings, useSettings } from '../../../state/settings';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce, openMenu } from '../../../ui';
import type { MenuAnchor, MenuItemSpec } from '../../../ui';
import { ask } from './ask';
import { paletteByName, slotsForTool, toCss } from '../pens/palette';
import { WIDTH_PRESETS_MM } from '../pens/tools';
import {
  activeSlot,
  applyPenSet,
  chooseTool,
  deletePenSet,
  drawState,
  LIBRARY_PENS,
  MAX_PEN_SETS,
  penSetsFull,
  savePenSet,
  setSlotTool,
  styleOf,
  updateSlot,
} from './state';
import type { DrawTool } from './state';
import styles from './view.module.css';

const TOOL_LABELS: Record<Exclude<DrawTool, 'pen'>, MessageKey> = {
  select: 'ink.tools.select',
  eraser: 'ink.tools.eraser',
  partialEraser: 'ink.tools.partialEraser',
  lasso: 'ink.tools.lasso',
  insertSpace: 'ink.tools.insertSpace',
  writing: 'ink.tools.writing',
};

function pick(tool: DrawTool, slot?: string): void {
  chooseTool(tool, slot);
}

/** Select, the erasers, and the lasso. */
export function DrawTools({ toolProps }: CommandBarComponentProps) {
  const tool = useStore(drawState, (state) => state.tool);
  const erasers = useFlag('ink.erasers');
  const lasso = useFlag('ink.lasso');
  const space = useFlag('ink.insertSpace');
  // The Writing pen is a bar item of its own (more.ts), so the pens fit beside these on a laptop screen.
  const shown: Exclude<DrawTool, 'pen'>[] = [
    'select',
    ...(erasers ? (['eraser', 'partialEraser'] as const) : []),
    ...(lasso ? (['lasso'] as const) : []),
    ...(space ? (['insertSpace'] as const) : []),
  ];
  return (
    <div className={styles.group} role="group" aria-label={t('ink.tools.group')}>
      {shown.map((id) => (
        <button
          key={id}
          type="button"
          {...toolProps}
          className={styles.tool}
          aria-pressed={tool === id}
          data-ink-tool={id}
          title={id === 'insertSpace' ? t('ink.tools.insertSpaceHint') : undefined}
          onClick={() => {
            pick(id);
            // Insert space is a tool to drag with, not a dialog: say how to use it (full walk 2, A1-A10-10).
            announce(
              id === 'insertSpace'
                ? t('ink.tools.insertSpaceHint')
                : t('ink.announce.tool', { tool: t(TOOL_LABELS[id]) }),
            );
          }}
        >
          {t(TOOL_LABELS[id])}
        </button>
      ))}
    </div>
  );
}

const PEN_NAMES: Record<string, MessageKey> = {
  pencil: 'ink.tools.pencil',
  highlighter: 'ink.tools.highlighter',
  fountain: 'ink.penLibrary.fountain',
  brush: 'ink.penLibrary.brush',
  calligraphy: 'ink.penLibrary.calligraphy',
  dashed: 'ink.penLibrary.dashed',
  dotted: 'ink.penLibrary.dotted',
};
const toolName = (tool: string): string => t(PEN_NAMES[tool] ?? 'ink.tools.pen');
const colorName = (color: string): string => {
  const entry = paletteByName(color);
  return entry ? t(`ink.colors.${entry.name}` as MessageKey) : t('ink.colors.custom');
};

/** Where a menu opened from More or the command palette goes: the control that has focus, else the top middle. */
function menuAnchor(): MenuAnchor {
  const focused = document.activeElement;
  if (focused instanceof HTMLElement && focused !== document.body) return focused;
  return { x: Math.round(window.innerWidth / 2), y: 96 };
}

const anchorElement = (anchor: MenuAnchor): HTMLElement | null => (anchor instanceof HTMLElement ? anchor : null);

/** The library's entries, for the end of the width menu: the pen types of the active pen, then the saved pen sets. */
function libraryItems(active: PenSlot): MenuItemSpec[] {
  const items: MenuItemSpec[] = [];
  if (active.tool !== 'highlighter') {
    LIBRARY_PENS.forEach((tool, i) =>
      items.push({
        id: `type:${tool}`,
        label: toolName(tool),
        kind: 'radio',
        checked: active.tool === tool,
        separatorBefore: i === 0,
      }),
    );
  }
  const sets = getSettings().ink.penSets ?? [];
  items.push({ id: 'save', label: t('ink.penLibrary.saveSet'), separatorBefore: true });
  for (const set of sets) items.push({ id: `apply:${set.id}`, label: set.name });
  for (const set of sets)
    items.push({ id: `delete:${set.id}`, label: t('ink.penLibrary.deleteSet', { name: set.name }) });
  return items;
}

/** Does what a library entry chose. */
async function chooseLibrary(active: PenSlot, chosen: string): Promise<void> {
  if (chosen.startsWith('type:')) {
    const tool = LIBRARY_PENS.find((id) => id === chosen.slice(5));
    if (tool) {
      await setSlotTool(active.id, tool);
      announce(t('ink.penLibrary.changed', { pen: toolName(tool) }));
    }
  } else if (chosen === 'save') {
    const answer = await ask({
      title: t('ink.penLibrary.saveSet'),
      field: { label: t('ink.penLibrary.setName'), value: '' },
      confirm: t('ink.penLibrary.save'),
      validate: (text) =>
        !text.trim()
          ? t('ink.penLibrary.setNameMissing')
          : penSetsFull(text)
            ? t('ink.penLibrary.setsFull', { count: MAX_PEN_SETS })
            : null,
    });
    if (answer && (await savePenSet(answer.text))) {
      announce(t('ink.penLibrary.saved', { name: answer.text.trim() }));
    }
  } else if (chosen.startsWith('apply:')) {
    await applyPenSet(chosen.slice(6));
    announce(t('ink.penLibrary.applied'));
  } else if (chosen.startsWith('delete:')) {
    await deletePenSet(chosen.slice(7));
  }
}

/** `#rrggbb` from what a person typed, with or without the `#`, or null. */
export function customHex(text: string): string | null {
  const hex = text.trim().replace(/^#?/, '#').toLowerCase();
  return /^#[0-9a-f]{6}$/.test(hex) ? hex : null;
}

const CUSTOM_ID = '#custom';

/** Asks for a color of the person's own for the active pen. */
async function chooseCustomColor(active: PenSlot): Promise<void> {
  const answer = await ask({
    title: t('ink.colors.custom'),
    field: { label: t('ink.pens.customField'), value: paletteByName(active.color) ? '' : active.color },
    confirm: t('ink.pens.customApply'),
    validate: (text) => (customHex(text) ? null : t('ink.pens.customInvalid')),
  });
  const hex = answer ? customHex(answer.text) : null;
  if (!hex) return;
  await updateSlot(active.id, { color: hex });
  announce(t('ink.pens.customChanged', { color: hex }));
}

/**
 * The active pen's colors: the brand colors of its kind, then, for pens, a color of the person's own. Highlighters
 * keep to their own see-through colors, so a custom one could never hide the writing under it.
 */
export async function openPenColorMenu(anchor: MenuAnchor = menuAnchor()): Promise<void> {
  const active = activeSlot();
  if (!active) return;
  const custom: MenuItemSpec[] =
    active.tool === 'highlighter'
      ? []
      : [
          {
            id: CUSTOM_ID,
            label: t('ink.colors.custom'),
            kind: 'radio',
            checked: !paletteByName(active.color),
            separatorBefore: true,
          },
        ];
  const chosen = await openMenu({
    label: t('ink.pens.colorMenu'),
    anchor,
    returnFocus: anchorElement(anchor),
    items: [
      ...slotsForTool(active.tool).map((entry): MenuItemSpec => ({
        id: entry.name,
        label: t(`ink.colors.${entry.name}` as MessageKey),
        kind: 'radio',
        checked: paletteByName(active.color)?.slot === entry.slot,
      })),
      ...custom,
    ],
  });
  if (!chosen) return;
  if (chosen === CUSTOM_ID) await chooseCustomColor(active);
  else await updateSlot(active.id, { color: chosen.toLowerCase() });
}

/** The active pen's widths, then the pen library's pen types and saved pen sets when it is on. */
export async function openPenWidthMenu(anchor: MenuAnchor = menuAnchor()): Promise<void> {
  const active = activeSlot();
  if (!active) return;
  const library = isEnabled('ink.penLibrary');
  const chosen = await openMenu({
    label: t(library ? 'ink.penLibrary.widthAndType' : 'ink.pens.widthMenu'),
    anchor,
    returnFocus: anchorElement(anchor),
    items: [
      ...WIDTH_PRESETS_MM[active.tool].map((mm): MenuItemSpec => ({
        id: String(mm),
        label: t('ink.pens.widthValue', { width: mm }),
        kind: 'radio',
        checked: active.width === mm,
      })),
      ...(library ? libraryItems(active) : []),
    ],
  });
  if (!chosen) return;
  if (/^[0-9]/.test(chosen)) await updateSlot(active.id, { width: Number(chosen) });
  else await chooseLibrary(active, chosen);
}

const slotLabel = (slot: PenSlot): string =>
  t('ink.pens.slot', { tool: toolName(slot.tool), color: colorName(slot.color), width: slot.width });

/** Picks a pen slot from a menu: what More and the command palette offer when the bar has no room for the slots. */
export async function openPenSlotMenu(anchor: MenuAnchor = menuAnchor()): Promise<void> {
  const state = drawState.get();
  const active = activeSlot(state);
  const onPen = state.tool === 'pen' || state.tool === 'writing';
  const slots = getSettings().ink.pens;
  const chosen = await openMenu({
    label: t('ink.pens.group'),
    anchor,
    returnFocus: anchorElement(anchor),
    items: slots.map((slot): MenuItemSpec => ({
      id: slot.id,
      label: slotLabel(slot),
      kind: 'radio',
      checked: onPen && active?.id === slot.id,
    })),
  });
  const slot = slots.find((candidate) => candidate.id === chosen);
  if (!slot) return;
  pick('pen', slot.id);
  announce(t('ink.announce.tool', { tool: slotLabel(slot) }));
}

/** The pen slots, and Color and Width for the active one. */
export function DrawPens({ toolProps }: CommandBarComponentProps) {
  const state = useStore(drawState, (s) => s);
  const slots = useSettings((settings) => settings.ink.pens);
  const active = activeSlot(state);
  const onPen = state.tool === 'pen' || state.tool === 'writing';

  return (
    <div className={styles.group} role="group" aria-label={t('ink.pens.group')}>
      {slots.map((slot) => {
        const style = styleOf(slot);
        const label = slotLabel(slot);
        return (
          <button
            key={slot.id}
            type="button"
            {...toolProps}
            className={styles.tool}
            aria-pressed={onPen && active?.id === slot.id}
            aria-label={label}
            title={label}
            data-ink-slot={slot.id}
            onClick={() => {
              pick('pen', slot.id);
              announce(t('ink.announce.tool', { tool: label }));
            }}
          >
            <span className={styles.swatch} data-tool={slot.tool} style={{ background: toCss(style.color) }} />
          </button>
        );
      })}
      <button
        type="button"
        {...toolProps}
        className={styles.tool}
        aria-haspopup="menu"
        data-ink-color=""
        onClick={(event) => void openPenColorMenu(event.currentTarget)}
      >
        {t('ink.pens.color')}
      </button>
      <button
        type="button"
        {...toolProps}
        className={styles.tool}
        aria-haspopup="menu"
        data-ink-width=""
        onClick={(event) => void openPenWidthMenu(event.currentTarget)}
      >
        {t('ink.pens.width')}
      </button>
    </div>
  );
}
