// The cell format bar (DESIGN 10.1): a second row of the table's toolbar with the formats of a cell. Shared formats
// (Bold, Italic, Underline, Strikethrough, Text color) run the shared commands and show the Home tab's glyphs.
// The rest are table-only and write the cell style (actions.ts). In a narrow bar the least used buttons move into
// a More menu. A press never takes focus from the cell, so the caret stays where it was.
import { AlignBottomIcon } from '@phosphor-icons/react/dist/csr/AlignBottom';
import { AlignCenterVerticalIcon } from '@phosphor-icons/react/dist/csr/AlignCenterVertical';
import { AlignTopIcon } from '@phosphor-icons/react/dist/csr/AlignTop';
import { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowClockwise';
import { CaretDownIcon } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CurrencyDollarIcon } from '@phosphor-icons/react/dist/csr/CurrencyDollar';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { EraserIcon } from '@phosphor-icons/react/dist/csr/Eraser';
import { GridFourIcon } from '@phosphor-icons/react/dist/csr/GridFour';
import { HashIcon } from '@phosphor-icons/react/dist/csr/Hash';
import { MinusIcon } from '@phosphor-icons/react/dist/csr/Minus';
import { PaintBucketIcon } from '@phosphor-icons/react/dist/csr/PaintBucket';
import { PercentIcon } from '@phosphor-icons/react/dist/csr/Percent';
import { PlusIcon } from '@phosphor-icons/react/dist/csr/Plus';
import { TextAaIcon } from '@phosphor-icons/react/dist/csr/TextAa';
import { TextAlignCenterIcon } from '@phosphor-icons/react/dist/csr/TextAlignCenter';
import { TextAlignJustifyIcon } from '@phosphor-icons/react/dist/csr/TextAlignJustify';
import { TextAlignLeftIcon } from '@phosphor-icons/react/dist/csr/TextAlignLeft';
import { TextAlignRightIcon } from '@phosphor-icons/react/dist/csr/TextAlignRight';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType, RefObject } from 'react';
import { commandOn, runEditorCommand } from '../../../../editor/commands/catalog';
import { BODY_POINTS } from '../../../../editor/commands/sizes';
import { sessionStore } from '../../../../state/session';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { IconButton, Popover, openMenu } from '../../../../ui';
import type { IconProps, MenuItemSpec } from '../../../../ui';
import { ColorPalette } from '../../../../ui/color';
import type { ColorPick, Scheme } from '../../../../ui/color';
import { iconFor } from '../../../../ui/commandIcons';
import { FontPicker, SizeBox, useFontCatalog } from '../../../fonts';
import type { TableExtraHost } from '../../../page';
import styles from './toolbar.module.css';
import { currentScheme } from '../../sheet/render/plugin';
import { appLocale } from '../../smart/locale';
import {
  borderLine,
  borderUse,
  cellsOf,
  changeDecimals,
  changeThousands,
  clearFormats,
  setAlignH,
  setAlignV,
  setBorderLine,
  setBorders,
  setCells,
  setChoice,
  setCurrency,
  setFill,
  setPercent,
  setRotate,
  setTextColor,
  setUnderline,
  setWrap,
} from './actions';
import type { Cells, UnderlineKind } from './actions';
import { BORDER_IDS, BORDER_LABELS } from './borders';
import { addOpener, hostOfBlock, hostsVersion, subscribeHosts } from './hosts';
import { FORMAT_CHOICES, choiceOf } from './numberFormats';
import { againstFor, paperOf } from './palette';
import { moveFocus, rove } from './roving';

/** The bar is this narrow (in pixels) or less when the least used buttons move into the More menu. */
const NARROW = 620;

type Icon = ComponentType<IconProps>;

const LINE_STYLES: readonly (readonly [string, MessageKey])[] = [
  ['thin', 'sheetToolbar.styleThin'],
  ['medium', 'sheetToolbar.styleMedium'],
  ['thick', 'sheetToolbar.styleThick'],
  ['hair', 'sheetToolbar.styleHair'],
  ['dotted', 'sheetToolbar.styleDotted'],
  ['dashed', 'sheetToolbar.styleDashed'],
  ['double', 'sheetToolbar.styleDouble'],
];

