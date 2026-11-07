// The record control in the command bar (Phase 9): Record and its options when idle, and Stop, Pause, and Flag
// while recording. The command bar passes `toolProps` so the arrow keys move between its tools.
import { FlagIcon } from '@phosphor-icons/react/dist/csr/Flag';
import { PauseIcon } from '@phosphor-icons/react/dist/csr/Pause';
import { PlayIcon } from '@phosphor-icons/react/dist/csr/Play';
import { RecordIcon } from '@phosphor-icons/react/dist/csr/Record';
import { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/csr/SlidersHorizontal';
import { StopIcon } from '@phosphor-icons/react/dist/csr/Stop';
import { lazy, Suspense, useRef, useState } from 'react';
import { useSizeClass } from '../../../state/layout';
import type { IconComponent } from '../../../ui';
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

/** An icon before the name, and the name beside a hidden semibold copy so the button keeps its width. */
function NamedLabel({ Icon, name }: { Icon: IconComponent; name: string }) {
  const medium = useSizeClass() === 'medium';
  return (
    <>
      {!medium && (
        <span className={tools.toolIcon} aria-hidden="true" data-tool-icon="">
          <Icon aria-hidden />
        </span>
      )}
      <span className={tools.label}>
        <span>{name}</span>
        <span className={tools.labelSizer} aria-hidden="true">
          {name}
        </span>
      </span>
    </>
  );
}

interface ToolProps {
  command: CommandId;
  Icon: IconComponent;
  name: MessageKey;
  toolProps: CommandBarComponentProps['toolProps'];
  disabled?: boolean;
}

function Tool({ command, Icon, name, toolProps, disabled }: ToolProps) {
  const keys = useKeysFor(command);
  return (
    <Tooltip label={t(name)} shortcut={keys[0] ? formatChord(keys[0]) : null}>
      <button
        type="button"
        {...toolProps}
        className={tools.tool}
        data-kind="named"
        aria-disabled={disabled || undefined}
        aria-keyshortcuts={keys.length ? ariaKeyShortcuts(keys) : undefined}
        onClick={() => !disabled && void executeCommand(command, undefined, 'commandBar')}
      >
        <NamedLabel Icon={Icon} name={t(name)} />
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
          <Tool command="audio.stop" Icon={StopIcon} name="audio.bar.stop" toolProps={toolProps} />
          <Tool
            command="audio.pause"
            Icon={ui.phase === 'paused' ? PlayIcon : PauseIcon}
            name={ui.phase === 'paused' ? 'audio.bar.resume' : 'audio.bar.pause'}
            toolProps={toolProps}
          />
          {flags && <Tool command="audio.flag" Icon={FlagIcon} name="audio.bar.flag" toolProps={toolProps} />}
        </>
      ) : (
        <Tool
          command="audio.record"
          Icon={RecordIcon}
          name="audio.bar.record"
          toolProps={toolProps}
          disabled={waiting}
        />
      )}
      {/* Options stays while recording, so the microphone can be switched without stopping. */}
      <button
        ref={anchor}
        type="button"
        {...toolProps}
        className={tools.tool}
        data-kind="named"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((shown) => !shown)}
      >
        <NamedLabel Icon={SlidersHorizontalIcon} name={t('audio.bar.options')} />
      </button>
      <Popover anchor={anchor} label={t('audio.options.title')} open={open} onClose={() => setOpen(false)}>
        <Suspense fallback={null}>
          <Options />
        </Suspense>
      </Popover>
    </span>
  );
}
