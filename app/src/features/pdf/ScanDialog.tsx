// The Clean up scan dialog (A3-20): a preview of the cleaned page and the choice of color, grayscale, or black and
// white. It cleans the selected picture, or the photos the person chose as a multi-page scan.
import { useEffect, useRef, useState } from 'react';
import type { BlockJson } from '../../services/pages/types';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { t } from '../../strings/t';
import { Button, Dialog, RadioCard, RadioGroup, showToast } from '../../ui';
import type { Frame } from './scan/apply';
import type { ScanMode } from './scan/clean';
import { CornerEditor } from './scan/CornerEditor';
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

// checks-disable-next-line modifiability: one component whose parts share its state; split it when it grows again
export default function ScanDialog(props: ScanDialogProps & OverlayProps) {
  const { onClose, block, photos, target, top } = props;
  const [mode, setMode] = useState<ScanMode>('color');
  const [found, setFound] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState<Blob | null>(null);
  // The corners on screen, and the corners the preview and cleanup use (set when a corner is let go).
  const [frame, setFrame] = useState<Frame | null>(null);
  const [placed, setPlaced] = useState<Frame | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  // Corners can be placed by hand when there is one photo to look at.
  const single = block !== null || photos.length === 1;

  useEffect(() => {
    let live = true;
    void (async () => {
      const [blob, { detectFrame }] = await Promise.all([previewSource(props), import('./scan/apply')]);
      if (!blob || !live) return;
      setSource(blob);
      const detected = await detectFrame(blob).catch(() => null);
      if (!detected || !live) return;
      setFrame(detected.frame);
      setPlaced(detected.frame);
      setFound(detected.found);
    })();
    return () => {
      live = false;
    };
    // The source stays the same while the dialog is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!source || !placed) return;
    let live = true;
    void (async () => {
      const { cleanBlob } = await import('./scan/apply');
      const result = await cleanBlob(source, mode, placed).catch(() => null);
      const element = canvas.current;
      if (!result || !live || !element) return;
      element.width = result.width;
      element.height = result.height;
      const image = new ImageData(new Uint8ClampedArray(result.data), result.width, result.height);
      element.getContext('2d')?.putImageData(image, 0, 0);
    })();
    return () => {
      live = false;
    };
  }, [source, mode, placed]);

  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const work = await import('./scan/apply');
      if (block) {
        await work.cleanPicture(target, block, mode, single && adjusting ? (placed ?? undefined) : undefined);
        showToast({ message: t('pdf.scan.cleaned') });
      } else {
        const frameUsed = single && adjusting ? (placed ?? undefined) : undefined;
        const made = await work.addScans(target, photos, mode, top, undefined, frameUsed);
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
      {found === false && !adjusting ? <p role="status">{t('pdf.scan.noEdges')}</p> : null}
      {single && source && frame ? (
        adjusting ? (
          <CornerEditor
            photo={source}
            frame={frame}
            onMove={setFrame}
            onCommit={(next) => {
              setFrame(next);
              setPlaced(next);
            }}
          />
        ) : (
          <Button variant="secondary" onClick={() => setAdjusting(true)}>
            {t('pdf.scan.corners.adjust')}
          </Button>
        )
      ) : null}
      <canvas ref={canvas} className={styles.preview} role="img" aria-label={t('pdf.scan.preview')} />
      <RadioGroup<ScanMode> label={t('pdf.scan.mode')} value={mode} onChange={setMode}>
        <RadioCard<ScanMode> value="color" label={t('pdf.scan.modes.color')} />
        <RadioCard<ScanMode> value="grayscale" label={t('pdf.scan.modes.grayscale')} />
        <RadioCard<ScanMode> value="blackAndWhite" label={t('pdf.scan.modes.blackAndWhite')} />
      </RadioGroup>
    </Dialog>
  );
}