const ROTATIONS: readonly (readonly [number | 'stacked', MessageKey])[] = [
  [0, 'sheetToolbar.rotateNone'],
  [45, 'sheetToolbar.rotateUp'],
  [-45, 'sheetToolbar.rotateDown'],
  [90, 'sheetToolbar.rotateVertical'],
  ['stacked', 'sheetToolbar.rotateStacked'],
];

const WRAPS: readonly (readonly ['wrap' | 'overflow' | 'clip', MessageKey])[] = [
  ['wrap', 'sheetToolbar.wrapWrap'],
  ['overflow', 'sheetToolbar.wrapOverflow'],
  ['clip', 'sheetToolbar.wrapClip'],
];

const UNDERLINES: readonly (readonly [UnderlineKind, MessageKey])[] = [
  ['none', 'sheetToolbar.underlineNone'],
  ['single', 'sheetToolbar.underlineSingle'],
  ['double', 'sheetToolbar.underlineDouble'],
  ['singleAccounting', 'sheetToolbar.underlineSingleAccounting'],
  ['doubleAccounting', 'sheetToolbar.underlineDoubleAccounting'],
];

/** The notebook the page is in, whose recent colors the palette keeps. */
function notebookOf(): string {
  const { location } = sessionStore.get();
  return 'notebookId' in location && location.notebookId ? location.notebookId : 'notebook';
}

const noFonts = { list: () => Promise.resolve([]) };

type Run = (action: unknown) => void;

function useHost(block: string): TableExtraHost | undefined {
  useSyncExternalStore(subscribeHosts, hostsVersion);
  return hostOfBlock(block);
}

interface ToolProps {
  tool: string;
  name: MessageKey;
  icon: Icon | undefined;
  /** The element the tool's menu or palette anchors to. */
  onPress(anchor: HTMLElement): void;
  pressed?: boolean;
  popup?: 'menu' | 'dialog';
  expanded?: boolean;
}

/** A bar button. Its wrapper carries the tool name, which the palette commands press, and anchors its menu. */
function Tool({ tool, name, icon, onPress, pressed, popup, expanded }: ToolProps) {
  const slot = useRef<HTMLSpanElement>(null);
  return (
    <span data-cell-tool={tool} ref={slot}>
      <IconButton
        label={t(name)}
        icon={icon ?? TextAaIcon}
        tabIndex={-1}
        onPress={() => slot.current && onPress(slot.current)}
        pressed={pressed}
        hasPopup={popup}
        expanded={expanded}
      />
    </span>
  );
}

/** A wrapper ref plus an anchor ref to a button inside it, so a popover anchors to (and returns focus to) a control that can take focus. */
function useButtonAnchor(last = false) {
  const wrap = useRef<HTMLSpanElement>(null);
  const [anchor] = useState(
    () =>
      ({
        get current() {
          const all = wrap.current?.querySelectorAll<HTMLElement>('button');
          return (last ? all?.[all.length - 1] : all?.[0]) ?? wrap.current;
        },
      }) as RefObject<HTMLElement | null>,
  );
  return { wrap, anchor };
}

interface PaletteProps {
  name: MessageKey;
  current?: string;
  fill?: boolean;
  onPick(choice: ColorPick): void;
  /** The element the popover opens under. */
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose(): void;
  /** The color the contrast badge compares with. */
  against?: string;
  /** The page's paper, so the Paper column follows the page and not the app's surface. */
  paper?: string;
}

function PalettePopover({ name, current, fill, onPick, anchor, open, onClose, against, paper }: PaletteProps) {
  return (
    <Popover anchor={anchor} label={t(name)} open={open} onClose={onClose}>
      <ColorPalette
        scheme={currentScheme()}
        notebookId={notebookOf()}
        automatic={!fill}
        noColor={fill}
        current={current}
        onPick={onPick}
        against={against}
        theme={paper ? { background: paper } : undefined}
      />
    </Popover>
  );
}

interface ColorToolProps {
  block: string;
  against: string;
  paper?: string;
  tool: 'fill' | 'textColor';
  name: MessageKey;
  paletteName: MessageKey;
  icon: Icon | undefined;
  current?: string;
  onPick(choice: ColorPick): void;
}

