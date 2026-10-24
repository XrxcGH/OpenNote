// Choosing a part of a screen snap (Phase 9): drag over the picture, or keep all of it. The part is cut out here, so
// nothing but what was chosen goes onto the page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import styles from './more.module.css';

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const MIN = 8;

/** The pixels of the picture `box` covers, as a PNG, or the whole picture when there is no box. */
export async function cropPng(
  png: ArrayBuffer,
  box: Box | null,
  shown: { w: number; h: number },
): Promise<ArrayBuffer> {
  if (!box) return png;
  const bitmap = await createImageBitmap(new Blob([png], { type: 'image/png' }));
  const scale = bitmap.width / shown.w;
  const [x, y, w, h] = [box.x, box.y, box.w, box.h].map((value) => Math.round(value * scale));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, w);
  canvas.height = Math.max(1, h);
  canvas.getContext('2d')?.drawImage(bitmap, x, y, w, h, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  return blob ? blob.arrayBuffer() : png;
}

export function RegionDialog(props: { png: ArrayBuffer; onDone(result: ArrayBuffer | null): void }) {
  const { png, onDone } = props;
  const [box, setBox] = useState<Box | null>(null);
  const image = useRef<HTMLImageElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const url = useMemo(() => URL.createObjectURL(new Blob([png], { type: 'image/png' })), [png]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  const point = (event: React.PointerEvent): { x: number; y: number } => {
    const rect = image.current?.getBoundingClientRect();
    return {
      x: Math.min(Math.max(event.clientX - (rect?.left ?? 0), 0), rect?.width ?? 0),
      y: Math.min(Math.max(event.clientY - (rect?.top ?? 0), 0), rect?.height ?? 0),
    };
  };
  const finish = async (keepPart: boolean) => {
    const rect = image.current?.getBoundingClientRect();
    const chosen = keepPart && box && box.w >= MIN && box.h >= MIN ? box : null;
    onDone(await cropPng(png, chosen, { w: rect?.width ?? 1, h: rect?.height ?? 1 }));
  };
  const usable = box !== null && box.w >= MIN && box.h >= MIN;
  return (
    <Dialog
      title={t('audioMore.snap.regionTitle')}
      description={t('audioMore.snap.regionHelp')}
      size="large"
      onDismiss={() => onDone(null)}
      actions={[
        { id: 'cancel', label: t('audioMore.snap.cancel'), variant: 'secondary', onPress: () => onDone(null) },
        { id: 'all', label: t('audioMore.snap.regionAll'), variant: 'secondary', onPress: () => finish(false) },
        {
          id: 'part',
          label: t('audioMore.snap.regionUse'),
          variant: 'primary',
          onPress: () => (usable ? finish(true) : finish(false)),
        },
      ]}
    >
      {/* checks-disable-next-line usability: dragging is one way to choose; Keep the whole picture is the keyboard way */}
      <div
        className={styles.region}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = point(event);
          setBox(null);
        }}
        onPointerMove={(event) => {
          const from = start.current;
          if (!from) return;
          const to = point(event);
          setBox({
            x: Math.min(from.x, to.x),
            y: Math.min(from.y, to.y),
            w: Math.abs(to.x - from.x),
            h: Math.abs(to.y - from.y),
          });
        }}
        onPointerUp={() => (start.current = null)}
      >
        <img
          ref={image}
          className={styles.regionImage}
          src={url}
          alt={t('audioMore.snap.regionImage')}
          draggable={false}
        />
        {box && <div className={styles.regionBox} style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
      </div>
    </Dialog>
  );
}
