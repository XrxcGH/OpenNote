// The Draw tab (design 5.2): the tools, then the pens. Each pen is a slot from settings with its own tool, color,
// and width; choosing one picks the pen tool with it. Color and Width change the active slot. Every control is a
// real button with a name, and the toolbar's arrow keys reach each one through `toolProps`.
import { useFlag } from '../../../app/flags';
import type { CommandBarComponentProps } from '../../../registries/types';
import { useSettings } from '../../../state/settings';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { announce, openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
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
          onClick={() => {
            pick(id);
            announce(t('ink.announce.tool', { tool: t(TOOL_LABELS[id]) }));
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

/** The pen slots, and Color and Width for the active one. */
// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export function DrawPens({ toolProps }: CommandBarComponentProps) {
  const state = useStore(drawState, (s) => s);
  const slots = useSettings((settings) => settings.ink.pens);
  const active = activeSlot(state);
  const onPen = state.tool === 'pen' || state.tool === 'writing';
  const library = useFlag('ink.penLibrary');
  const sets = useSettings((settings) => settings.ink.penSets);

  /** The library's entries, for the end of the width menu: the pen types of the active pen, then the saved pen sets. */
  const libraryItems = (): MenuItemSpec[] => {
    const items: MenuItemSpec[] = [];
    if (active && active.tool !== 'highlighter') {
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
    items.push({ id: 'save', label: t('ink.penLibrary.saveSet'), separatorBefore: true });
    for (const set of sets ?? []) items.push({ id: `apply:${set.id}`, label: set.name });
    for (const set of sets ?? []) {
      items.push({ id: `delete:${set.id}`, label: t('ink.penLibrary.deleteSet', { name: set.name }) });
    }
    return items;
  };

  /** Does what a library entry chose. */
  const chooseLibrary = async (chosen: string) => {
    if (chosen.startsWith('type:') && active) {
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
  };

  const chooseColor = async (anchor: HTMLElement) => {
    if (!active) return;
    const entries = slotsForTool(active.tool);
    const chosen = await openMenu({
      label: t('ink.pens.colorMenu'),
      anchor,
      returnFocus: anchor,
      items: entries.map((entry) => ({
        id: entry.name,
        label: t(`ink.colors.${entry.name}` as MessageKey),
        kind: 'radio',
        checked: paletteByName(active.color)?.slot === entry.slot,
      })),
    });
    if (chosen) await updateSlot(active.id, { color: chosen.toLowerCase() });
  };

  const chooseWidth = async (anchor: HTMLElement) => {
    if (!active) return;
    const chosen = await openMenu({
      label: t(library ? 'ink.penLibrary.widthAndType' : 'ink.pens.widthMenu'),
      anchor,
      returnFocus: anchor,
      items: [
        ...WIDTH_PRESETS_MM[active.tool].map((mm): MenuItemSpec => ({
          id: String(mm),
          label: t('ink.pens.widthValue', { width: mm }),
          kind: 'radio',
          checked: active.width === mm,
        })),
        ...(library ? libraryItems() : []),
      ],
    });
    if (!chosen) return;
    if (/^[0-9]/.test(chosen)) await updateSlot(active.id, { width: Number(chosen) });
    else await chooseLibrary(chosen);
  };

  return (
    <div className={styles.group} role="group" aria-label={t('ink.pens.group')}>
      {slots.map((slot) => {
        const style = styleOf(slot);
        const label = t('ink.pens.slot', {
          tool: toolName(slot.tool),
          color: colorName(slot.color),
          width: slot.width,
        });
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
        onClick={(event) => void chooseColor(event.currentTarget)}
      >
        {t('ink.pens.color')}
      </button>
      <button
        type="button"
        {...toolProps}
        className={styles.tool}
        aria-haspopup="menu"
        data-ink-width=""
        onClick={(event) => void chooseWidth(event.currentTarget)}
      >
        {t('ink.pens.width')}
      </button>
    </div>
  );
}