/** A button that opens a color palette in a popover. */
function ColorTool({ block, against, paper, tool, name, paletteName, icon, current, onPick }: ColorToolProps) {
  const { wrap, anchor } = useButtonAnchor();
  const [open, setOpen] = useState(false);
  // The palette command opens this table's own palette (hosts.ts).
  useEffect(() => addOpener(block, tool, () => setOpen(true)), [block, tool]);
  return (
    <span ref={wrap}>
      <Tool tool={tool} name={name} icon={icon} popup="dialog" expanded={open} onPress={() => setOpen(!open)} />
      <PalettePopover
        name={paletteName}
        current={current}
        fill={tool === 'fill'}
        against={against}
        paper={paper}
        anchor={anchor}
        open={open}
        onClose={() => setOpen(false)}
        onPick={(choice) => {
          setOpen(false);
          onPick(choice);
        }}
      />
    </span>
  );
}

/** The split Borders button: the last preset, and the menu of all of them with line style and color. */
function BordersTool({ host, run, paper }: { host: TableExtraHost; run: Run; paper?: string }) {
  const { wrap, anchor } = useButtonAnchor(true);
  const [color, setColor] = useState(false);
  useEffect(() => addOpener(host.block, 'borderColor', () => setColor(true)), [host.block]);
  const menu = (anchor: HTMLElement) => {
    const items: MenuItemSpec[] = BORDER_IDS.map((id) => ({
      id,
      label: t(BORDER_LABELS[id]),
      onSelect: () => run(setBorders(host, id)),
    }));
    items.push(
      {
        id: 'style',
        label: t('sheetToolbar.borderStyle'),
        separatorBefore: true,
        submenu: LINE_STYLES.map(([value, label]) => ({
          id: `style.${value}`,
          label: t(label),
          kind: 'radio' as const,
          checked: borderLine.style === value,
          onSelect: () => setBorderLine({ style: value }),
        })),
      },
      { id: 'color', label: t('sheetToolbar.borderColor'), onSelect: () => setColor(true) },
    );
    void openMenu({ label: t('sheetToolbar.borders'), items, anchor, returnFocus: host.editor.view.dom });
  };
  return (
    <span ref={wrap}>
      <Tool
        tool="borders"
        name="sheetToolbar.borders"
        icon={GridFourIcon}
        onPress={() => run(setBorders(host, borderUse.last))}
      />
      <Tool tool="bordersMenu" name="sheetToolbar.borders" icon={CaretDownIcon} popup="menu" onPress={menu} />
      <PalettePopover
        name="sheetToolbar.borderColor"
        paper={paper}
        against={paper}
        anchor={anchor}
        open={color}
        onClose={() => setColor(false)}
        onPick={(choice) => {
          setColor(false);
          setBorderLine({ color: choice.kind === 'color' ? choice.value : null });
          run(setBorders(host, borderUse.last));
        }}
      />
    </span>
  );
}

/** What every group of the bar reads: the table's host, the cells selected, and how to run an action. */
interface GroupProps {
  host: TableExtraHost;
  cells: Cells;
  run: Run;
  narrow: boolean;
  /** The page's paper, for the palettes. */
  paper?: string;
}

function menuAt(host: TableExtraHost, label: MessageKey, items: MenuItemSpec[], anchor: HTMLElement): void {
  void openMenu({ label: t(label), items, anchor, returnFocus: host.editor.view.dom });
}

/** Radio items for a list of values; the item that applies a value runs `apply`. */
function radios<V extends string | number>(
  list: readonly (readonly [V, MessageKey])[],
  id: string,
  checked: (value: V) => boolean,
  apply: (value: V) => void,
): MenuItemSpec[] {
  return list.map(([value, label]) => ({
    id: `${id}.${value}`,
    label: t(label),
    kind: 'radio' as const,
    checked: checked(value),
    onSelect: () => apply(value),
  }));
}

