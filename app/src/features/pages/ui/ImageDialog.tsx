// Export as a picture: the selected blocks or the whole page, as a PNG or an SVG. The preview is the picture itself.
import { useEffect, useState } from 'react';
import type { Platform } from '../../../platform/types';
import { t } from '../../../strings/t';
import { Dialog, RadioCard, RadioGroup, showToast } from '../../../ui';
import { isEnabled } from '../../../app/flags';
import { exportPdfFile } from '../host/exporter';
import { saveFile } from '../host/files';
import {
  blockBoxes,
  makePicture,
  rememberSelectMode,
  rememberedSelectMode,
  selectionFor,
  svgToPng,
} from '../host/picture';
import type { Picture, PictureScope } from '../host/picture';
import { exportFileName } from '../pdf';
import { cropPage, selectionText } from '../selection';
import type { Chosen, SelectMode } from '../selection';
import type { PageSource } from '../host/source';
import styles from './pagesUi.module.css';

export interface ImageDialogProps {
  readonly source: PageSource;
  readonly platform: Platform;
  /** The blocks and strokes the lasso picked on the page now. */
  readonly chosen: Chosen;
  /** The formats the dialog offers. The first is chosen at the start. */
  readonly formats?: readonly Format[];
  close(): void;
}

export type Format = 'png' | 'svg' | 'pdf' | 'docx';

/** The formats of Export as picture. */
export const IMAGE_FORMATS: readonly Format[] = ['png', 'svg'];
type Scale = '1' | '2' | '3';
type Built =
  | { readonly status: 'loading' }
  | { readonly status: 'empty' }
  | { readonly status: 'ready'; readonly picture: Picture };

const SCALE_KEYS = {
  '1': 'pageViews.image.scales.one',
  '2': 'pageViews.image.scales.two',
  '3': 'pageViews.image.scales.three',
} as const;

/** The picture for a scope, made again when the scope changes. */
function useBuilt(source: PageSource, scope: PictureScope, chosen: Chosen, mode: SelectMode): Built {
  const [built, setBuilt] = useState<Built>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    const selection = selectionFor(source, scope, chosen, mode);
    const label = source.title || t('pageViews.print.untitled');
    const work: Promise<Built> = selection
      ? makePicture(source, selection, label).then((picture) => ({ status: 'ready' as const, picture }))
      : Promise.resolve({ status: 'empty' as const });
    void work.then((result) => current && setBuilt(result));
    return () => {
      current = false;
    };
  }, [source, scope, chosen, mode]);
  return built;
}

interface Actions {
  readonly busy: boolean;
  save(): Promise<void>;
  copy(): Promise<void>;
}

