// Confirm your symbols (flag ink.myHandwriting): what OpenNote found in the person's uploads, one card a symbol, for
// them to confirm, correct, or skip before anything is added to their style. Uploads open only once the calibration
// page is done, and only ever add to the style. The files are dropped once read, unless the person chose to keep
// them, encrypted, with the style.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { createRoot } from 'react-dom/client';
import { useStore } from '../../../../state/store';
import { t } from '../../../../strings/t';
import { announce, Button, Dialog, ProgressBar, TextField } from '../../../../ui';
import type { ConfirmedSymbol } from '../../myhand/metrics';
import { measureHabits, measureLines } from '../../myhand/segment';
import type { Labelled } from '../../myhand/segment';
import { LIMITS } from '../../myhand/style';
import type { HandPoint, KeptUpload } from '../../myhand/style';
import type { Traced } from '../../myhand/trace';
import type { InkPath } from '../../myhand/write';
import {
  MAX_DECODE_PIXELS,
  MAX_UPLOAD_BYTES,
  UploadFailure,
  base64Of,
  readSymbol,
  readUpload,
  startLabel,
} from './extract';
import type { UploadRead, UploadStart, UploadSymbol } from './extract';
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

/** The calm sentence for a file that gave nothing, or null when the person stopped the read themselves. */
function problemText(error: unknown, name: string): string | null {
  const code = error instanceof UploadFailure ? error.code : 'unreadable';
  switch (code) {
    case 'stopped':
      return null;
    case 'tooBig':
      return t('myHand.uploads.tooBig', { name, size: MAX_UPLOAD_BYTES / 1024 / 1024 });
    case 'tooManyPixels':
      return t('myHand.uploads.tooManyPixels', { name, megapixels: MAX_DECODE_PIXELS / 1_000_000 });
    case 'slow':
      return t('myHand.uploads.slow', { name });
    case 'nothing':
      return t('myHand.uploads.nothing', { name });
    default:
      return t('myHand.uploads.unreadable', { name });
  }
}

/** What one read took from a file, and where the rest starts when there is more. */
function summaryText(read: UploadRead, name: string): string {
  const count = read.symbols.length;
  const { first, last, total } = read.pages;
  const parts = [
    total === 1
      ? t('myHand.uploads.summaryOne', { name, lines: read.lines, count })
      : t('myHand.uploads.summary', { name, lines: read.lines, count, first, last, total }),
  ];
  if (read.dropped > 0) parts.push(t('myHand.uploads.dropped', { count: read.dropped }));
  if (read.next)
    parts.push(
      total === 1
        ? t('myHand.uploads.moreOne')
        : t('myHand.uploads.moreFrom', { page: read.next.page, line: read.next.line + 1 }),
    );
  return parts.join(' ');
}

/** One file to read, from its start or from where an earlier read stopped. */
interface Job {
  readonly upload: File;
  readonly start?: UploadStart;
}

