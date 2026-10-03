// Export as a picture: the selected blocks or the whole page, as a PNG or an SVG. The preview is the picture itself.
import { useEffect, useState } from 'react';
import type { Platform } from '../../../platform/types';
import { t } from '../../../strings/t';
import { Dialog, RadioCard, RadioGroup, showToast } from '../../../ui';
import { makePicture, selectionFor, svgToPng } from '../host/picture';
import type { Picture, PictureScope } from '../host/picture';
import { exportFileName } from '../pdf';
import type { PageSource } from '../host/source';
import styles from './pagesUi.module.css';

export interface ImageDialogProps {
  readonly source: PageSource;
  readonly platform: Platform;
  /** The blocks selected on the page now. */
  readonly chosen: readonly string[];
  close(): void;
}

type Format = 'png' | 'svg';
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
function useBuilt(source: PageSource, scope: PictureScope, chosen: readonly string[]): Built {
  const [built, setBuilt] = useState<Built>({ status: 'loading' });
  useEffect(() => {
    let current = true;
    const selection = selectionFor(source, scope, chosen);
    const label = source.title || t('pageViews.print.untitled');
    const work: Promise<Built> = selection
      ? makePicture(source, selection, label).then((picture) => ({ status: 'ready' as const, picture }))
      : Promise.resolve({ status: 'empty' as const });
    void work.then((result) => current && setBuilt(result));
    return () => {
      current = false;
    };
  }, [source, scope, chosen]);
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
  readonly scope: PictureScope;
  readonly format: Format;
  readonly scale: Scale;
  onScope(value: PictureScope): void;
  onFormat(value: Format): void;
  onScale(value: Scale): void;
}

function Options(props: OptionsProps) {
  return (
    <div className={styles.form}>
      <RadioGroup<PictureScope> label={t('pageViews.image.title')} value={props.scope} onChange={props.onScope}>
        <RadioCard value="selection" label={t('pageViews.image.selection')} disabled={props.chosen === 0} />
        <RadioCard value="page" label={t('pageViews.image.wholePage')} />
      </RadioGroup>
      <RadioGroup<Format> label={t('pageViews.image.format')} value={props.format} onChange={props.onFormat}>
        <RadioCard value="png" label={t('pageViews.files.pngLabel')} />
        <RadioCard value="svg" label={t('pageViews.files.svgLabel')} />
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
    return <img className={styles.pictureFrame} src={url} alt={t('pageViews.image.preview')} />;
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
  const [scope, setScope] = useState<PictureScope>(chosen.length > 0 ? 'selection' : 'page');
  const [format, setFormat] = useState<Format>('png');
  const [scale, setScale] = useState<Scale>('2');
  const built = useBuilt(source, scope, chosen);
  const actions = useActions(props, built, format, scale);
  const ready = built.status === 'ready' && !actions.busy;
  const copy = { id: 'copy', label: t('pageViews.image.copy'), variant: 'secondary' as const };
  return (
    <Dialog
      title={t('pageViews.image.title')}
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
          chosen={chosen.length}
          scope={scope}
          format={format}
          scale={scale}
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
