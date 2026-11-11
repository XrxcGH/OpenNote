// The Format pane (text DESIGN.md 5.3): a side pane with six tabs for text, advanced text, paragraphs, tab stops,
// borders, and lists. It also has a preview line and Reveal formatting. Every field is labeled, takes units, and shows
// its range message when a value is refused. In style mode (Modify style) the same fields edit one style.
import { useEffect, useId, useReducer, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';
import type { Editor } from '@tiptap/core';
import type { EditorState } from '@tiptap/pm/state';
import type { FontsClient } from '../../../platform/types';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Button, showToast } from '../../../ui';
import { resolveColor } from '../../../ui/color';
import { FontPicker, useFontCatalog } from '../../fonts';
import { targetEditor } from '../formattingBar/target';
import { builtInLabel } from '../styles/gallery';
import { patchStyle, styleLabel, withSheetStyle } from '../styles/model';
import { resolveStyle } from '../styles/resolve';
import { notebookStyles, pageSheet, saveStyles, shownContext } from '../styles/store';
import { BordersPanel } from './BordersPanel';
import { ColorField, currentScheme } from './ColorPicker';
import { Box, Check, Choice, Group } from './controls';
import { TABS, fieldById } from './fields';
import type { Field, StyleValues, TabId } from './fields';
import { fieldLabel } from './labels';
import { ListsPanel } from './ListsPanel';
import { paneKey } from './paneKey';
import { revealFormatting } from './reveal';
import { TabsPanel } from './TabsPanel';
import styles from './FormatPane.module.css';

type Groups = readonly { title: MessageKey; ids: readonly string[] }[];

/** The groups of the three field tabs, by field id. */
const GROUPS: Readonly<Partial<Record<TabId, Groups>>> = {
  text: [
    { title: 'textPane.group.font', ids: ['font', 'weight', 'size', 'italic', 'color', 'highlight'] },
    {
      title: 'textPane.group.effects',
      ids: [
        'underline',
        'underlineColor',
        'strike',
        'superscript',
        'subscript',
        'caps',
        'emboss',
        'engrave',
        'outline',
        'shadow',
      ],
    },
  ],
  advanced: [
    { title: 'textPane.group.spacing', ids: ['scale', 'tracking', 'shift', 'kern'] },
    { title: 'textPane.group.opentype', ids: ['ligatures', 'numberForms', 'numberSpacing', 'stylisticSet', 'zero'] },
  ],
  paragraph: [
    { title: 'textPane.group.general', ids: ['align', 'outlineLevel', 'dir'] },
    { title: 'textPane.group.indentation', ids: ['indentStart', 'indentEnd', 'special', 'specialBy'] },
    { title: 'textPane.group.spacingPara', ids: ['before', 'after', 'lineRule', 'lineValue', 'contextual'] },
    { title: 'textPane.group.pagination', ids: ['keepNext', 'keepLines', 'breakBefore', 'widows', 'hyphenate'] },
  ],
};

/** The tabs a style can be edited on: the others have no style keys here. */
const STYLE_TABS: readonly TabId[] = ['text', 'advanced', 'paragraph'];

const unitText = (unit: Field['unit']) =>
  unit === '%' ? t('textPane.unitPercent') : unit === 'pt' ? t('textPane.unitPoints') : undefined;

export interface FormatPaneProps {
  notebook: string;
  /** The tab shown first. */
  tab?: TabId;
  /** The name of a style to edit instead of the selection. */
  style?: string;
  /** The device's fonts, for the font box. Without them the font is a plain text box. */
  fonts?: FontsClient;
  onClose(): void;
  /** The editor the fields act on: the shown page's focused or last-used text block. */
  editorOf?: () => Editor | null;
}