function FontGroup({ host, cells, run }: GroupProps) {
  const catalog = useFontCatalog(noFonts);
  const { style, whole } = cells;
  const textLevel = !whole && !host.editor.state.selection.empty;
  return (
    <span className={styles.group}>
      <FontPicker
        catalog={catalog}
        value={style.font?.family ?? null}
        onPick={(name) =>
          run(
            textLevel
              ? runEditorCommand(host.editor, 'format.font', { value: name })
              : setCells(host, { font: { family: name } }, ['font']),
          )
        }
      />
      <SizeBox
        value={style.font?.size ?? BODY_POINTS}
        onCommit={(points) =>
          run(
            textLevel
              ? runEditorCommand(host.editor, 'format.fontSize', { value: points })
              : setCells(host, { font: { size: points } }, ['textSize']),
          )
        }
      />
      <Tool
        tool="sizeUp"
        name="sheetToolbar.fontSizeUp"
        icon={iconFor('format.fontSizeUp')}
        onPress={() => run(runEditorCommand(host.editor, 'format.fontSizeUp', {}, { focus: false }))}
      />
      <Tool
        tool="sizeDown"
        name="sheetToolbar.fontSizeDown"
        icon={iconFor('format.fontSizeDown')}
        onPress={() => run(runEditorCommand(host.editor, 'format.fontSizeDown', {}, { focus: false }))}
      />
    </span>
  );
}

const pickValue = (choice: ColorPick): string | null => (choice.kind === 'color' ? choice.value : null);

function StyleGroup({ host, cells, run, paper }: GroupProps) {
  const { style, whole } = cells;
  const scheme: Scheme = currentScheme();
  const { font } = style;
  const state = host.editor.state;
  const shared = (tool: string, command: string, name: MessageKey, cell: boolean | undefined) => (
    <Tool
      tool={tool}
      name={name}
      icon={iconFor(command)}
      pressed={whole ? Boolean(cell) : commandOn(command, state) === true}
      onPress={() => run(runEditorCommand(host.editor, command, {}, { focus: false }))}
    />
  );
  return (
    <span className={styles.group}>
      {shared('bold', 'format.bold', 'sheetToolbar.bold', font?.bold)}
      {shared('italic', 'format.italic', 'sheetToolbar.italic', font?.italic)}
      {shared(
        'underline',
        'format.underline',
        'sheetToolbar.underline',
        !!font?.underline && font.underline !== 'none',
      )}
      <Tool
        tool="underlineMenu"
        name="sheetToolbar.underlineMenu"
        icon={CaretDownIcon}
        popup="menu"
        onPress={(anchor) =>
          menuAt(
            host,
            'sheetToolbar.underlineMenu',
            // Selected text has no accounting kinds.
            UNDERLINES.filter(
              ([kind]) => whole || host.editor.state.selection.empty || !kind.endsWith('Accounting'),
            ).map(([kind, label]) => ({
              id: kind,
              label: t(label),
              kind: 'radio' as const,
              checked: (font?.underline ?? 'none') === kind,
              onSelect: () => run(setUnderline(host, kind)),
            })),
            anchor,
          )
        }
      />
      {shared('strike', 'format.strike', 'sheetToolbar.strike', !!font?.strike && font.strike !== 'none')}
      <ColorTool
        block={host.block}
        against={againstFor('textColor', style, scheme, paper)}
        paper={paper}
        tool="textColor"
        name="sheetToolbar.textColor"
        paletteName="sheetToolbar.textPalette"
        icon={iconFor('format.textColor')}
        current={font?.color}
        onPick={(choice) => run(setTextColor(host, pickValue(choice)))}
      />
      <ColorTool
        block={host.block}
        against={againstFor('fill', style, scheme, paper)}
        paper={paper}
        tool="fill"
        name="sheetToolbar.fill"
        paletteName="sheetToolbar.fillPalette"
        icon={PaintBucketIcon}
        current={typeof style.fill === 'string' && style.fill !== 'none' ? style.fill : undefined}
        onPick={(choice) => run(setFill(host, pickValue(choice)))}
      />
    </span>
  );
}

