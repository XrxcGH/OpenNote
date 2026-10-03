// The update chip in the title bar (ARCHITECTURE.md section 18.11): "Update ready" once an update is checked, or
// "Update available" when the person decides. It's a button that opens the details in a popover, and it never
// opens anything by itself.

import { ArrowsClockwiseIcon } from '@phosphor-icons/react/dist/csr/ArrowsClockwise';
import { useId, useRef, useState } from 'react';
import { useSettings } from '../../state/settings';
import { useUpdaterStatus } from '../../state/updater';
import { Popover } from '../../ui';
import { chipLabel } from './model';
import { UpdateDetails } from './UpdateDetails';
import styles from './UpdateDetails.module.css';

export function UpdateChip() {
  const phase = useUpdaterStatus((status) => status.phase);
  const install = useSettings((settings) => settings.updates.install);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const label = chipLabel(phase, install);
  if (!label) return null;
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={styles.chip}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <ArrowsClockwiseIcon aria-hidden="true" />
        {label}
      </button>
      <Popover anchor={anchor} label={label} open={open} onClose={() => setOpen(false)}>
        <UpdateDetails phase={phase} place="popover" titleId={titleId} onLater={() => setOpen(false)} />
      </Popover>
    </>
  );
}