/** The editor, and a function that draws the pane again. It also follows the selection and the focus. */
function useEditor(editorOf: () => Editor | null): { editor: Editor | null; refresh(): void } {
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  const editor = editorOf();
  const drawn = useRef<string | null>(null);
  const bump = () => {
    drawn.current = editor ? paneKey(editor.state) : null;
    redraw();
  };
  useEffect(() => {
    if (!editor) return undefined;
    // Typing at a caret shows the same format, so it does not draw the pane (a key per transaction was too much).
    const change = () => {
      const key = paneKey(editor.state);
      if (key !== null && key === drawn.current) return;
      drawn.current = key;
      redraw();
    };
    editor.on('transaction', change);
    editor.on('selectionUpdate', change);
    return () => {
      editor.off('transaction', change);
      editor.off('selectionUpdate', change);
    };
  }, [editor]);
  useEffect(() => {
    const again = () => redraw();
    document.addEventListener('focusin', again);
    return () => document.removeEventListener('focusin', again);
  }, []);
  return { editor, refresh: bump };
}

/** The look of the preview line from the fields of the selection or the style. */
function previewLook(read: (id: string) => string | boolean): CSSProperties {
  const text = (id: string) => {
    const value = read(id);
    return typeof value === 'string' && value !== 'mixed' ? value : '';
  };
  const css: CSSProperties = {};
  const font = text('font');
  if (font && !font.startsWith('+')) css.fontFamily = `"${font.replace(/["\\]/g, '')}"`;
  const size = Number(text('size'));
  if (size > 0) css.fontSize = `${Math.min(size, 24)}pt`;
  const weight = Number(text('weight'));
  if (weight > 0) css.fontWeight = weight;
  if (read('italic') === true) css.fontStyle = 'italic';
  const color = resolveColor(text('color'), currentScheme());
  if (color) css.color = color;
  const lines = [text('underline') ? 'underline' : '', text('strike') ? 'line-through' : ''].filter(Boolean);
  if (lines.length > 0) {
    css.textDecorationLine = lines.join(' ');
    const style = text('underline');
    if (style === 'double' || style === 'dotted' || style === 'dashed' || style === 'wavy') {
      css.textDecorationStyle = style;
    }
  }
  const caps = text('caps');
  if (caps === 'small') css.fontVariantCaps = 'small-caps';
  if (caps === 'all') css.textTransform = 'uppercase';
  const tracking = Number(text('tracking'));
  if (tracking !== 0 && Number.isFinite(tracking)) css.letterSpacing = `${tracking}pt`;
  if (read('superscript') === true) css.verticalAlign = 'super';
  if (read('subscript') === true) css.verticalAlign = 'sub';
  if (read('shadow') === true) css.textShadow = '1px 1px 2px currentColor';
  if (read('outline') === true) css.WebkitTextStroke = '0.5px currentColor';
  const features: string[] = [];
  const ligatures = text('ligatures');
  if (ligatures === 'liga-none') features.push('"liga" 0', '"clig" 0');
  if (ligatures === 'dlig' || ligatures === 'hlig') features.push(`"${ligatures}" 1`);
  const forms = text('numberForms');
  if (forms) features.push(`"${forms}" 1`);
  const spacing = text('numberSpacing');
  if (spacing) features.push(`"${spacing}" 1`);
  if (text('zero')) features.push('"zero" 1');
  if (features.length > 0) css.fontFeatureSettings = features.join(', ');
  return css;
}

type Commit = (id: string, input: string | boolean) => void;

interface Source {
  editor: Editor | null;
  /** The style being edited, or null for the selection. */
  style: string | null;
  values: StyleValues;
  notebook: string;
  refresh(): void;
}

/** Parses a typed value and applies it to the selection or the style. A bad value gives its message and changes nothing. */
function useCommit({ editor, style, values, notebook, refresh }: Source) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fail = (id: string, message: string) => setErrors((now) => ({ ...now, [id]: message }));
  const commit: Commit = (id, input) => {
    const field = fieldById(id);
    if (!field) return;
    const parsed = field.parse(input, editor?.state);
    if (!parsed.ok) return fail(id, parsed.message);
    fail(id, '');
    if (style && field.style) {
      const sheet = shownContext(notebook).notebook;
      const next = withSheetStyle(sheet, style, patchStyle(sheet[style], field.style.patch(parsed.value, values)));
      void saveStyles(notebook, next, { message: t('textPane.styleSaved') });
      return;
    }
    if (!editor) return void showToast({ message: t('textPane.noEditor') });
    const ran = field.apply(parsed.value)(editor.state, editor.view.dispatch);
    if (!ran && String(field.read(editor.state)) !== String(input)) fail(id, t('textPane.refused'));
    refresh();
  };
  return { errors, commit };
}