/** Saving to a file and copying to the clipboard, with the failures told in a toast. */
function useActions(props: ImageDialogProps, built: Built, format: Format, scale: Scale): Actions {
  const { source, platform, close } = props;
  const [busy, setBusy] = useState(false);
  const fail = (error: unknown) => {
    platform.log('error', `Picture export failed: ${String(error)}`);
    const message = t(error instanceof RangeError ? 'pageViews.image.tooLarge' : 'pageViews.image.failed');
    showToast({ message, tone: 'danger' });
  };
  const bytes = async (picture: Picture): Promise<Uint8Array> =>
    format === 'png'
      ? new Uint8Array(await (await svgToPng(picture, Number(scale))).arrayBuffer())
      : new TextEncoder().encode(picture.svg);
  const title = source.title || t('pageViews.print.untitled');
  const savedToast = (name: string, path: string) =>
    showToast({
      message: t('pageViews.files.saved', { name }),
      action: { label: t('pageViews.print.openFile'), run: () => platform.exports.open(path, true) },
    });
  /** The selection as its own one-sheet PDF, tagged when accessible PDF is on. */
  const savePdf = async (picture: Picture) => {
    const page = cropPage(source.page, picture.selection, { boxes: blockBoxes(), title });
    const outcome = await exportPdfFile(
      platform.exports,
      { ...source, page, title },
      { print: { background: false }, accessible: isEnabled('pages.accessiblePdf') },
    );
    if (outcome.status === 'canceled') return;
    close();
    savedToast(outcome.name, outcome.path);
  };
  /** The selection's picture in a Word file, with the selection's words as the picture's description. */
  const saveDocx = async (picture: Picture) => {
    const png = new Uint8Array(await (await svgToPng(picture, 2)).arrayBuffer());
    const alt = selectionText(source.page, picture.selection) || title;
    const docx = await platform.exports.selectionDocx(png, {
      title,
      alt,
      width: Math.max(1, Math.round(picture.width)),
      height: Math.max(1, Math.round(picture.height)),
    });
    const path = await saveFile(platform, {
      suggested: exportFileName(title, 'docx'),
      label: t('pagesPlus.export.docxLabel'),
      extension: 'docx',
      bytes: docx,
    });
    if (path !== null) close();
  };
  const guarded = async (work: (picture: Picture) => Promise<void>) => {
    if (built.status !== 'ready' || busy) return;
    setBusy(true);
    try {
      await work(built.picture);
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };
  const save = () =>
    guarded(async (picture) => {
      if (format === 'pdf') return savePdf(picture);
      if (format === 'docx') return saveDocx(picture);
      const name = exportFileName(source.title || t('pageViews.print.untitled'), format);
      const label = t(format === 'png' ? 'pageViews.files.pngLabel' : 'pageViews.files.svgLabel');
      const path = await platform.exports.pickSave({ suggested: name, label, extension: format });
      if (path === null) return;
      await platform.exports.write(path, [{ path: '', bytes: await bytes(picture) }]);
      close();
      showToast({
        message: t('pageViews.files.saved', { name: path.split(/[\\/]/).pop() ?? name }),
        action: { label: t('pageViews.print.openFile'), run: () => platform.exports.open(path, true) },
      });
    });
  const copy = () =>
    guarded(async (picture) => {
      const blob = await svgToPng(picture, Number(scale));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      close();
      showToast({ message: t('pageViews.image.copied') });
    });
  return { busy, save, copy };
}

interface OptionsProps {
  readonly chosen: number;
  readonly formats: readonly Format[];
  readonly scope: PictureScope;
  readonly format: Format;
  readonly scale: Scale;
  /** Smart or exact, offered when a lasso drew the selection. */
  readonly mode: SelectMode;
  readonly lassoed: boolean;
  onMode(value: SelectMode): void;
  onScope(value: PictureScope): void;
  onFormat(value: Format): void;
  onScale(value: Scale): void;
}

const FORMAT_LABELS = {
  png: 'pageViews.files.pngLabel',
  svg: 'pageViews.files.svgLabel',
  pdf: 'pageViews.files.pdfLabel',
  docx: 'pagesPlus.export.docxLabel',
} as const;

function Options(props: OptionsProps) {
  return (
    <div className={styles.form}>
      <RadioGroup<PictureScope> label={t('pageViews.image.title')} value={props.scope} onChange={props.onScope}>
        <RadioCard value="selection" label={t('pageViews.image.selection')} disabled={props.chosen === 0} />
        <RadioCard value="page" label={t('pageViews.image.wholePage')} />
      </RadioGroup>
      {props.scope === 'selection' && props.lassoed ? (
        <RadioGroup<SelectMode> label={t('ink.exportArea.label')} value={props.mode} onChange={props.onMode}>
          <RadioCard value="smart" label={t('ink.exportArea.smart')} description={t('ink.exportArea.smartHelp')} />
          <RadioCard value="exact" label={t('ink.exportArea.exact')} description={t('ink.exportArea.exactHelp')} />
        </RadioGroup>
      ) : null}
      <RadioGroup<Format> label={t('pageViews.image.format')} value={props.format} onChange={props.onFormat}>
        {props.formats.map((format) => (
          <RadioCard key={format} value={format} label={t(FORMAT_LABELS[format])} />
        ))}
      </RadioGroup>
      {props.format === 'png' ? (
        <RadioGroup<Scale> label={t('pageViews.image.scale')} value={props.scale} onChange={props.onScale}>
          {(['1', '2', '3'] as const).map((value) => (
            <RadioCard key={value} value={value} label={t(SCALE_KEYS[value])} />
          ))}
        </RadioGroup>
      ) : null}
    </div>
  );
}

function Preview({ built }: { built: Built }) {
  if (built.status === 'ready') {
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(built.picture.svg)}`;
    // The dashed edge is the crop: exactly what the file or the clipboard gets.
    return (
      <img
        className={`${styles.pictureFrame} ${styles.cropEdge}`}
        src={url}
        alt={t('pageViews.image.preview')}
        data-crop-mode={built.picture.selection.mode}
      />
    );
  }
  const empty = built.status === 'empty';
  return (
    <p className={empty ? styles.error : styles.hint}>
      {t(empty ? 'pageViews.image.nothingSelected' : 'pageViews.print.previewing')}
    </p>
  );
}

export function ImageDialog(props: ImageDialogProps) {
  const { source, chosen, close } = props;
  const formats = props.formats ?? IMAGE_FORMATS;
  const picked = chosen.blocks.length + chosen.strokes.length;
  const [scope, setScope] = useState<PictureScope>(picked > 0 ? 'selection' : 'page');
  const [format, setFormat] = useState<Format>(formats[0]);
  const [scale, setScale] = useState<Scale>('2');
  const [mode, setMode] = useState<SelectMode>(rememberedSelectMode);
  const chooseMode = (next: SelectMode) => {
    setMode(next);
    rememberSelectMode(next);
  };
  const built = useBuilt(source, scope, chosen, mode);
  const actions = useActions(props, built, format, scale);
  const ready = built.status === 'ready' && !actions.busy;
  const copy = { id: 'copy', label: t('pageViews.image.copy'), variant: 'secondary' as const };
  return (
    <Dialog
      title={t(formats.length > IMAGE_FORMATS.length ? 'pagesPlus.export.title' : 'pageViews.image.title')}
      description={t('pageViews.image.description')}
      size="large"
      onDismiss={close}
      actions={[
        { id: 'cancel', label: t('pageViews.print.cancel'), variant: 'secondary', onPress: close },
        ...(format === 'png' ? [{ ...copy, onPress: () => (ready ? actions.copy() : undefined) }] : []),
        {
          id: 'save',
          label: t('pageViews.image.save'),
          variant: 'primary',
          onPress: () => (ready ? actions.save() : undefined),
        },
      ]}
    >
      <div className={styles.split}>
        <Options
          chosen={picked}
          formats={formats}
          scope={scope}
          format={format}
          scale={scale}
          mode={mode}
          lassoed={(chosen.lasso?.length ?? 0) >= 3}
          onMode={chooseMode}
          onScope={setScope}
          onFormat={setFormat}
          onScale={setScale}
        />
        <div className={styles.preview} aria-live="polite">
          <Preview built={built} />
        </div>
      </div>
    </Dialog>
  );
}
