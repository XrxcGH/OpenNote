// Confirm your symbols (flag ink.myHandwriting): what OpenNote found in the person's uploads, one card a symbol, for
// them to confirm, correct, or skip before anything is added to their style. Uploads open only once the calibration
// page is done, and only ever add to the style. The files are dropped once read, unless the person chose to keep
// them, encrypted, with the style.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import { announce, Button, Dialog, ProgressBar, TextField } from '../../../../ui';
import type { ConfirmedSymbol } from '../../myhand/metrics';
import { measureHabits, measureLines } from '../../myhand/segment';
import type { Labelled } from '../../myhand/segment';
import type { HandPoint, KeptUpload } from '../../myhand/style';
import type { Traced } from '../../myhand/trace';
import type { InkPath } from '../../myhand/write';
import { MAX_UPLOAD_BYTES, UploadFailure, base64Of, readSymbol, readUpload, startLabel } from './extract';
import type { UploadSymbol } from './extract';
import { InkDrawing } from './PenBox';
import { addSymbols, styleState } from './store';
import styles from './myhand.module.css';

const PAGE = 60;

interface Card {
  readonly symbol: UploadSymbol;
  /** Which upload it came from, so line numbers from two files never mix. */
  readonly file: number;
  label: string;
  skipped: boolean;
  read: boolean;
}

const toPath = (stroke: Traced): InkPath => stroke.map((p) => ({ x: p.x, y: p.y, pressure: 0.6, time: 0 }));

/** A traced stroke as pen points: pressure from the width, time from the length at an even pace. */
function handPoints(stroke: Traced, typicalWidth: number, perMs: number): HandPoint[] {
  let t = 0;
  return stroke.map((p, i) => {
    if (i > 0) t += Math.hypot(p.x - stroke[i - 1].x, p.y - stroke[i - 1].y) / perMs;
    return { x: p.x, y: p.y, p: Math.min(1, Math.max(0.15, (p.width / typicalWidth) * 0.55)), t };
  });
}

/** A symbol labeled with several characters is shared out between them by where its strokes sit. */
function splitByLabel(card: Card): { char: string; strokes: Traced[] }[] {
  const chars = [...card.label.trim()];
  if (chars.length <= 1) return chars.length === 1 ? [{ char: chars[0], strokes: card.symbol.strokes }] : [];
  const { x0, x1 } = card.symbol.rect;
  const parts = chars.map((char) => ({ char, strokes: [] as Traced[] }));
  for (const stroke of card.symbol.strokes) {
    const mid = stroke.reduce((sum, p) => sum + p.x, 0) / stroke.length;
    const k = Math.min(
      chars.length - 1,
      Math.max(0, Math.floor(((mid - x0) / Math.max(1e-6, x1 - x0)) * chars.length)),
    );
    parts[k].strokes.push(stroke);
  }
  return parts.every((part) => part.strokes.length > 0) ? parts : [];
}

function confirmed(cards: readonly Card[]) {
  const style = styleState.get().doc.style;
  if (!style) return null;
  const chosen = cards.filter((c) => !c.skipped && c.label.trim() !== '');
  const files = [...new Set(chosen.map((c) => c.file))];
  const symbols: ConfirmedSymbol[] = [];
  let habits = style.math;
  for (const file of files) {
    const mine = chosen.filter((c) => c.file === file);
    const lineCount = Math.max(0, ...mine.map((c) => c.symbol.line)) + 1;
    const labelled: Labelled[] = mine.flatMap((c) =>
      splitByLabel(c).map((part) => ({ label: part.char, rect: c.symbol.rect, line: c.symbol.line })),
    );
    const lines = measureLines(labelled, lineCount, style.metrics);
    habits = measureHabits(labelled, lines, habits);
    const widths = mine.flatMap((c) => c.symbol.strokes.flatMap((s) => s.map((p) => p.width))).sort((a, b) => a - b);
    const typical = widths[widths.length >> 1] || 1;
    for (const card of mine) {
      const line = lines[card.symbol.line];
      if (!line || !(line.xHeight > 0)) continue;
      const perMs = (style.metrics.speed * line.xHeight) / 1000;
      for (const part of splitByLabel(card)) {
        symbols.push({
          char: part.char,
          strokes: part.strokes.map((s) => handPoints(s, typical, Math.max(1e-3, perMs))),
          baseline: line.baseline,
          xHeight: line.xHeight,
        });
      }
    }
  }
  return { symbols, habits };
}

