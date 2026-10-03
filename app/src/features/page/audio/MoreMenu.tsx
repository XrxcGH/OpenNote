// The "More" menu of a recording on the page (Phase 9): trimming and removing parts.
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { useRef } from 'react';
import { useFlag } from '../../../app/flags';
import type { RecordingEntry } from '../../../core/audio';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { IconButton, openMenu } from '../../../ui';
import { markPartStart, partStart, removePart, trimSilence } from './edits';
import { clockNs } from './format';

export function MoreMenu(props: { block: BlockJson; entry: RecordingEntry; pageId: string; position: number }) {
  const { block, entry, pageId, position } = props;
  const trim = useFlag('audio.trim');
  const anchor = useRef<HTMLSpanElement>(null);
  if (!trim) return null;
  const start = partStart(entry.id);
  const open = () => {
    const button = anchor.current?.querySelector('button');
    if (!button) return;
    void openMenu({
      label: t('audio.block.more'),
      anchor: button,
      returnFocus: button,
      items: [
        { id: 'trim', label: t('audio.block.trimSilence'), onSelect: () => void trimSilence(block.id, pageId, entry) },
        {
          id: 'mark',
          label: t('audio.block.markStart', { time: clockNs(position) }),
          separatorBefore: true,
          onSelect: () => markPartStart(entry.id, position),
        },
        {
          id: 'remove',
          label:
            start === undefined ? t('audio.block.removePart') : t('audio.block.removeEnd', { time: clockNs(position) }),
          disabled: start === undefined || position <= start,
          danger: true,
          onSelect: () => void removePart(block.id, pageId, entry, position),
        },
      ],
    });
  };
  return (
    <span ref={anchor}>
      <IconButton label={t('audio.block.more')} icon={DotsThreeIcon} hasPopup="menu" onPress={open} />
    </span>
  );
}