function AlignGroup({ host, cells, run, narrow }: GroupProps) {
  const { align } = cells.style;
  const h = (value: 'left' | 'center' | 'right' | 'justify', name: MessageKey, icon: Icon) => (
    <Tool
      tool={`align.${value}`}
      name={name}
      icon={icon}
      pressed={align?.h === value}
      onPress={() => run(setAlignH(host, value))}
    />
  );
  const v = (value: 'top' | 'middle' | 'bottom', name: MessageKey, icon: Icon) => (
    <Tool
      tool={`valign.${value}`}
      name={name}
      icon={icon}
      pressed={(align?.v ?? 'top') === value}
      onPress={() => run(setAlignV(host, value))}
    />
  );
  const wrapMenu = (anchor: HTMLElement) =>
    menuAt(
      host,
      'sheetToolbar.wrapMenu',
      radios(
        WRAPS,
        'wrap',
        (value) => (align?.wrap ?? 'wrap') === value,
        (value) => run(setWrap(host, value)),
      ),
      anchor,
    );
  const rotateMenu = (anchor: HTMLElement) =>
    menuAt(
      host,
      'sheetToolbar.rotate',
      radios(
        ROTATIONS,
        'rotate',
        (value) => (align?.rotate ?? 0) === value,
        (value) => run(setRotate(host, value)),
      ),
      anchor,
    );
  return (
    <span className={styles.group}>
      {h('left', 'sheetToolbar.alignLeft', TextAlignLeftIcon)}
      {h('center', 'sheetToolbar.alignCenter', TextAlignCenterIcon)}
      {h('right', 'sheetToolbar.alignRight', TextAlignRightIcon)}
      {h('justify', 'sheetToolbar.alignJustify', TextAlignJustifyIcon)}
      {narrow ? null : (
        <>
          {v('top', 'sheetToolbar.alignTop', AlignTopIcon)}
          {v('middle', 'sheetToolbar.alignMiddle', AlignCenterVerticalIcon)}
          {v('bottom', 'sheetToolbar.alignBottom', AlignBottomIcon)}
          <Tool tool="wrap" name="sheetToolbar.wrapMenu" icon={TextAaIcon} popup="menu" onPress={wrapMenu} />
          <Tool tool="rotate" name="sheetToolbar.rotate" icon={ArrowClockwiseIcon} popup="menu" onPress={rotateMenu} />
        </>
      )}
    </span>
  );
}

function NumberGroup({ host, cells, run, narrow }: GroupProps) {
  const formatMenu = (anchor: HTMLElement) =>
    menuAt(
      host,
      'sheetToolbar.numberFormat',
      FORMAT_CHOICES.map((choice) => ({
        id: choice.id,
        label: t(choice.label),
        kind: 'radio' as const,
        checked: choice.id === choiceOf(cells.style.fmt, appLocale()),
        onSelect: () => run(setChoice(host, choice.id)),
      })),
      anchor,
    );
  return (
    <span className={styles.group}>
      <Tool tool="format" name="sheetToolbar.numberFormat" icon={HashIcon} popup="menu" onPress={formatMenu} />
      <Tool
        tool="currency"
        name="sheetToolbar.currency"
        icon={CurrencyDollarIcon}
        onPress={() => run(setCurrency(host))}
      />
      <Tool tool="percent" name="sheetToolbar.percent" icon={PercentIcon} onPress={() => run(setPercent(host))} />
      {narrow ? null : (
        <>
          <Tool
            tool="thousands"
            name="sheetToolbar.thousands"
            icon={HashIcon}
            onPress={() => run(changeThousands(host))}
          />
          <Tool
            tool="fewer"
            name="sheetToolbar.fewerDecimals"
            icon={MinusIcon}
            onPress={() => run(changeDecimals(host, -1))}
          />
          <Tool
            tool="more"
            name="sheetToolbar.moreDecimals"
            icon={PlusIcon}
            onPress={() => run(changeDecimals(host, 1))}
          />
        </>
      )}
    </span>
  );
}