function SymbolCard(props: { card: Card; n: number; count: number; onChange: (next: Partial<Card>) => void }) {
  const { card } = props;
  const paths = useMemo(() => card.symbol.strokes.map(toPath), [card.symbol]);
  const width = Math.max(0.3, (card.symbol.rect.y1 - card.symbol.rect.y0) / 14);
  return (
    <li className={styles.symbol} data-skipped={card.skipped} data-myhand-symbol={card.symbol.id}>
      <InkDrawing
        paths={paths}
        width={width}
        label={t('myHand.uploads.symbolLabel', { n: props.n, count: props.count })}
      />
      <TextField
        label={t('myHand.uploads.symbolText')}
        value={card.label}
        help={card.read || card.label ? undefined : t('myHand.uploads.unsure')}
        onChange={(label) => props.onChange({ label: label.slice(0, 8) })}
      />
      <Button variant="quiet" aria-pressed={card.skipped} onClick={() => props.onChange({ skipped: !card.skipped })}>
        {t('myHand.uploads.skip')}
      </Button>
    </li>
  );
}

const sameCard = (a: Card, b: Card) => a.file === b.file && a.symbol.id === b.symbol.id;

function problemText(error: unknown, name: string): string {
  const code = error instanceof UploadFailure ? error.code : 'unreadable';
  if (code === 'tooBig') return t('myHand.uploads.tooBig', { name, size: MAX_UPLOAD_BYTES / 1024 / 1024 });
  return code === 'nothing' ? t('myHand.uploads.nothing', { name }) : t('myHand.uploads.unreadable', { name });
}

