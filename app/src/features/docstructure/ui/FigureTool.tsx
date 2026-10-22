// The figure exporter (flag doc.figureExport): choose a graph or diagram on the shown page, give it a number and a
// caption, and save it as an SVG, or as a PNG at 72 to 600 DPI, with the caption block written under the picture.
import { useEffect, useMemo, useState } from 'react';
import { t } from '../../../strings/t';
import { Button, RadioCard, RadioGroup, TextField, announce, showToast } from '../../../ui';
import { DPI_CHOICES, figureFileName, figureSources, pngSize, svgSize } from '../figure';
import { makeFigure, toPngAt } from '../figureExport';
import { shownMarkdown } from '../pageText';
import { saveBytes } from '../../study';
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

export function FigureTool() {
  const sources = useMemo(() => figureSources(shownMarkdown()), []);
  const [choice, setChoice] = useState('0');
  const [number, setNumber] = useState(String(nextNumber()));
  const [caption, setCaption] = useState('');
  const [credit, setCredit] = useState('');
  const [format, setFormat] = useState<Format>('svg');
  const [dpi, setDpi] = useState('300');
  const [drawn, setDrawn] = useState<{ key: string; svg: string | null } | null>(null);
  const [message, setMessage] = useState('');

  const source = sources[Number(choice)];
  const figureNumber = Math.max(1, Math.floor(Number(number) || 1));

  const key = JSON.stringify([choice, figureNumber, caption, credit]);
  const svg = drawn?.key === key ? drawn.svg : null;
  const failed = drawn?.key === key && drawn.svg === null;

  useEffect(() => {
    let live = true;
    if (!source) return;
    void makeFigure(source, { number: figureNumber, caption, ...(credit.trim() ? { source: credit } : {}) }).then(
      (made) => live && setDrawn({ key, svg: made }),
    );
    return () => {
      live = false;
    };
  }, [source, figureNumber, caption, credit, key]);

  if (sources.length === 0) {
    return (
      <p className={docs.note} role="status">
        {t('docStructure.figure.none')}
      </p>
    );
  }

  const size = svg ? svgSize(svg) : null;
  const pixels = size ? pngSize(size, Number(dpi)) : null;

  const save = async () => {
    if (!svg || !source) return;
    if (caption.trim() === '') {
      setMessage(t('docStructure.figure.needCaption'));
      announce(t('docStructure.figure.needCaption'));
      return;
    }
    const options = { number: figureNumber, caption };
    const name = figureFileName(options, format);
    try {
      const bytes = format === 'png' ? await toPngAt(svg, Number(dpi)) : new TextEncoder().encode(svg);
      const saved = await saveBytes(
        name,
        t('docStructure.figure.saveLabel'),
        bytes,
        format === 'png' ? 'image/png' : 'image/svg+xml',
      );
      if (saved) {
        rememberNumber(figureNumber);
        const text = t('docStructure.figure.saved', { name });
        setMessage(text);
        showToast({ message: text });
        announce(text);
      }
    } catch {
      setMessage(t('docStructure.figure.failed'));
      showToast({ message: t('docStructure.figure.failed'), tone: 'danger' });
    }
  };

  return (
    <div className={docs.tool}>
      <RadioGroup<string> label={t('docStructure.figure.source')} value={choice} onChange={setChoice}>
        {sources.map((one, i) => (
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
      <TextField label={t('docStructure.figure.number')} value={number} onChange={setNumber} />
      <TextField label={t('docStructure.figure.caption')} help={t('docStructure.figure.captionHelp')} value={caption} onChange={setCaption} />
      <TextField label={t('docStructure.figure.credit')} value={credit} onChange={setCredit} />
      <RadioGroup<Format> label={t('docStructure.figure.format')} value={format} onChange={setFormat}>
        <RadioCard<Format> value="svg" label={t('docStructure.figure.svg')} />
        <RadioCard<Format> value="png" label={t('docStructure.figure.png')} />
      </RadioGroup>
      {format === 'png' ? (
        <label className={docs.field}>
          {t('docStructure.figure.dpi')}
          <select value={dpi} onChange={(event) => setDpi(event.target.value)}>
            {DPI_CHOICES.map((n) => (
              <option key={n} value={String(n)}>
                {t('docStructure.figure.dpiChoice', { dpi: n })}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {format === 'png' && size ? (
        <p className={docs.note}>
          {pixels
            ? t('docStructure.figure.pixels', { width: pixels.width, height: pixels.height })
            : t('docStructure.figure.tooLarge')}
        </p>
      ) : null}
      {svg ? (
        <figure className={docs.preview}>
          <img
            alt={t('docStructure.figure.preview')}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`}
          />
        </figure>
      ) : null}
      <div className={docs.buttons}>
        <Button variant="primary" onClick={() => void save()} disabled={!svg || (format === 'png' && !pixels)}>
          {t('docStructure.figure.save')}
        </Button>
      </div>
      <p className={docs.status} role="status">
        {failed ? t('docStructure.figure.drawFailed') : message}
      </p>
    </div>
  );
}
