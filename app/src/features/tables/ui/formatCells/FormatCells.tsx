// The Format Cells dialog (DESIGN 10.3): Number, Alignment, Font, Border, and Fill tabs with one live preview cell.
// It edits a copy of the first selected cell's style and gives back only what changed (draft.ts), so a property the
// person never touched stays as it is on every selected cell. Controls are labeled native controls. The tabs are an
// ARIA tablist with arrow keys. The edge diagram of the Border tab is a set of toggle buttons named by edge.
import { useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { t } from '../../../../strings/t';
import { Dialog } from '../../../../ui/Dialog';
import type { Scheme } from '../../../../ui/color/parse';
import type { Locale } from '../../engine/locale';
import { localizeCode } from '../../engine/numfmt';
import type { CellBox, Step } from '../../sheet/formatTarget';
import type { CellStyle, StyleChange } from '../../sheet/model';
import { AlignmentTab } from './AlignmentTab';
import { BorderTab } from './BorderTab';
import { FillTab } from './FillTab';
import { FontTab } from './FontTab';
import { NumberTab } from './NumberTab';
import type { NumberFormat } from './NumberTab';
import { styleDiff, withFormat } from './draft';
import { edgeSteps } from './edges';
import type { Edges, Line } from './edges';
import { categoryOf, checkCode, codeFor, previewCode } from './numberCodes';
import { describePreview, previewCss } from './preview';
import styles from './formatCells.module.css';

const TABS = ['number', 'alignment', 'font', 'border', 'fill'] as const;
export type Tab = (typeof TABS)[number];

export interface FormatCellsProps {
  /** The first selected cell's style as the table draws it. */
  style: CellStyle;
  box: CellBox;
  edges: Edges;
  /** What the preview formats: the cell's number, or a sample. */
  sample: number;
  locale: Locale;
  scheme: Scheme;
  notebookId: string;
  /** The codes other cells of the page use, for the Custom list. */
  usedCodes: readonly string[];
  initialTab?: Tab;
  onApply(change: StyleChange | null, steps: Step[]): void;
  onCancel(): void;
}

interface TabStripProps {
  tab: Tab;
  setTab(tab: Tab): void;
  panel: string;
  strip: RefObject<HTMLDivElement | null>;
}

/** The tab buttons. Left and Right move between tabs, and only the chosen tab is a tab stop. */
function TabStrip({ tab, setTab, panel, strip }: TabStripProps) {
  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = TABS[(TABS.indexOf(tab) + step + TABS.length) % TABS.length];
    setTab(next);
    queueMicrotask(() => strip.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus());
  };
  return (
    <div ref={strip} role="tablist" aria-label={t('sheetFormat.tabs.label')} className={styles.tabs}>
      {TABS.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          data-tab={id}
          id={`${panel}-${id}`}
          aria-selected={tab === id}
          aria-controls={`${panel}-panel`}
          tabIndex={tab === id ? 0 : -1}
          className={styles.tab}
          onClick={() => setTab(id)}
          onKeyDown={move}
        >
          {t(`sheetFormat.tabs.${id}`)}
        </button>
      ))}
    </div>
  );
}

/** The working copy: the style, the edges, and the number format, with the code the number tab writes. */
function useDraft(props: FormatCellsProps) {
  const { style: initial, locale } = props;
  const [style, setStyle] = useState<CellStyle>(initial);
  const [edges, setEdges] = useState<Edges>(props.edges);
  const [line, setLine] = useState<Line>({ style: 'thin' });
  const start = useMemo(() => categoryOf(initial.fmt, locale), [initial.fmt, locale]);
  const [format, setFormat] = useState<NumberFormat>({
    category: start.category,
    options: start.options,
    custom: start.category === 'custom' ? localizeCode(initial.fmt ?? '', locale) : '',
  });
  const [touched, setTouched] = useState(false);
  // undefined: the custom code does not compile, so OK waits. null: General.
  const code = useMemo<string | null | undefined>(() => {
    if (!touched) return initial.fmt ?? null;
    if (format.category !== 'custom') return codeFor(format.category, format.options, locale);
    const checked = checkCode(format.custom, locale);
    return checked.ok ? checked.code : undefined;
  }, [touched, format, locale, initial.fmt]);
  const final = code === undefined ? style : withFormat(style, code);
  const changeFormat = (next: NumberFormat) => {
    setTouched(true);
    setFormat(next);
  };
  return { style, setStyle, edges, setEdges, line, setLine, format, changeFormat, final, invalid: code === undefined };
}

/** The dialog. It shows the five tabs and one preview cell, and reports the change on OK. */
export function FormatCells(props: FormatCellsProps) {
  const { style: initial, box, locale, scheme, notebookId, usedCodes, sample, onApply, onCancel } = props;
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'number');
  const draft = useDraft(props);
  const strip = useRef<HTMLDivElement>(null);
  const panel = useId();
  const shown = previewCode(draft.final.fmt ?? '', sample, locale) ?? String(sample);
  const apply = () => {
    if (!draft.invalid) onApply(styleDiff(initial, draft.final), edgeSteps(box, props.edges, draft.edges));
  };
  const common = { style: draft.style, set: draft.setStyle, scheme, notebookId };
  return (
    <Dialog
      title={t('sheetFormat.title')}
      size="large"
      onDismiss={onCancel}
      actions={[
        { id: 'cancel', label: t('sheetFormat.cancel'), variant: 'secondary', onPress: onCancel },
        { id: 'ok', label: t('sheetFormat.ok'), variant: 'primary', onPress: apply, disabled: draft.invalid },
      ]}
    >
      <div className={styles.dialog}>
        <TabStrip tab={tab} setTab={setTab} panel={panel} strip={strip} />
        <div role="tabpanel" id={`${panel}-panel`} aria-labelledby={`${panel}-${tab}`} className={styles.panel}>
          {tab === 'number' ? (
            <NumberTab
              format={draft.format}
              setFormat={draft.changeFormat}
              locale={locale}
              usedCodes={usedCodes}
              sample={sample}
              initialCode={initial.fmt}
            />
          ) : null}
          {tab === 'alignment' ? <AlignmentTab {...common} /> : null}
          {tab === 'font' ? <FontTab {...common} /> : null}
          {tab === 'border' ? (
            <BorderTab
              box={box}
              edges={draft.edges}
              setEdges={draft.setEdges}
              line={draft.line}
              setLine={draft.setLine}
              scheme={scheme}
              notebookId={notebookId}
            />
          ) : null}
          {tab === 'fill' ? <FillTab {...common} /> : null}
        </div>
        <div className={styles.previewBox}>
          <span className={styles.previewTitle}>{t('sheetFormat.preview')}</span>
          <div className={styles.previewCell} role="img" aria-label={describePreview(draft.final, shown)}>
            <span style={previewCss(draft.final, draft.edges, scheme)} className={styles.previewInner}>
              {shown}
            </span>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