interface FontFieldProps {
  value: string;
  fonts: FontsClient;
  commit: Commit;
}

function FontField({ value, fonts, commit }: FontFieldProps) {
  const catalog = useFontCatalog(fonts);
  return (
    <div className={styles.field}>
      <span className={styles.label}>{fieldLabel('font')}</span>
      <FontPicker
        catalog={catalog}
        value={value === 'mixed' ? null : value || null}
        onPick={(name, weight) => {
          commit('font', name);
          if (weight !== undefined) commit('weight', String(weight));
        }}
      />
    </div>
  );
}

interface FieldViewProps {
  field: Field;
  shown: string | boolean;
  error?: string;
  notebook: string;
  fonts?: FontsClient;
  commit: Commit;
}

function FieldView({ field, shown, error, notebook, fonts, commit }: FieldViewProps) {
  const { id } = field;
  const label = fieldLabel(id);
  if (field.kind === 'toggle') {
    return (
      <Check label={label} value={shown === 'mixed' ? 'mixed' : shown === true} onCommit={(on) => commit(id, on)} />
    );
  }
  if (field.kind === 'choice') {
    const onCommit = (value: string) => commit(id, value);
    return <Choice label={label} field={id} options={field.options ?? []} value={String(shown)} onCommit={onCommit} />;
  }
  if (field.kind === 'color') {
    const value = shown === 'mixed' ? '' : String(shown);
    const onCommit = (next: string) => commit(id, next);
    return (
      <ColorField
        label={label}
        value={value}
        notebookId={notebook}
        checkContrast={id === 'color'}
        error={error}
        onCommit={onCommit}
      />
    );
  }
  if (id === 'font' && fonts) return <FontField value={String(shown)} fonts={fonts} commit={commit} />;
  return (
    <Box
      label={label}
      value={shown === 'mixed' ? '' : String(shown)}
      unit={unitText(field.unit)}
      placeholder={shown === 'mixed' ? t('textPane.mixed') : undefined}
      step={field.unit ? (id === 'size' ? 0.5 : 1) : undefined}
      error={error}
      onCommit={(text) => commit(id, text)}
    />
  );
}

interface BodyProps {
  tab: TabId;
  source: Source;
  state: EditorState | undefined;
  fonts?: FontsClient;
}

/** The fields of the Text, Advanced, and Paragraph tabs, in groups, and the preview line on Text. */
function FieldTab({ tab, source, state, fonts }: BodyProps) {
  const { errors, commit } = useCommit(source);
  const read = (field: Field): string | boolean => {
    if (source.style) return field.style ? field.style.read(source.values) : '';
    return state ? field.read(state) : '';
  };
  return (
    <>
      {GROUPS[tab]?.map((group) => (
        <Group key={group.title} title={t(group.title)}>
          {group.ids.map((id) => {
            const field = fieldById(id);
            if (!field || (source.style && !field.style)) return null;
            const props = {
              field,
              shown: read(field),
              error: errors[id] || undefined,
              notebook: source.notebook,
              fonts,
              commit,
            };
            return <FieldView key={id} {...props} />;
          })}
        </Group>
      ))}
      {tab === 'text' ? (
        <p
          className={styles.preview}
          style={previewLook((id) => read(fieldById(id)!))}
          aria-label={t('textPane.preview')}
        >
          {t('textPane.previewText')}
        </p>
      ) : null}
    </>
  );
}

function Panel(props: BodyProps): ReactNode {
  const { tab, source } = props;
  const { editor, notebook, refresh } = source;
  if (tab === 'tabs' || tab === 'borders' || tab === 'lists') {
    if (!editor) return <p className={styles.help}>{t('textPane.noEditor')}</p>;
    const shared = { editor, refresh, notebook };
    if (tab === 'tabs') return <TabsPanel {...shared} />;
    return tab === 'borders' ? <BordersPanel {...shared} /> : <ListsPanel {...shared} />;
  }
  if (!source.style && !editor) return <p className={styles.help}>{t('textPane.noEditor')}</p>;
  return <FieldTab {...props} />;
}

