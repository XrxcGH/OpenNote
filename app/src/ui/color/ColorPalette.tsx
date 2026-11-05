// checks-disable-file modifiability: one component with shared state
// checks-disable-file brand-consistency: values here are palette data

// The one color palette (NEXT-PLAN section 3.4): theme colors with tints and shades, standard colors, recent colors,
// Automatic, No color, and More colors. Text, tables, and later the format pane share it. It reports a pick and
// draws nothing else: the caller applies the value, in a popover it owns. Arrow keys move between swatches
// (one Tab stop), Enter or Space picks.

import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { t } from '../../strings/t';
import { TextField } from '../TextField';
import { contrastRatio, hexToRgb, hslToRgb, rgbToHex, rgbToHsl } from './math';
import type { Hsl, Rgb } from './math';
import { parseColor, resolveColor, themeColor } from './parse';
import type { Scheme, ThemeColors } from './parse';
import { rememberColor, useRecentColors } from './recent';
import { STANDARD_COLORS, THEME_COLUMNS, TINTS, themeColumn } from './swatches';
import styles from './ColorPalette.module.css';

export type ColorPick = { kind: 'auto' } | { kind: 'none' } | { kind: 'color'; value: string };

export interface ColorPaletteProps {
  onPick(pick: ColorPick): void;
  scheme: Scheme;
  /**
   * The notebook's own theme colors (R-THM-2). Callers must pass the page's paper color as `theme.background`, or
   * the Paper column follows the app's default page surface instead of the page.
   */
  theme?: ThemeColors;
  /** Recent custom colors are kept per notebook. Without it, none are kept. */
  notebookId?: string;
  /** Leave out Automatic, as a fill has none. */
  automatic?: boolean;
  /** Leave out No color, as a text color has none. */
  noColor?: boolean;
  /** The stored value now in use, so its swatch shows as chosen. */
  current?: string | null;
  /** False stores a base theme swatch as its light `#rrggbb`, not `theme:NAME`, for a version 1 field. */
  themeTokens?: boolean;
  /** The color the contrast badge compares with; the page color by default. */
  against?: string;
}

interface Cell {
  key: string;
  label: string;
  hex?: string;
  pick: ColorPick;
  chosen: boolean;
  kind: 'swatch' | 'wide';
}

interface EyeDropperLike {
  open(): Promise<{ sRGBHex: string }>;
}
const eyeDropper = (): (new () => EyeDropperLike) | undefined =>
  (globalThis as { EyeDropper?: new () => EyeDropperLike }).EyeDropper;

