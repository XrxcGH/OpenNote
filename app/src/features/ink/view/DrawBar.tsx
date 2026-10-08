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
import { paletteByName, slotsForTool, toCss } from '../pens/palette';
import { WIDTH_PRESETS_MM } from '../pens/tools';
import { activeSlot, chooseTool, drawState, styleOf, updateSlot } from './state';
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
  const writing = useFlag('ink.handwriting');
  const shown: Exclude<DrawTool, 'pen'>[] = [
    'select',
    ...(erasers ? (['eraser', 'partialEraser'] as const) : []),
    ...(lasso ? (['lasso'] as const) : []),
    ...(space ? (['insertSpace'] as const) : []),
    ...(writing ? (['writing'] as const) : []),
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

const toolName = (tool: string): string =>
  t(tool === 'pencil' ? 'ink.tools.pencil' : tool === 'highlighter' ? 'ink.tools.highlighter' : 'ink.tools.pen');
const colorName = (color: string): string => {
  const entry = paletteByName(color);
  return entry ? t(`ink.colors.${entry.name}` as MessageKey) : t('ink.colors.custom');
};

/** The pen slots, and Color and Width for the active one. */
export function DrawPens({ toolProps }: CommandBarComponentProps) {
  const state = useStore(drawState, (s) => s);
  const slots = useSettings((settings) => settings.ink.pens);
  const active = activeSlot(state);
  const onPen = state.tool === 'pen' || state.tool === 'writing';

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
      label: t('ink.pens.widthMenu'),
      anchor,
      returnFocus: anchor,
      items: WIDTH_PRESETS_MM[active.tool].map((mm) => ({
        id: String(mm),
        label: t('ink.pens.widthValue', { width: mm }),
        kind: 'radio',
        checked: active.width === mm,
      })),
    });
    if (chosen) await updateSlot(active.id, { width: Number(chosen) });
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
