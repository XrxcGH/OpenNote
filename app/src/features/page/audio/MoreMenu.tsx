// The "More" menu of a recording on the page (Phase 9): trimming, splitting and removing parts, the enhanced voice,
// and saving the recording as an audio file. Only what is on shows: a feature whose flag is off is left out.
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { useRef } from 'react';
import { useFlag } from '../../../app/flags';
import { audioIsRemoved, enhancedTracks } from '../../../core/audio';
import type { RecordingEntry } from '../../../core/audio';
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { IconButton, openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
import { markPartStart, partStart, removePart, splitRecording, trimSilence } from './edits';
import { clockNs } from './format';

/** A split must leave at least this much on each side. */
const SPLIT_MARGIN_NS = 1_000_000_000;

interface Props {
  block: BlockJson;
  entry: RecordingEntry;
  pageId: string;
  position: number;
  total: number;
}

function editItems({ block, entry, pageId, position, total }: Props): MenuItemSpec[] {
  const start = partStart(entry.id);
  return [
    { id: 'trim', label: t('audio.block.trimSilence'), onSelect: () => void trimSilence(block.id, pageId, entry) },
    {
      id: 'split',
      label: t('audioMore.menu.split', { time: clockNs(position) }),
      disabled: position < SPLIT_MARGIN_NS || position > total - SPLIT_MARGIN_NS,
      onSelect: () => void splitRecording(block.id, pageId, entry, position),
    },
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
  ];
}

function enhanceItem({ block, entry, pageId }: Props): MenuItemSpec {
  const has = enhancedTracks(entry).length > 0;
  return {
    id: 'enhance',
    label: t(has ? 'audioMore.menu.removeEnhanced' : 'audioMore.menu.enhance'),
    separatorBefore: true,
    onSelect: () =>
      void import('./enhance').then((module) =>
        has ? module.removeEnhanced(block, pageId, entry) : module.enhanceVoice(block, pageId, entry),
      ),
  };
}

function exportItems({ entry, pageId }: Props): MenuItemSpec[] {
  const save = (format: 'wav' | 'opus') => () =>
    void import('./exportAudio').then((module) => module.exportRecording(pageId, entry, format));
  return [
    { id: 'wav', label: t('audioMore.menu.exportWav'), separatorBefore: true, onSelect: save('wav') },
    { id: 'opus', label: t('audioMore.menu.exportOpus'), onSelect: save('opus') },
  ];
}

export function MoreMenu(props: Props) {
  const { entry } = props;
  const trim = useFlag('audio.trim');
  const enhance = useFlag('audio.enhance');
  const exporting = useFlag('audio.export');
  const anchor = useRef<HTMLSpanElement>(null);
  const items = [
    ...(trim ? editItems(props) : []),
    ...(enhance ? [enhanceItem(props)] : []),
    ...(exporting ? exportItems(props) : []),
  ];
  if (items.length === 0 || audioIsRemoved(entry)) return null;
  const open = () => {
    const button = anchor.current?.querySelector('button');
    if (button) void openMenu({ label: t('audio.block.more'), anchor: button, returnFocus: button, items });
  };
  return (
    <span ref={anchor}>
      <IconButton label={t('audio.block.more')} icon={DotsThreeIcon} hasPopup="menu" onPress={open} />
    </span>
  );
}