/** Reads the uploads into cards, one file after another, and keeps the files when the person asked to. */
function useUploadCards(files: readonly File[], keep: boolean) {
  const [status, setStatus] = useState<string>(t('myHand.uploads.reading', { name: files[0]?.name ?? '' }));
  const [errors, setErrors] = useState<string[]>([]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const kept = useRef<KeptUpload[]>([]);
  useEffect(() => {
    let stopped = false;
    void (async () => {
      const all: Card[] = [];
      const problems: string[] = [];
      for (const [file, upload] of files.entries()) {
        const name = upload.name;
        setStatus(t('myHand.uploads.reading', { name }));
        try {
          const read = await readUpload(upload, (page, pages) =>
            setStatus(t('myHand.uploads.readingPage', { page, pages, name })),
          );
          for (const symbol of read.symbols)
            all.push({ symbol, file, label: startLabel(symbol), skipped: false, read: false });
          if (keep)
            kept.current.push({
              name: name.slice(0, 200),
              type: upload.type,
              data: await base64Of(upload),
              at: Date.now(),
            });
        } catch (error) {
          problems.push(problemText(error, name));
        }
        if (stopped) return;
      }
      setErrors(problems);
      setCards(all);
      problems.forEach((problem) => announce(problem));
    })();
    return () => {
      stopped = true;
    };
  }, [files, keep]);
  return { status, errors, cards, setCards, kept };
}

/** The recognizer reads the cards on show, a page at a time, and asks once to be turned on. */
function useReading(
  cards: Card[] | null,
  shown: number,
  setCards: (update: (list: Card[] | null) => Card[] | null) => void,
) {
  const [recognizer, setRecognizer] = useState<'on' | 'off' | 'unknown'>('unknown');
  const off = recognizer === 'off';
  const ready = cards !== null;
  useEffect(() => {
    if (!ready || off || !cards) return;
    let stopped = false;
    void (async () => {
      let ask = true;
      for (const card of cards.slice(0, shown)) {
        if (stopped) return;
        if (card.read || card.label || card.symbol.role !== 'char') continue;
        const text = await readSymbol(card.symbol, ask);
        ask = false;
        if (stopped) return;
        if (text === 'off') {
          setRecognizer('off');
          announce(t('myHand.uploads.recognizerOff'));
          return;
        }
        setRecognizer('on');
        setCards(
          (list) => list && list.map((c) => (sameCard(c, card) ? { ...c, label: c.label || text, read: true } : c)),
        );
      }
    })();
    return () => {
      stopped = true;
    };
    // The list changes as cards are read; reading starts again only for a new page or a new list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shown, off]);
  return recognizer;
}

function UploadDialog(props: { files: readonly File[]; keep: boolean; done: () => void }) {
  const [shown, setShown] = useState(PAGE);
  const { status, errors, cards, setCards, kept } = useUploadCards(props.files, props.keep);
  const recognizer = useReading(cards, shown, setCards);
  const hasStyle = useStore(styleState, (s) => s.doc.style !== null);
  const chosen = cards?.filter((c) => !c.skipped && c.label.trim() !== '').length ?? 0;
  const add = async () => {
    if (!cards || chosen === 0) {
      announce(t('myHand.uploads.noneChosen'));
      return;
    }
    const result = confirmed(cards);
    if (!result) return;
    if (await addSymbols(result.symbols, result.habits, kept.current)) {
      announce(t('myHand.uploads.added', { count: result.symbols.length }));
      props.done();
    }
  };
  const visible = cards?.slice(0, shown) ?? [];
  return (
    <Dialog
      title={t('myHand.uploads.confirmTitle')}
      description={t('myHand.uploads.confirmIntro')}
      size="large"
      onDismiss={props.done}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: props.done },
        {
          id: 'add',
          label: t('myHand.uploads.add', { count: chosen }),
          variant: 'primary',
          disabled: !cards || chosen === 0 || !hasStyle,
          onPress: add,
        },
      ]}
    >
      <div className={styles.page} data-myhand-uploads="">
        {!cards && (
          <>
            <ProgressBar label={status} />
            <p role="status">{status}</p>
          </>
        )}
        {errors.map((error) => (
          <p key={error} className={styles.locked}>
            {error}
          </p>
        ))}
        {recognizer === 'off' && <p className={styles.locked}>{t('myHand.uploads.recognizerOff')}</p>}
        {cards && cards.length > 0 && (
          <>
            <p className={styles.missing}>
              {t('myHand.uploads.shown', { shown: visible.length, count: cards.length })}
            </p>
            <ul className={styles.symbols} aria-label={t('myHand.uploads.confirmTitle')}>
              {visible.map((card, i) => (
                <SymbolCard
                  key={`${card.file}:${card.symbol.id}`}
                  card={card}
                  n={i + 1}
                  count={cards.length}
                  onChange={(next) =>
                    setCards((list) => list && list.map((c) => (sameCard(c, card) ? { ...c, ...next } : c)))
                  }
                />
              ))}
            </ul>
            {shown < cards.length && (
              <div className={styles.actions}>
                <Button onClick={() => setShown((n) => n + PAGE)}>{t('myHand.uploads.more')}</Button>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Opens the confirm step for the chosen files. Uploads need a finished style: they only ever add to it. */
export function showUploads(files: readonly File[], keep: boolean): Promise<void> {
  if (!styleState.get().doc.style || files.length === 0) return Promise.resolve();
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const done = () => {
      resolve();
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    };
    root.render(<UploadDialog files={files} keep={keep} done={done} />);
  });
}