export function ColorPalette(props: ColorPaletteProps) {
  const {
    onPick,
    scheme,
    theme,
    notebookId,
    automatic = true,
    noColor = true,
    current,
    against,
    themeTokens = true,
  } = props;
  const recent = useRecentColors(notebookId ?? '');
  const [more, setMore] = useState(false);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [active, setActive] = useState('');

  const isCurrent = (value: string) => current != null && current.toLowerCase() === value;
  const rows: Cell[][] = [];
  if (automatic) {
    rows.push([
      { key: 'auto', label: t('color.automatic'), pick: { kind: 'auto' }, chosen: current == null, kind: 'wide' },
    ]);
  }
  if (noColor) {
    rows.push([
      { key: 'none', label: t('color.none'), pick: { kind: 'none' }, chosen: current === 'none', kind: 'wide' },
    ]);
  }
  const themeStart = rows.length;
  const themeRows: Cell[][] = Array.from({ length: TINTS.length + 1 }, () => []);
  THEME_COLUMNS.forEach((column, c) => {
    themeColumn(column, scheme, theme, themeTokens).forEach((s, r) => {
      const name = t(s.name);
      const label = !s.tint
        ? name
        : t(s.tint.kind === 'lighter' ? 'color.swatchLighter' : 'color.swatchDarker', {
            name,
            percent: s.tint.percent,
          });
      themeRows[r].push({
        key: `theme-${r}-${c}`,
        label,
        hex: s.hex,
        pick: { kind: 'color', value: s.value },
        chosen: isCurrent(s.value),
        kind: 'swatch',
      });
    });
  });
  rows.push(...themeRows);
  const standardStart = rows.length;
  rows.push(
    STANDARD_COLORS.map((s, i): Cell => ({
      key: `std-${i}`,
      label: t(s.name),
      hex: s.hex,
      pick: { kind: 'color', value: s.hex },
      chosen: isCurrent(s.hex),
      kind: 'swatch',
    })),
  );
  const recentStart = rows.length;
  if (recent.length > 0) {
    rows.push(
      recent.map((hex, i): Cell => ({
        key: `recent-${i}`,
        label: t('color.recentSwatch', { hex }),
        hex,
        pick: { kind: 'color', value: hex },
        chosen: isCurrent(hex),
        kind: 'swatch',
      })),
    );
  }

  const where = new Map<string, [number, number]>();
  rows.forEach((row, r) => row.forEach((cell, c) => where.set(cell.key, [r, c])));
  const chosenKey = rows.flat().find((cell) => cell.chosen)?.key;
  const tabbable = where.has(active) ? active : (chosenKey ?? rows[0]?.[0]?.key ?? '');

  const focus = (r: number, c: number) => {
    const row = rows[r];
    if (!row) return;
    const cell = row[Math.min(c, row.length - 1)];
    setActive(cell.key);
    refs.current.get(cell.key)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, key: string) => {
    const [r, c] = where.get(key)!;
    const move: Record<string, () => void> = {
      ArrowRight: () => focus(r, Math.min(c + 1, rows[r].length - 1)),
      ArrowLeft: () => focus(r, Math.max(0, c - 1)),
      ArrowDown: () => focus(Math.min(rows.length - 1, r + 1), c),
      ArrowUp: () => focus(Math.max(0, r - 1), c),
      Home: () => focus(r, 0),
      End: () => focus(r, rows[r].length - 1),
    };
    const handler = move[event.key];
    if (!handler) return;
    event.preventDefault();
    handler();
  };

  const renderRow = (r: number, label?: string): ReactNode => (
    <div className={styles.row} role={label ? 'group' : undefined} aria-label={label} key={r}>
      {rows[r].map((cell) => (
        <button
          key={cell.key}
          type="button"
          ref={(node) => {
            if (node) refs.current.set(cell.key, node);
            else refs.current.delete(cell.key);
          }}
          className={cell.kind === 'wide' ? styles.wide : styles.swatch}
          style={cell.hex ? { background: cell.hex } : undefined}
          data-color-swatch={cell.hex}
          aria-label={cell.label}
          aria-pressed={cell.chosen}
          tabIndex={cell.key === tabbable ? 0 : -1}
          onFocus={() => setActive(cell.key)}
          onKeyDown={(event) => onKeyDown(event, cell.key)}
          onClick={() => onPick(cell.pick)}
        >
          {cell.kind === 'wide' ? cell.label : null}
        </button>
      ))}
    </div>
  );

  const pickCustom = (hex: string) => {
    if (notebookId) rememberColor(notebookId, hex);
    onPick({ kind: 'color', value: hex });
  };

  return (
    <div className={styles.palette} role="group" aria-label={t('color.palette')}>
      {Array.from({ length: themeStart }, (_, r) => renderRow(r))}
      <div className={styles.heading}>{t('color.themeColors')}</div>
      <div className={styles.themeGrid} role="group" aria-label={t('color.themeColors')}>
        {Array.from({ length: TINTS.length + 1 }, (_, i) => renderRow(themeStart + i))}
      </div>
      <div className={styles.heading}>{t('color.standardColors')}</div>
      {renderRow(standardStart, t('color.standardColors'))}
      {recent.length > 0 && (
        <>
          <div className={styles.heading}>{t('color.recentColors')}</div>
          {renderRow(recentStart, t('color.recentColors'))}
        </>
      )}
      <button type="button" className={styles.more} aria-expanded={more} onClick={() => setMore(!more)}>
        {t('color.moreColors')}
      </button>
      {more && (
        <MoreColors
          seed={resolveColor(current ?? '', scheme, theme) ?? themeColor('text', scheme, theme)}
          against={against ?? themeColor('background', scheme, theme)}
          onApply={pickCustom}
        />
      )}
    </div>
  );
}

