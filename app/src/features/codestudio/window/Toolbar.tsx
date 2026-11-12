// The studio's toolbar (DESIGN 5.1). It shows the project's name and the language and runtime pickers, with Get
// for a runtime that needs a download. Its buttons are Run, Stop, Restart, Run tests, Debug (a later release),
// Snippets and examples, New project, and Settings.
import {
  ArrowClockwise,
  Bug,
  DownloadSimple,
  FilePlus,
  Flask,
  GearSix,
  Lightning,
  Play,
  Stop,
} from '@phosphor-icons/react';
import { useEffect, useId, useRef } from 'react';
import { navigate } from '../../../app/location';
import { executeCommand } from '../../../commands/registry';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, IconButton, openMenu } from '../../../ui';
import { PROJECT_LANGUAGES } from '../contracts';
import type { ProjectLanguage, RuntimeId } from '../contracts';
import { downloadPack, openCodeDownloads, packsState, refreshPacks } from '../packs/store';
import { examplesFor } from '../snippets/examples';
import { exampleTitle } from '../snippets/menu';
import type { StudioController } from './controller';
import { languageName, RUNTIME_PACKS, RUNTIMES, runtimeName } from './languages';
import styles from './studio.module.css';

function GetRuntime({ runtime }: { runtime: RuntimeId }) {
  const pack = RUNTIME_PACKS[runtime];
  const list = useStore(packsState, (state) => state.list);
  useEffect(() => {
    if (pack) void refreshPacks();
  }, [pack]);
  if (!pack) return null;
  const info = list?.packs.find((one) => one.id === pack);
  if (info?.state.kind === 'ready') return null;
  const busy = info?.state.kind === 'downloading';
  return (
    <Button
      variant="primary"
      disabled={busy}
      onClick={() => (info ? void downloadPack(info) : openCodeDownloads())}
      aria-label={t('codeStudio.studio.toolbar.getLabel', { runtime: runtimeName(runtime) })}
    >
      <DownloadSimple aria-hidden />
      {t(busy ? 'codeStudio.studio.toolbar.getting' : 'codeStudio.studio.toolbar.get')}
    </Button>
  );
}

async function chooseExample(controller: StudioController, anchor: HTMLElement): Promise<void> {
  const project = controller.project();
  if (!project) return;
  const examples = examplesFor(project.language);
  if (examples.length === 0) return;
  await openMenu({
    label: t('codeStudio.studio.toolbar.snippets'),
    anchor,
    items: examples.map((example, index) => ({
      id: example.id,
      label: exampleTitle(example),
      separatorBefore: index > 0 && example.kind !== examples[index - 1]!.kind,
      onSelect: () => void controller.insertExample(example),
    })),
  });
}

async function chooseNewProject(anchor: HTMLElement): Promise<void> {
  await openMenu({
    label: t('codeStudio.studio.toolbar.newProject'),
    anchor,
    items: (Object.keys(RUNTIMES) as ProjectLanguage[]).map((language) => ({
      id: language,
      label: languageName(language),
      onSelect: () => void executeCommand('code.newProject', { language }, 'menu'),
    })),
  });
}

function Pickers({ controller }: { controller: StudioController }) {
  const project = controller.project()!;
  const languageId = useId();
  const runtimeId = useId();
  const runtimes = RUNTIMES[project.language] ?? [];
  const locked = !(controller.store?.editable ?? false) || controller.running;
  return (
    <>
      <label className={styles.picker} htmlFor={languageId}>
        <span className={styles.pickerLabel}>{t('codeStudio.studio.toolbar.language')}</span>
        <select
          id={languageId}
          value={project.language}
          disabled={locked}
          onChange={(event) => controller.setLanguage(event.target.value as ProjectLanguage)}
        >
          {PROJECT_LANGUAGES.map((language) => (
            <option key={language} value={language}>
              {languageName(language)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles.picker} htmlFor={runtimeId}>
        <span className={styles.pickerLabel}>{t('codeStudio.studio.toolbar.runtime')}</span>
        <select
          id={runtimeId}
          value={project.runtime}
          disabled={locked || runtimes.length < 2}
          onChange={(event) => controller.setRuntime(event.target.value as RuntimeId)}
        >
          {runtimes.map((runtime) => (
            <option key={runtime} value={runtime}>
              {runtimeName(runtime)}
            </option>
          ))}
          {project.runtime === 'toolchain' && <option value="toolchain">{runtimeName('toolchain')}</option>}
        </select>
      </label>
    </>
  );
}

function RunButtons({ controller }: { controller: StudioController }) {
  const running = controller.running;
  return (
    <span className={styles.toolGroup}>
      <IconButton
        label={t('codeStudio.studio.toolbar.run')}
        icon={Play}
        command="code.run"
        disabled={running ? 'aria' : false}
        onPress={() => controller.run()}
      />
      <IconButton
        label={t('codeStudio.studio.toolbar.stop')}
        icon={Stop}
        command="code.stop"
        disabled={running ? false : 'aria'}
        onPress={() => controller.stop()}
      />
      <IconButton
        label={t('codeStudio.studio.toolbar.restart')}
        icon={ArrowClockwise}
        command="code.restart"
        onPress={() => controller.restart()}
      />
      <IconButton
        label={t('codeStudio.studio.toolbar.runTests')}
        icon={Flask}
        disabled={running ? 'aria' : false}
        onPress={() => controller.run(true)}
      />
      <IconButton
        label={t('codeStudio.studio.toolbar.debugLater')}
        icon={Bug}
        disabled="aria"
        onPress={() => undefined}
      />
    </span>
  );
}

function MoreButtons({ controller }: { controller: StudioController }) {
  const snippets = useRef<HTMLSpanElement>(null);
  const newProject = useRef<HTMLSpanElement>(null);
  const editable = controller.store?.editable ?? false;
  return (
    <span className={styles.toolGroup} ref={snippets}>
      <IconButton
        label={t('codeStudio.studio.toolbar.snippets')}
        icon={Lightning}
        hasPopup="menu"
        disabled={editable ? false : 'aria'}
        onPress={() => void chooseExample(controller, snippets.current!)}
      />
      <span ref={newProject}>
        <IconButton
          label={t('codeStudio.studio.toolbar.newProject')}
          icon={FilePlus}
          hasPopup="menu"
          onPress={() => void chooseNewProject(newProject.current!)}
        />
      </span>
      <IconButton
        label={t('codeStudio.studio.toolbar.settings')}
        icon={GearSix}
        onPress={() => navigate({ view: 'settings', section: 'code' })}
      />
    </span>
  );
}

export function Toolbar({ controller }: { controller: StudioController }) {
  const project = controller.project()!;
  return (
    <div className={styles.toolbar} role="toolbar" aria-label={t('codeStudio.studio.toolbar.label')}>
      <span className={styles.projectName} title={project.name}>
        {project.name}
      </span>
      <Pickers controller={controller} />
      {project.runtime !== 'toolchain' && <GetRuntime runtime={project.runtime} />}
      <RunButtons controller={controller} />
      <MoreButtons controller={controller} />
    </div>
  );
}
