// The figure exporter (flag doc.figureExport): choose a graph or diagram on the shown page, give it a figure number
// and a caption, then save it as an SVG or a PNG at 72 to 600 DPI with the caption block written under the picture.
import { useEffect, useMemo, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, RadioCard, RadioGroup, TextField, announce, showToast } from '../../../ui';
import { saveBytes } from '../../study';
import { DPI_CHOICES, figureFileName, figureSources, pngSize, svgSize } from '../figure';
import type { FigureSource } from '../figure';
import { makeFigure, toPngAt } from '../figureExport';
import { shownMarkdown } from '../pageText';
import docs from './docTools.module.css';

type Format = 'svg' | 'png';

const NUMBER_KEY = 'opennote.doc.figureNumber';

function nextNumber(): number {
  try {
    return Math.max(1, Number(window.localStorage.getItem(NUMBER_KEY)) || 1);
  } catch {
    return 1;
  }
}

function rememberNumber(n: number): void {
  try {
    window.localStorage.setItem(NUMBER_KEY, String(n + 1));
  } catch {
    // The next figure starts at the same number.
  }
}

/** The graphs and diagrams of the shown page, read when the window opens. */
function usePageFigures(): readonly FigureSource[] {
  const [markdown, setMarkdown] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void shownMarkdown().then((text) => live && setMarkdown(text));
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => figureSources(markdown ?? ''), [markdown]);
}

interface Fields {
  number: number;
  caption: string;
  credit: string;
}

/** The captioned picture for a source and fields. Null while it is drawn, and `failed` when it draws nothing. */
function useFigure(source: FigureSource | undefined, key: string, fields: Fields) {
  const [drawn, setDrawn] = useState<{ key: string; svg: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    if (!source) return;
    const options = {
      number: fields.number,
      caption: fields.caption,
      ...(fields.credit.trim() ? { source: fields.credit } : {}),
    };
    void makeFigure(source, options).then((made) => live && setDrawn({ key, svg: made }));
    return () => {
      live = false;
    };
  }, [source, key, fields.number, fields.caption, fields.credit]);
  return { svg: drawn?.key === key ? drawn.svg : null, failed: drawn?.key === key && drawn.svg === null };
}

function SourceChoices(props: { sources: readonly FigureSource[]; value: string; onChange(value: string): void }) {
  return (
    <RadioGroup<string> label={t('docStructure.figure.source')} value={props.value} onChange={props.onChange}>
      {props.sources.map((one, i) => (
        <RadioCard<string>
          key={i}
          value={String(i)}
          label={t('docStructure.figure.sourceChoice', {
            kind: t(one.kind === 'graph' ? 'docStructure.figure.kindGraph' : 'docStructure.figure.kindDiagram'),
            number: i + 1,
            preview: one.preview,
          })}
        />
      ))}
    </RadioGroup>
  );
}

function DpiChoice(props: { dpi: string; onChange(value: string): void; size: ReturnType<typeof svgSize> }) {
  const pixels = props.size ? pngSize(props.size, Number(props.dpi)) : null;
  return (
    <>
      <label className={docs.field}>
        {t('docStructure.figure.dpi')}
        <select value={props.dpi} onChange={(event) => props.onChange(event.target.value)}>
          {DPI_CHOICES.map((n) => (
            <option key={n} value={String(n)}>
              {t('docStructure.figure.dpiChoice', { dpi: n })}
            </option>
          ))}
        </select>
      </label>
      {props.size ? (
        <p className={docs.note}>
          {pixels
            ? t('docStructure.figure.pixels', { width: pixels.width, height: pixels.height })
            : t('docStructure.figure.tooLarge')}
        </p>
      ) : null}
    </>
  );
}

/** Saves the picture as the format asks, and says what happened. Returns the message. */
async function saveFigure(svg: string, name: string, format: Format, dpi: number): Promise<string | null> {
  try {
    const bytes = format === 'png' ? await toPngAt(svg, dpi) : new TextEncoder().encode(svg);
    const type = format === 'png' ? 'image/png' : 'image/svg+xml';
    return (await saveBytes(name, t('docStructure.figure.saveLabel'), bytes, type))
      ? t('docStructure.figure.saved', { name })
      : null;
  } catch {
    showToast({ message: t('docStructure.figure.failed'), tone: 'danger' });
    return t('docStructure.figure.failed');
  }
}

export function FigureTool() {
  const sources = usePageFigures();
  const [choice, setChoice] = useState('0');
  const [number, setNumber] = useState(String(nextNumber()));
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [format, setFormat] = useState<Format>('svg');
  const [dpi, setDpi] = useState('300');
  const [message, setMessage] = useState('');
  const source = sources[Number(choice)];
  const figureNumber = Math.max(1, Math.floor(Number(number) || 1));
  const { svg, failed } = useFigure(source, JSON.stringify([choice, figureNumber, caption, credit]), {
    number: figureNumber,
    caption,
    credit,
  });

  if (sources.length === 0) {
    return (
      <p className={docs.note} role="status">
        {t('docStructure.figure.none')}
      </p>
    );
  }

  const size = svg ? svgSize(svg) : null;
  const tooLarge = format === 'png' && (!size || !pngSize(size, Number(dpi)));
  const save = async () => {
    if (!svg) return;
    const note = caption.trim() === '' ? t('docStructure.figure.needCaption') : null;
    const said =
      note ?? (await saveFigure(svg, figureFileName({ number: figureNumber, caption }, format), format, Number(dpi)));
    if (said === null) return;
    if (note === null) rememberNumber(figureNumber);
    setMessage(said);
    announce(said);
  };

  return (
    <div className={docs.tool}>
      <SourceChoices sources={sources} value={choice} onChange={setChoice} />
      <TextField label={t('docStructure.figure.number')} value={number} onChange={setNumber} />
      <TextField
        label={t('docStructure.figure.caption')}
        help={t('docStructure.figure.captionHelp')}
        value={caption}
        onChange={setCaption}
      />
      <TextField label={t('docStructure.figure.credit')} value={credit} onChange={setCredit} />
      <RadioGroup<Format> label={t('docStructure.figure.format')} value={format} onChange={setFormat}>
        <RadioCard<Format> value="svg" label={t('docStructure.figure.svg')} />
        <RadioCard<Format> value="png" label={t('docStructure.figure.png')} />
      </RadioGroup>
      {format === 'png' ? <DpiChoice dpi={dpi} onChange={setDpi} size={size} /> : null}
      {svg ? (
        <figure className={docs.preview}>
          <img
            alt={t('docStructure.figure.preview')}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          />
        </figure>
      ) : null}
      <div className={docs.buttons}>
        <Button variant="primary" onClick={() => void save()} disabled={!svg || tooLarge}>
          {t('docStructure.figure.save')}
        </Button>
      </div>
      <p className={docs.status} role="status">
        {failed ? t('docStructure.figure.drawFailed') : message}
      </p>
    </div>
  );
}
