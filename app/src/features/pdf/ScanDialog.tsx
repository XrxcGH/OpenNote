// The Clean up scan dialog (A3-20): a preview of the cleaned page and the choice of color, grayscale, or black and
// white. It cleans the selected picture, or the photos the person chose as a multi-page scan.
import { useEffect, useRef, useState } from 'react';
import type { BlockJson } from '../../services/pages/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Dialog, RadioCard, RadioGroup, showToast } from '../../ui';
import type { ScanMode } from './scan/clean';
import type { EditTarget } from './target';
import styles from './pdf.module.css';

export interface ScanDialogProps {
  target: EditTarget;
  /** The picture to clean, or null to clean `photos` into new pictures. */
  block: BlockJson | null;
  photos: readonly File[];
  /** Where new pictures start, in page units. */
  top: number;
}

async function previewSource(props: ScanDialogProps): Promise<Blob | null> {
  if (props.photos[0]) return props.photos[0];
  const asset = props.block?.data.original ?? props.block?.data.asset;
  if (typeof asset !== 'string') return null;
  const response = await fetch(props.target.page.assetUrl(asset)).catch(() => null);
  return response?.ok ? response.blob() : null;
}

export default function ScanDialog(props: ScanDialogProps & OverlayProps) {
  const { onClose, block, photos, target, top } = props;
  const [mode, setMode] = useState<ScanMode>('color');
  const [found, setFound] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const [source, { cleanBlob }] = await Promise.all([previewSource(props), import('./scan/apply')]);
      if (!source || !live) return;
      const result = await cleanBlob(source, mode).catch(() => null);
      const element = canvas.current;
      if (!result || !live || !element) return;
      element.width = result.width;
      element.height = result.height;
      const image = new ImageData(new Uint8ClampedArray(result.data), result.width, result.height);
      element.getContext('2d')?.putImageData(image, 0, 0);
      setFound(result.found);
    })();
    return () => {
      live = false;
    };
    // The preview follows the mode; the source stays the same while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const work = await import('./scan/apply');
      if (block) {
        await work.cleanPicture(target, block, mode);
        showToast({ message: t('pdf.scan.cleaned') });
      } else {
        const made = await work.addScans(target, photos, mode, top);
        showToast({ message: t('pdf.scan.added', { count: made }) });
      }
      onClose();
    } catch {
      showToast({ message: t('pdf.scan.failed'), tone: 'danger' });
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={t('pdf.scan.title')}
      description={block ? t('pdf.scan.descriptionOne') : t('pdf.scan.descriptionMany', { count: photos.length })}
      onDismiss={onClose}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: onClose, leastDestructive: true },
        { id: 'run', label: t('pdf.scan.run'), variant: 'primary', onPress: run },
      ]}
    >
      <canvas ref={canvas} className={styles.preview} role="img" aria-label={t('pdf.scan.preview')} />
      {found === false ? <p role="status">{t('pdf.scan.noEdges')}</p> : null}
      <RadioGroup<ScanMode> label={t('pdf.scan.mode')} value={mode} onChange={setMode}>
        <RadioCard<ScanMode> value="color" label={t('pdf.scan.modes.color')} />
        <RadioCard<ScanMode> value="grayscale" label={t('pdf.scan.modes.grayscale')} />
        <RadioCard<ScanMode> value="blackAndWhite" label={t('pdf.scan.modes.blackAndWhite')} />
      </RadioGroup>
    </Dialog>
  );
}