/** What the narrow bar moves into one menu: the vertical alignments, wrapping, rotation, and the digit buttons. */
function moreItems({ host, cells, run }: GroupProps, anchor: HTMLElement): MenuItemSpec[] {
  const { align } = cells.style;
  const wrap = radios(
    WRAPS,
    'wrap',
    (value) => (align?.wrap ?? 'wrap') === value,
    (value) => run(setWrap(host, value)),
  );
  const rotate = radios(
    ROTATIONS,
    'rotate',
    (value) => (align?.rotate ?? 0) === value,
    (value) => run(setRotate(host, value)),
  );
  const vertical = (['top', 'middle', 'bottom'] as const).map((value) => ({
    id: value,
    label: t(`sheetToolbar.align${value[0].toUpperCase()}${value.slice(1)}` as MessageKey),
    onSelect: () => run(setAlignV(host, value)),
  }));
  const digits: MenuItemSpec[] = [
    {
      id: 'thousands',
      label: t('sheetToolbar.thousands'),
      separatorBefore: true,
      onSelect: () => run(changeThousands(host)),
    },
    { id: 'fewer', label: t('sheetToolbar.fewerDecimals'), onSelect: () => run(changeDecimals(host, -1)) },
    { id: 'more', label: t('sheetToolbar.moreDecimals'), onSelect: () => run(changeDecimals(host, 1)) },
  ];
  const sub = (id: string, label: MessageKey, submenu: MenuItemSpec[]): MenuItemSpec => ({
    id,
    label: t(label),
    submenu,
    onSelect: () => menuAt(host, label, submenu, anchor),
  });
  return [
    ...vertical,
    sub('wrap', 'sheetToolbar.wrapMenu', wrap),
    sub('rotate', 'sheetToolbar.rotate', rotate),
    ...digits,
  ];
}

function ClearGroup(props: GroupProps) {
  const { host, run, narrow } = props;
  return (
    <span className={styles.group}>
      <Tool tool="clear" name="sheetToolbar.clearFormats" icon={EraserIcon} onPress={() => run(clearFormats(host))} />
      {narrow ? (
        <Tool
          tool="more.menu"
          name="sheetToolbar.more"
          icon={DotsThreeIcon}
          popup="menu"
          onPress={(anchor) => menuAt(host, 'sheetToolbar.more', moreItems(props, anchor), anchor)}
        />
      ) : null}
    </span>
  );
}

/** Whether the bar is narrow: it watches its own width. It follows the element, so a bar that shows later or again is watched. */
function useNarrow(element: HTMLElement | null): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => setNarrow(element.clientWidth <= NARROW));
    watch.observe(element);
    return () => watch.disconnect();
  }, [element]);
  return narrow;
}

export interface CellFormatBarProps {
  block: string;
}

export function CellFormatBar({ block }: CellFormatBarProps) {
  const host = useHost(block);
  // The element is state, not a ref, so the width watch starts when the bar first shows and again after it remounts.
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  const narrow = useNarrow(bar);
  const cells = host ? cellsOf(host) : null;
  const attach = useCallback((element: HTMLDivElement | null) => setBar(element), []);
  // Every button is a toolbar item, and the bar has one tab stop (roving.ts).
  useLayoutEffect(() => {
    bar?.querySelectorAll('[data-cell-tool] button').forEach((one) => one.setAttribute('data-tool', ''));
    if (bar) rove(bar);
  });
  if (!host || !cells) return null;
  const run: Run = (action) => void Promise.resolve(action).then(() => host.editor.commands.focus());
  const group = { host, cells, run, narrow, paper: paperOf(host.element) };
  return (
    <div
      ref={attach}
      role="toolbar"
      aria-label={t('sheetToolbar.label')}
      className={styles.formatBar}
      onKeyDown={moveFocus}
      onFocus={(event) => {
        // Whichever button has focus is the tab stop, so Shift+Tab and Tab return to it.
        if (event.target instanceof HTMLElement && event.target.hasAttribute('data-tool'))
          rove(event.currentTarget, event.target);
      }}
      onMouseDown={(event) => {
        // A press on a button keeps the caret in its cell.
        if ((event.target as HTMLElement).closest('button')) event.preventDefault();
      }}
    >
      <FontGroup {...group} />
      <StyleGroup {...group} />
      <span className={styles.group}>
        <BordersTool host={host} run={run} paper={group.paper} />
      </span>
      <AlignGroup {...group} />
      <NumberGroup {...group} />
      <ClearGroup {...group} />
    </div>
  );
}