interface TabListProps {
  tabs: readonly TabId[];
  current: TabId;
  idBase: string;
  onChange(tab: TabId): void;
}

/** The tab buttons. Left and Right, Home and End move between them, and the last wraps to the first. */
function TabList({ tabs, current, idBase, onChange }: TabListProps) {
  const list = useRef<HTMLDivElement>(null);
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const at = tabs.indexOf(current);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    const next = tabs[(to + tabs.length) % tabs.length];
    onChange(next);
    list.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus();
  };
  return (
    <div ref={list} role="tablist" aria-label={t('textPane.tabsLabel')} className={styles.tabs} onKeyDown={keys}>
      {tabs.map((id) => (
        <button
          key={id}
          type="button"
          role="tab"
          id={`${idBase}-tab-${id}`}
          data-tab={id}
          aria-selected={current === id}
          aria-controls={`${idBase}-panel`}
          tabIndex={current === id ? 0 : -1}
          className={styles.tab}
          onClick={() => onChange(id)}
        >
          {t(`textPane.tab.${id}` as MessageKey)}
        </button>
      ))}
    </div>
  );
}

function Reveal({ state, notebook }: { state: EditorState | undefined; notebook: string }) {
  const [shown, setShown] = useState(false);
  const rows = state && shown ? revealFormatting(state, shownContext(notebook)) : [];
  return (
    <Group title={t('textPane.group.reveal')}>
      <Button variant="secondary" aria-expanded={shown} onClick={() => setShown(!shown)}>
        {t('textPane.reveal.show')}
      </Button>
      {shown ? (
        <ul className={styles.reveal} aria-label={t('textPane.reveal.listLabel')} aria-live="polite">
          {rows.length > 0 ? (
            rows.map((row) => <li key={`${row.key}-${row.source}`}>{row.text}</li>)
          ) : (
            <li>{t('textPane.reveal.none')}</li>
          )}
        </ul>
      ) : null}
    </Group>
  );
}

export function FormatPane({
  notebook,
  tab = 'text',
  style,
  fonts,
  onClose,
  editorOf = targetEditor,
}: FormatPaneProps) {
  useStore(notebookStyles, (all) => all[notebook]);
  useStore(pageSheet, (sheet) => sheet);
  const { editor, refresh } = useEditor(editorOf);
  const headingId = useId();
  const section = useRef<HTMLElement>(null);
  const idBase = useId();
  const tabs = style ? STYLE_TABS : TABS;
  const [current, setCurrent] = useState<TabId>(tabs.includes(tab) ? tab : 'text');
  // Opening the pane puts focus on its selected tab, so the keys reach it at once (the Styles pane does the same).
  useEffect(() => section.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(), []);
  const ctx = shownContext(notebook);
  const values = style ? resolveStyle(ctx, style).values : {};
  const source: Source = { editor, style: style ?? null, values, notebook, refresh };
  const named = style
    ? styleLabel(style, ctx.page?.[style] ?? ctx.notebook[style] ?? ctx.app[style], builtInLabel)
    : '';
  return (
    <section
      ref={section}
      aria-labelledby={headingId}
      className={styles.stack}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className={styles.head}>
        <h2 id={headingId} className={styles.heading}>
          {style ? t('textPane.titleStyle', { name: named }) : t('textPane.title')}
        </h2>
        <Button variant="quiet" onClick={onClose}>
          {t('textPane.close')}
        </Button>
      </div>
      {style ? <p className={styles.help}>{t('textPane.styleModeHint')}</p> : null}
      {style && ctx.page?.[style] ? <p className={styles.help}>{t('textPane.stylePageOverrides')}</p> : null}
      <TabList tabs={tabs} current={current} idBase={idBase} onChange={setCurrent} />
      <div role="tabpanel" id={`${idBase}-panel`} aria-labelledby={`${idBase}-tab-${current}`} className={styles.panel}>
        <Panel tab={current} source={source} state={editor?.state} fonts={fonts} />
      </div>
      {style ? null : <Reveal state={editor?.state} notebook={notebook} />}
    </section>
  );
}
