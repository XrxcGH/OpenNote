// A diagram drawn from text (Further features, Phase 7): the text on one side and the drawing under it, redrawn a
// moment after each edit. The text is the diagram's accessible form too. Flowcharts, sequence diagrams, timelines,
// and class diagrams start from an example. The drawing can be saved as an SVG, which stays sharp at any size.
import { useEffect, useRef, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, showToast } from '../../../ui';
import { saveBytes } from '../../study';
import { STARTERS, STARTER_TEXT, kindOf } from './kind';
import type { Drawn } from './render';
import styles from './diagram.module.css';

interface Props {
  source: string;
  readOnly: boolean;
  onChange(source: string): void;
}

export function DiagramPanel({ source, readOnly, onChange }: Props) {
  const [text, setText] = useState(source);
  const [drawn, setDrawn] = useState<Drawn | null>(null);
  const sent = useRef(source);

  // Undo, redo, or another window changed the block.
  useEffect(() => {
    if (source !== sent.current) {
      sent.current = source;
      setText(source);
    }
  }, [source]);

  // Redraw a moment after typing stops, and save the text then too.
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      if (text !== sent.current) {
        sent.current = text;
        onChange(text);
      }
      void import('./render').then(({ drawDiagram }) =>
        drawDiagram(text).then((result) => {
          if (current) setDrawn(result);
        }),
      );
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [text, onChange]);

  const kind = kindOf(text);
  const save = async () => {
    if (!drawn?.ok) return;
    try {
      const saved = await saveBytes(
        'diagram.svg',
        t('study.diagram.svgLabel'),
        new TextEncoder().encode(drawn.svg),
        'image/svg+xml',
      );
      if (saved) showToast({ message: t('study.diagram.saved') });
    } catch {
      showToast({ message: t('study.diagram.saveFailed'), tone: 'danger' });
    }
  };

  return (
    <div className={styles.root}>
      {readOnly ? null : (
        <div className={styles.bar}>
          <label className={styles.field}>
            {t('study.diagram.start')}
            <select
              value=""
              onChange={(event) => {
                const key = event.target.value as (typeof STARTERS)[number];
                if (key) setText(STARTER_TEXT[key]);
              }}
            >
              <option value="">{t('study.diagram.choose')}</option>
              {STARTERS.map((one) => (
                <option key={one} value={one}>
                  {t(`study.diagram.kinds.${one}`)}
                </option>
              ))}
            </select>
          </label>
          <Button variant="quiet" disabled={!drawn?.ok} onClick={() => void save()}>
            {t('study.diagram.save')}
          </Button>
        </div>
      )}
      <label className={styles.field}>
        {t('study.diagram.text')}
        <textarea
          className={styles.source}
          value={text}
          readOnly={readOnly}
          spellCheck={false}
          rows={Math.min(14, Math.max(4, text.split('\n').length))}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      {drawn && !drawn.ok && drawn.message ? (
        <p className={styles.problem} role="alert">
          {t('study.diagram.problem', { message: drawn.message })}
        </p>
      ) : null}
      {drawn?.ok ? (
        <div
          className={styles.picture}
          role="img"
          aria-label={t('study.diagram.label', {
            kind: t(`study.diagram.kinds.${kind === 'other' ? 'flowchart' : kind}`),
          })}
          dangerouslySetInnerHTML={{ __html: drawn.svg }}
        />
      ) : null}
    </div>
  );
}
