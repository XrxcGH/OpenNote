// Adding and editing one card (Study tools): the four kinds, each with the fields it needs. The hidden parts of an
// image card are drawn with the pointer or added with a button, and each one moves and resizes with the arrow keys.
import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { t } from '../../../strings/t';
import { Button, announce } from '../../../ui';
import { blanksOf } from '../deck/cloze';
import { newId } from '../deck/library';
import type { Card, CardKind, OcclusionBox } from '../deck/types';
import styles from './study.module.css';

const KINDS: readonly CardKind[] = ['basic', 'cloze', 'choice', 'occlusion'];
const MAX_SIDE = 1000;
const STEP = 2;

/** An image file as a data address, no wider, or taller than the limit. */
export async function readImage(file: File): Promise<string> {
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('image'));
    image.src = source;
  });
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  if (scale === 1 && source.length < 400_000) return source;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

function moved(box: OcclusionBox, event: KeyboardEvent): OcclusionBox | null {
  const dx = event.key === 'ArrowRight' ? STEP : event.key === 'ArrowLeft' ? -STEP : 0;
  const dy = event.key === 'ArrowDown' ? STEP : event.key === 'ArrowUp' ? -STEP : 0;
  if (!dx && !dy) return null;
  if (event.shiftKey) return { ...box, w: clamp(box.w + dx, 3, 100 - box.x), h: clamp(box.h + dy, 3, 100 - box.y) };
  return { ...box, x: clamp(box.x + dx, 0, 100 - box.w), y: clamp(box.y + dy, 0, 100 - box.h) };
}

interface BoxesProps {
  image: { src: string; alt: string; boxes: OcclusionBox[] };
  onBoxes(boxes: OcclusionBox[]): void;
}

function Boxes({ image, onBoxes }: BoxesProps) {
  const frame = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const { boxes } = image;
  const point = (event: PointerEvent) => {
    const rect = frame.current!.getBoundingClientRect();
    return {
      x: clamp(((event.clientX - rect.left) / rect.width) * 100, 0, 100),
      y: clamp(((event.clientY - rect.top) / rect.height) * 100, 0, 100),
    };
  };
  const finish = (event: PointerEvent) => {
    if (!drag) return;
    const end = point(event);
    setDrag(null);
    const box = {
      x: Math.min(drag.x, end.x),
      y: Math.min(drag.y, end.y),
      w: Math.abs(end.x - drag.x),
      h: Math.abs(end.y - drag.y),
    };
    if (box.w >= 3 && box.h >= 3) onBoxes([...boxes, box]);
  };
  return (
    <div
      ref={frame}
      className={styles.picture}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget || (event.target as HTMLElement).tagName === 'IMG') {
          setDrag(point(event));
          frame.current?.setPointerCapture(event.pointerId);
        }
      }}
      onPointerUp={finish}
    >
      <img src={image.src} alt={image.alt} draggable={false} />
      {boxes.map((box, index) => (
        <button
          key={index}
          type="button"
          className={styles.box}
          aria-label={t('study.edit.boxLabel', { number: index + 1 })}
          style={{
            insetInlineStart: `${box.x}%`,
            insetBlockStart: `${box.y}%`,
            inlineSize: `${box.w}%`,
            blockSize: `${box.h}%`,
          }}
          onKeyDown={(event) => {
            if (event.key === 'Delete' || event.key === 'Backspace') {
              event.preventDefault();
              onBoxes(boxes.filter((_one, at) => at !== index));
              return;
            }
            const next = moved(box, event);
            if (next) {
              event.preventDefault();
              onBoxes(boxes.map((one, at) => (at === index ? next : one)));
            }
          }}
        />
      ))}
    </div>
  );
}

interface Props {
  /** The card being changed, or null for a new one. */
  card: Card | null;
  onSave(card: Card): void;
  onCancel(): void;
}