/** Reads the uploads into cards, one file after another, and keeps the files when the person asked to. */
function useUploadCards(jobs: readonly Job[], keep: boolean) {
  const [status, setStatus] = useState<string>(t('myHand.uploads.reading', { name: jobs[0]?.upload.name ?? '' }));
  const [errors, setErrors] = useState<string[]>([]);
  const [notes, setNotes] = useState<string[]>([]);
  const [more, setMore] = useState<Job[]>([]);
  const [cards, setCards] = useState<Card[] | null>(null);
  const kept = useRef<KeptUpload[]>([]);
  useEffect(() => {
    const stop = new AbortController();
    void (async () => {
      const all: Card[] = [];
      const problems: string[] = [];
      const summary: string[] = [];
      const rest: Job[] = [];
      for (const [file, job] of jobs.entries()) {
        const name = job.upload.name;
        setStatus(t('myHand.uploads.reading', { name }));
        try {
          const read = await readUpload(
            job.upload,
            (page, pages) => setStatus(t('myHand.uploads.readingPage', { page, pages, name })),
            { start: job.start, signal: stop.signal },
          );
          for (const symbol of read.symbols)
            all.push({ symbol, file, label: startLabel(symbol), skipped: false, read: false });
          summary.push(summaryText(read, name));
          if (read.next) rest.push({ upload: job.upload, start: read.next });
          // A file is kept once, with its first read; one too large to keep is let go, and the person is told.
          if (keep && !job.start) {
            if (job.upload.size > LIMITS.keptBytes)
              summary.push(t('myHand.uploads.notKept', { name, size: LIMITS.keptBytes / 1024 / 1024 }));
            else
              kept.current.push({
                name: name.slice(0, 200),
                type: job.upload.type,
                data: await base64Of(job.upload),
                at: Date.now(),
              });
          }
        } catch (error) {
          const problem = problemText(error, name);
          if (problem) problems.push(problem);
        }
        if (stop.signal.aborted) return;
      }
      setErrors(problems);
      setNotes(summary);
      setMore(rest);
      setCards(all);
      [...problems, ...(rest.length > 0 ? summary : [])].forEach((text) => announce(text));
    })();
    return () => stop.abort();
  }, [jobs, keep]);
  /** The files to keep, once: they go with the first symbols added. */
  const takeKept = () => {
    const out = kept.current;
    kept.current = [];
    return out;
  };
  return { status, errors, notes, more, cards, setCards, takeKept };
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

/** The cards on show, a page at a time. */
function CardList(props: {
  cards: Card[];
  shown: number;
  setCards: Dispatch<SetStateAction<Card[] | null>>;
  more: () => void;
}) {
  const seen = props.cards.slice(0, props.shown);
  return (
    <>
      <p className={styles.missing}>{t('myHand.uploads.shown', { shown: seen.length, count: props.cards.length })}</p>
      <ul className={styles.symbols} aria-label={t('myHand.uploads.confirmTitle')}>
        {seen.map((card, i) => (
          <SymbolCard
            key={`${card.file}:${card.symbol.id}`}
            card={card}
            n={i + 1}
            count={props.cards.length}
            onChange={(next) =>
              props.setCards((list) => list && list.map((c) => (sameCard(c, card) ? { ...c, ...next } : c)))
            }
          />
        ))}
      </ul>
      {props.shown < props.cards.length && (
        <div className={styles.actions}>
          <Button onClick={props.more}>{t('myHand.uploads.more')}</Button>
        </div>
      )}
    </>
  );
}

function UploadDialog(props: { files: readonly File[]; keep: boolean; done: () => void }) {
  const [shown, setShown] = useState(PAGE);
  const [jobs, setJobs] = useState<readonly Job[]>(() => props.files.map((upload) => ({ upload })));
  const { status, errors, notes, more, cards, setCards, takeKept } = useUploadCards(jobs, props.keep);
  const recognizer = useReading(cards, shown, setCards);
  const hasStyle = useStore(styleState, (s) => s.doc.style !== null);
  // Only the symbols the person has been shown can be added: the rest wait for Show more.
  const seen = cards?.slice(0, shown) ?? [];
  const chosen = seen.filter((c) => !c.skipped && c.label.trim() !== '').length;
  /** Adds the chosen symbols on show; false when that couldn't be done. */
  const addSeen = async (): Promise<boolean> => {
    const result = confirmed(seen);
    if (!result) return false;
    const added = await addSymbols(result.symbols, result.habits, takeKept());
    if (!added) return false;
    announce(t('myHand.uploads.added', { count: result.symbols.length }));
    if (added.letGo > 0) announce(t('myHand.uploads.letGo', { count: added.letGo }));
    return true;
  };
  const add = async () => {
    if (!cards || chosen === 0) {
      announce(t('myHand.uploads.noneChosen'));
      return;
    }
    if (await addSeen()) props.done();
  };
  const readOn = async () => {
    if (chosen > 0 && !(await addSeen())) return;
    setShown(PAGE);
    setCards(null);
    setJobs(more);
  };
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
        {cards &&
          notes.map((note) => (
            <p key={note} className={styles.missing} data-myhand-upload-note="">
              {note}
            </p>
          ))}
        {cards && more.length > 0 && shown >= cards.length && (
          <div className={styles.actions}>
            <Button onClick={readOn} disabled={!hasStyle}>
              {chosen > 0 ? t('myHand.uploads.addAndReadOn', { count: chosen }) : t('myHand.uploads.readOn')}
            </Button>
          </div>
        )}
        {recognizer === 'off' && <p className={styles.locked}>{t('myHand.uploads.recognizerOff')}</p>}
        {cards && cards.length > 0 && (
          <CardList cards={cards} shown={shown} setCards={setCards} more={() => setShown((n) => n + PAGE)} />
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