function MoreColors(props: { seed: string; against: string; onApply(hex: string): void }) {
  const [hex, setHex] = useState(props.seed);
  const [text, setText] = useState(props.seed);
  const [error, setError] = useState<string | undefined>();
  const rgb = hexToRgb(hex) ?? [0, 0, 0];
  // HSL is its own state: it is filled from the color when hex or RGB change, and only an HSL edit writes RGB from it.
  const [hsl, setHsl] = useState<Hsl>(() => rgbToHsl(rgb));
  const [dropperError, setDropperError] = useState(false);
  const set = (next: string) => {
    setHex(next);
    setText(next);
    setError(undefined);
    setHsl(rgbToHsl(hexToRgb(next) ?? [0, 0, 0]));
  };
  const onText = (value: string) => {
    setText(value);
    if (value.trim() === '') {
      setError(undefined);
      return;
    }
    const parsed = parseColor(value);
    if (parsed.ok) {
      setHex(parsed.hex);
      setHsl(rgbToHsl(hexToRgb(parsed.hex) ?? [0, 0, 0]));
      setError(undefined);
    } else {
      setError(t('color.hexError'));
    }
  };
  const clamp = (value: string, max: number) => Math.min(max, Math.max(0, Math.round(Number(value) || 0)));
  const channel = (index: number, value: string) =>
    set(rgbToHex(rgb.map((c, i) => (i === index ? clamp(value, 255) : c)) as unknown as Rgb));
  const hslField = (index: number, value: string) => {
    // Committing a value that did not change must not move the color.
    if (clamp(value, index === 0 ? 359 : 100) === hsl[index]) return;
    const next = hsl.map((c, i) => (i === index ? clamp(value, index === 0 ? 359 : 100) : c)) as unknown as Hsl;
    const nextHex = rgbToHex(hslToRgb(next));
    setHex(nextHex);
    setText(nextHex);
    setError(undefined);
    setHsl(next);
  };
  const ratio = contrastRatio(rgb, hexToRgb(props.against) ?? [255, 255, 255]);
  const shown = (Math.floor(ratio * 10) / 10).toFixed(1);
  const good = ratio >= 4.5;
  const Dropper = eyeDropper();
  const apply = () => {
    if (!error && text.trim() !== '') props.onApply(hex);
  };
  return (
    <div className={styles.moreBox}>
      <TextField label={t('color.hex')} value={text} onChange={onText} error={error} onCommit={apply} />
      <div className={styles.fields}>
        <Num label={t('color.red')} value={rgb[0]} max={255} onChange={(v) => channel(0, v)} />
        <Num label={t('color.green')} value={rgb[1]} max={255} onChange={(v) => channel(1, v)} />
        <Num label={t('color.blue')} value={rgb[2]} max={255} onChange={(v) => channel(2, v)} />
        <Num label={t('color.hue')} value={hsl[0]} max={359} onChange={(v) => hslField(0, v)} />
        <Num label={t('color.saturation')} value={hsl[1]} max={100} onChange={(v) => hslField(1, v)} />
        <Num label={t('color.lightness')} value={hsl[2]} max={100} onChange={(v) => hslField(2, v)} />
      </div>
      <div className={styles.preview} style={{ background: hex }} data-color-swatch={hex} aria-hidden="true" />
      <p className={styles.badge} data-good={good} role="status">
        {t(good ? 'color.contrastGood' : 'color.contrastLow', { ratio: shown })}
      </p>
      {dropperError && <p role="status">{t('color.eyedropperError')}</p>}
      <div className={styles.actions}>
        {Dropper && (
          <button
            type="button"
            className={styles.more}
            onClick={() => {
              setDropperError(false);
              new Dropper()
                .open()
                .then((result) => {
                  const parsed = parseColor(result.sRGBHex);
                  if (parsed.ok) set(parsed.hex);
                })
                .catch((e: unknown) => {
                  if ((e as { name?: string } | null)?.name !== 'AbortError') setDropperError(true);
                });
            }}
          >
            {t('color.eyedropper')}
          </button>
        )}
        <button type="button" className={styles.more} disabled={Boolean(error)} onClick={apply}>
          {t('color.apply')}
        </button>
      </div>
    </div>
  );
}

function Num(props: { label: string; value: number; max: number; onChange(value: string): void }) {
  const id = useId();
  // A draft lets a person clear the field and type a new number; it commits on blur or Enter.
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft.trim() !== '') props.onChange(draft);
    setDraft(null);
  };
  return (
    <div className={styles.num}>
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="number"
        min={0}
        max={props.max}
        value={draft ?? props.value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </div>
  );
}
