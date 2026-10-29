// The record control in the command bar (Phase 9): Record and its options when idle, and Stop, Pause, and Flag
// while recording. The command bar passes `toolProps` so the arrow keys move between its tools.
import { lazy, Suspense, useRef, useState } from 'react';
import { useFlag } from '../../../app/flags';
import { ariaKeyShortcuts, formatChord, useKeysFor } from '../../../commands/keymap';
import { executeCommand } from '../../../commands/registry';
import type { CommandId } from '../../../commands/types';
import type { CommandBarComponentProps } from '../../../registries/types';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Popover, Tooltip } from '../../../ui';
import tools from '../../../shell/commandbar/CommandBar.module.css';
import { isRunning, recordingUi } from './state';

const Options = lazy(() => import('./OptionsPanel'));

interface ToolProps {
  command: CommandId;
  name: MessageKey;
  toolProps: CommandBarComponentProps['toolProps'];
  disabled?: boolean;
}

function Tool({ command, name, toolProps, disabled }: ToolProps) {
  const keys = useKeysFor(command);
  return (
    <Tooltip label={t(name)} shortcut={keys[0] ? formatChord(keys[0]) : null}>
      <button
        type="button"
        {...toolProps}
        className={tools.tool}
        aria-disabled={disabled || undefined}
        aria-keyshortcuts={keys.length ? ariaKeyShortcuts(keys) : undefined}
        onClick={() => !disabled && void executeCommand(command, undefined, 'commandBar')}
      >
        {t(name)}
      </button>
    </Tooltip>
  );
}

export function RecordControl({ toolProps }: CommandBarComponentProps) {
  const ui = useStore(recordingUi, (state) => state);
  const flags = useFlag('audio.flags');
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const running = isRunning(ui);
  const waiting = ui.phase === 'starting' || ui.phase === 'stopping';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center' }} role="group" aria-label={t('audio.bar.group')}>
      {running ? (
        <>
          <Tool command="audio.stop" name="audio.bar.stop" toolProps={toolProps} />
          <Tool
            command="audio.pause"
            name={ui.phase === 'paused' ? 'audio.bar.resume' : 'audio.bar.pause'}
            toolProps={toolProps}
          />
          {flags && <Tool command="audio.flag" name="audio.bar.flag" toolProps={toolProps} />}
        </>
      ) : (
        <>
          <Tool command="audio.record" name="audio.bar.record" toolProps={toolProps} disabled={waiting} />
          <button
            ref={anchor}
            type="button"
            {...toolProps}
            className={tools.tool}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen((shown) => !shown)}
          >
            {t('audio.bar.options')}
          </button>
          <Popover anchor={anchor} label={t('audio.options.title')} open={open} onClose={() => setOpen(false)}>
            <Suspense fallback={null}>
              <Options />
            </Suspense>
          </Popover>
        </>
      )}
    </span>
  );
}