export function CardEditor({ card, onSave, onCancel }: Props) {
  const [kind, setKind] = useState<CardKind>(card?.kind ?? 'basic');
  const [front, setFront] = useState(card?.front ?? '');
  const [back, setBack] = useState(card?.back ?? '');
  const [choices, setChoices] = useState((card?.choices ?? []).join('\n'));
  const [answer, setAnswer] = useState(card?.answer ?? 0);
  const [image, setImage] = useState(card?.image ?? { src: '', alt: '', boxes: [] as OcclusionBox[] });
  const [problem, setProblem] = useState('');
  const options = choices
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const check = (): string => {
    if (kind === 'cloze') return blanksOf(front).length === 0 ? t('study.edit.problemBlank') : '';
    if (!front.trim()) return t('study.edit.problemFront');
    if (kind === 'basic' && !back.trim()) return t('study.edit.problemBack');
    if (kind === 'choice' && options.length < 2) return t('study.edit.problemChoices');
    if (kind === 'occlusion' && (!image.src || image.boxes.length === 0)) return t('study.edit.problemImage');
    return '';
  };

  const save = () => {
    const found = check();
    setProblem(found);
    if (found) return announce(found);
    const base = {
      id: card?.id ?? newId('c'),
      kind,
      front: front.trim(),
      back: back.trim(),
      ...(card?.origin ? { origin: card.origin } : {}),
    };
    onSave(
      kind === 'choice'
        ? { ...base, choices: options, answer: Math.min(answer, options.length - 1) }
        : kind === 'occlusion'
          ? { ...base, image }
          : base,
    );
  };

  const pickImage = async (file: File | undefined) => {
    if (!file) return;
    try {
      setImage({ ...image, src: await readImage(file), boxes: [] });
      setProblem('');
    } catch {
      setProblem(t('study.edit.imageFailed'));
    }
  };

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        save();
      }}
    >
      <label className={styles.field}>
        {t('study.edit.kind')}
        <select value={kind} onChange={(event) => setKind(event.target.value as CardKind)}>
          {KINDS.map((one) => (
            <option key={one} value={one}>
              {t(`study.edit.kinds.${one}`)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.field}>
        {kind === 'cloze'
          ? t('study.edit.clozeText')
          : kind === 'occlusion'
            ? t('study.edit.prompt')
            : t('study.edit.front')}
        <textarea value={front} onChange={(event) => setFront(event.target.value)} />
      </label>
      {kind === 'cloze' ? <p className={styles.note}>{t('study.edit.clozeNote', { example: '{{word}}' })}</p> : null}
      {kind === 'choice' ? (
        <>
          <label className={styles.field}>
            {t('study.edit.choices')}
            <textarea value={choices} onChange={(event) => setChoices(event.target.value)} />
          </label>
          <label className={styles.field}>
            {t('study.edit.rightChoice')}
            <select value={answer} onChange={(event) => setAnswer(Number(event.target.value))}>
              {options.map((text, index) => (
                <option key={index} value={index}>
                  {t('study.edit.choiceNumber', { number: index + 1, text })}
                </option>
              ))}
            </select>
          </label>
        </>
      ) : null}
      {kind === 'occlusion' ? (
        <>
          <label className={styles.field}>
            {t('study.edit.image')}
            <input type="file" accept="image/*" onChange={(event) => void pickImage(event.target.files?.[0])} />
          </label>
          {image.src ? (
            <>
              <label className={styles.field}>
                {t('study.edit.imageAlt')}
                <input
                  type="text"
                  value={image.alt}
                  onChange={(event) => setImage({ ...image, alt: event.target.value })}
                />
              </label>
              <Boxes image={image} onBoxes={(boxes) => setImage({ ...image, boxes })} />
              <p className={styles.note}>
                {image.boxes.length === 0 ? t('study.edit.boxesNone') : t('study.edit.boxes')}
              </p>
              <div className={styles.buttons}>
                <Button onClick={() => setImage({ ...image, boxes: [...image.boxes, { x: 35, y: 40, w: 30, h: 20 }] })}>
                  {t('study.edit.addBox')}
                </Button>
                <Button
                  disabled={image.boxes.length === 0}
                  onClick={() => setImage({ ...image, boxes: image.boxes.slice(0, -1) })}
                >
                  {t('study.edit.removeBox')}
                </Button>
              </div>
            </>
          ) : null}
        </>
      ) : null}
      {kind !== 'cloze' ? (
        <label className={styles.field}>
          {kind === 'basic' ? t('study.edit.back') : t('study.edit.extra')}
          <textarea value={back} onChange={(event) => setBack(event.target.value)} />
        </label>
      ) : (
        <label className={styles.field}>
          {t('study.edit.extra')}
          <textarea value={back} onChange={(event) => setBack(event.target.value)} />
        </label>
      )}
      {problem ? (
        <p className={styles.problem} role="alert">
          {problem}
        </p>
      ) : null}
      <div className={styles.buttons}>
        <Button type="submit" variant="primary">
          {t('study.edit.save')}
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          {t('study.edit.cancel')}
        </Button>
      </div>
    </form>
  );
}
