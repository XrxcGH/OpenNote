// Insert LaTeX (science helpers): a field with a live preview, a palette of common snippets, and conversion of pasted
// LaTeX. Pasting `$x^2$`, `$$…$$`, or `\(…\)` takes the marks off and picks the shape. Insert puts the equation at
// the caret of the page that is open, in the line or on its own line.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { RenderOptions, RenderResult } from '../../math';
import 'katex/dist/katex.min.css';
import { splitLatex } from '../../../editor/extensions/mathPaste';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { SNIPPETS, SNIPPET_GROUPS, applySnippet, withoutGaps } from '../science/snippets';
import type { SnippetGroup } from '../science/snippets';
import { insertIntoPage } from './CalculatorTool';
import { loadStored, saveStored } from './storage';
import extra from './extra.module.css';
import science from './science.module.css';
import styles from './tools.module.css';

const STORE = 'latex';

interface Saved {
  source: string;
  display: boolean;
}

/** What a paste becomes: the source and the shape, when the text was one equation with its marks. Null otherwise. */
export function convertPaste(text: string): Saved | null {
  const pieces = splitLatex(text);
  if (pieces === null) return null;
  const math = pieces.filter((piece) => piece.kind === 'math');
  const words = pieces.some((piece) => piece.kind === 'text' && piece.text.trim() !== '');
  if (math.length !== 1 || words || math[0].kind !== 'math') return null;
  return { source: math[0].source, display: math[0].display };
}

export function LatexTool() {
  const [state, setState] = useState<Saved>(() => {
    const stored = loadStored<Partial<Saved>>(STORE, {});
    return { source: typeof stored.source === 'string' ? stored.source : '', display: stored.display === true };
  });
  const [group, setGroup] = useState<SnippetGroup>('basics');
  const [note, setNote] = useState('');
  // KaTeX is large, so it loads when this window opens and not with the rest of the tools.
  const [render, setRender] = useState<((latex: string, options: RenderOptions) => RenderResult) | null>(null);
  useEffect(() => {
    void import('../../math').then((math) => setRender(() => math.renderLatex));
  }, []);
  const area = useRef<HTMLTextAreaElement>(null);
  const pendingSelect = useRef<[number, number] | null>(null);

  const update = (next: Saved) => {
    setState(next);
    saveStored(STORE, next);
  };
  useEffect(() => {
    const range = pendingSelect.current;
    if (range === null || area.current === null) return;
    pendingSelect.current = null;
    area.current.focus();
    area.current.setSelectionRange(range[0], range[1]);
  }, [state.source]);

  const clean = withoutGaps(state.source).trim();
  const drawn = useMemo(
    () => (clean === '' || render === null ? null : render(clean, { displayMode: state.display })),
    [clean, render, state.display],
  );

  const insert = () => {
    if (clean === '') return;
    const ok = insertIntoPage({ math: { source: clean, display: state.display } });
    announce(t(ok ? 'science.latex.inserted' : 'science.latex.noPage'));
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(clean);
      announce(t('science.latex.copied'));
    } catch {
      announce(t('science.latex.noPage'));
    }
  };

  return (
    <div className={styles.tool}>
      <label className={extra.field}>
        {t('science.latex.source')}
        <textarea
          ref={area}
          className={science.area}
          value={state.source}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-describedby="latex-help"
          aria-invalid={drawn !== null && !drawn.ok ? true : undefined}
          onChange={(event) => {
            setNote('');
            update({ ...state, source: event.target.value });
          }}
          onPaste={(event) => {
            const converted = convertPaste(event.clipboardData.getData('text/plain'));
            if (converted === null) return;
            event.preventDefault();
            update(converted);
            setNote(
              t('science.latex.converted', {
                shape: t(converted.display ? 'science.latex.convertedDisplay' : 'science.latex.convertedInline'),
              }),
            );
          }}
        />
      </label>
      <p id="latex-help" className={styles.note}>
        {t('science.latex.sourceHelp')}
      </p>
      <div role="group" aria-label={t('science.latex.shape')} className={science.choice}>
        {[false, true].map((display) => (
          <button
            key={String(display)}
            type="button"
            className={science.toggle}
            aria-pressed={state.display === display}
            onClick={() => update({ ...state, display })}
          >
            {t(display ? 'science.latex.display' : 'science.latex.inline')}
          </button>
        ))}
      </div>
      <p className={styles.note} role="status">
        {note}
      </p>
      <div className={science.preview} aria-label={t('science.latex.preview')} role="group">
        {drawn === null ? (
          <span className={styles.note}>{t('science.latex.previewEmpty')}</span>
        ) : drawn.ok ? (
          <span dangerouslySetInnerHTML={{ __html: drawn.html }} />
        ) : (
          <span className={styles.problem} role="alert">
            {t('science.latex.problem', { message: drawn.error.message })}
          </span>
        )}
      </div>
      <div className={styles.buttons}>
        <Button variant="primary" disabled={clean === ''} onClick={insert}>
          {t('science.latex.insert')}
        </Button>
        <Button variant="quiet" disabled={clean === ''} onClick={() => void copy()}>
          {t('science.latex.copy')}
        </Button>
      </div>
      <div className={styles.tabs} role="tablist" aria-label={t('science.latex.snippets')}>
        {SNIPPET_GROUPS.map((one) => (
          <button
            key={one}
            type="button"
            role="tab"
            id={`latex-tab-${one}`}
            aria-selected={group === one}
            aria-controls="latex-snippets"
            className={styles.tab}
            onClick={() => setGroup(one)}
          >
            {t(`science.latex.snippetGroups.${one}`)}
          </button>
        ))}
      </div>
      <div id="latex-snippets" role="tabpanel" aria-labelledby={`latex-tab-${group}`} className={science.snippets}>
        {SNIPPETS.filter((one) => one.group === group).map((one) => (
          <button
            key={one.id}
            type="button"
            className={science.snippet}
            aria-label={t(`science.latex.snippet.${one.id}` as MessageKey)}
            title={t(`science.latex.snippet.${one.id}` as MessageKey)}
            onClick={() => {
              const at = area.current;
              const start = at?.selectionStart ?? state.source.length;
              const end = at?.selectionEnd ?? state.source.length;
              const next = applySnippet(state.source, start, end, one);
              pendingSelect.current = [next.from, next.to];
              update({ ...state, source: next.text });
            }}
          >
            {one.face ?? one.latex}
          </button>
        ))}
      </div>
      <p className={styles.note}>{t('science.latex.pasteHint')}</p>
    </div>
  );
}
