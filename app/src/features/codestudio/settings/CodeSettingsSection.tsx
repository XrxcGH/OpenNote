// Settings, then Code (DESIGN 5.6). It holds indentation per language, the Python runtime, and the run limits.
// It holds completion, suggestions, the Accept button, and announcements. It holds the diagnostics level, the C
// and C++ flags, the runtime downloads, and Reset. Each control writes at once; an open editor follows.
import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { Button, confirm, Switch } from '../../../ui';
import { openCodeDownloads } from '../packs/store';
import type { EditorLanguage } from '../editor/indent';
import { languageName } from '../window/languages';
import {
  changeCode,
  changeIndent,
  clamp,
  indentOf,
  RANGES,
  resetCode,
  SETTING_LANGUAGES,
  TAB_LANGUAGES,
} from './model';
import type { CodeSettings } from './model';
import styles from './settings.module.css';

interface Choice<V extends string> {
  value: V;
  label: MessageKey;
  disabled?: boolean;
}

function Select<V extends string>(props: {
  label: string;
  value: V;
  choices: readonly Choice<V>[];
  onChange(value: V): void;
  help?: string;
}) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{props.label}</label>
      <select
        id={id}
        value={props.value}
        aria-describedby={props.help ? `${id}-help` : undefined}
        onChange={(event) => props.onChange(event.target.value as V)}
      >
        {props.choices.map((choice) => (
          <option key={choice.value} value={choice.value} disabled={choice.disabled}>
            {t(choice.label)}
          </option>
        ))}
      </select>
      {props.help && (
        <p id={`${id}-help`} className={styles.help}>
          {props.help}
        </p>
      )}
    </div>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  range: keyof typeof RANGES;
  onChange(value: number): void;
}) {
  const id = useId();
  const [low, high] = RANGES[props.range];
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{props.label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={low}
        max={high}
        value={props.value}
        onChange={(event) => {
          if (event.target.value !== '') props.onChange(clamp(props.range, Number(event.target.value)));
        }}
      />
    </div>
  );
}

function Group(props: { heading: MessageKey; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.group} aria-labelledby={id}>
      <h3 id={id}>{t(props.heading)}</h3>
      {props.children}
    </section>
  );
}

const save = (patch: Partial<CodeSettings>) => void changeCode(patch);

function Indentation({ code }: { code: CodeSettings }) {
  const [language, setLanguage] = useState<EditorLanguage>('python');
  const indent = indentOf(language, code);
  const fixed = TAB_LANGUAGES.includes(language);
  const languageId = useId();
  return (
    <Group heading="codeStudio.studio.settings.indentTitle">
      <div className={styles.field}>
        <label htmlFor={languageId}>{t('codeStudio.studio.settings.language')}</label>
        <select
          id={languageId}
          value={language}
          onChange={(event) => setLanguage(event.target.value as EditorLanguage)}
        >
          {SETTING_LANGUAGES.map((one) => (
            <option key={one} value={one}>
              {languageName(one)}
            </option>
          ))}
        </select>
      </div>
      <NumberField
        label={t('codeStudio.studio.settings.tabSize')}
        value={indent.tabSize}
        range="tabSize"
        onChange={(tabSize) => void changeIndent(language, { ...indent, tabSize })}
      />
      <Switch
        label={t('codeStudio.studio.settings.insertSpaces')}
        checked={indent.insertSpaces}
        disabled={fixed ? 'aria' : false}
        onChange={(insertSpaces) => {
          if (!fixed) void changeIndent(language, { ...indent, insertSpaces });
        }}
      />
      {fixed && <p className={styles.help}>{t('codeStudio.studio.settings.tabsFixed')}</p>}
    </Group>
  );
}

function RunGroup({ code }: { code: CodeSettings }) {
  return (
    <Group heading="codeStudio.studio.settings.runTitle">
      <Select
        label={t('codeStudio.studio.settings.pythonRuntime')}
        value={code.pythonRuntime}
        choices={[
          { value: 'quick', label: 'codeStudio.studio.settings.pythonQuick' },
          { value: 'full', label: 'codeStudio.studio.settings.pythonFull' },
        ]}
        onChange={(pythonRuntime) => save({ pythonRuntime })}
      />
      <NumberField
        label={t('codeStudio.studio.settings.timeLimit')}
        value={code.timeLimitSeconds}
        range="timeLimitSeconds"
        onChange={(timeLimitSeconds) => save({ timeLimitSeconds })}
      />
      <NumberField
        label={t('codeStudio.studio.settings.memoryLimit')}
        value={code.memoryLimitMib}
        range="memoryLimitMib"
        onChange={(memoryLimitMib) => save({ memoryLimitMib })}
      />
      <Button onClick={() => openCodeDownloads()}>{t('codeStudio.packs.downloadsLink')}</Button>
    </Group>
  );
}

function SuggestGroup({ code }: { code: CodeSettings }) {
  return (
    <Group heading="codeStudio.studio.settings.suggestTitle">
      <Switch
        label={t('codeStudio.studio.settings.completionList')}
        checked={code.completionList}
        onChange={(completionList) => save({ completionList })}
      />
      <Select
        label={t('codeStudio.studio.settings.suggestions')}
        value={code.suggestions}
        choices={[
          { value: 'off', label: 'codeStudio.studio.settings.suggestOff' },
          { value: 'onRequest', label: 'codeStudio.studio.settings.suggestOnRequest' },
          { value: 'automaticRules', label: 'codeStudio.studio.settings.suggestRules' },
          { value: 'automaticModel', label: 'codeStudio.studio.settings.suggestModel', disabled: true },
        ]}
        help={t('codeStudio.studio.settings.suggestHelp')}
        onChange={(suggestions) => save({ suggestions })}
      />
      <Select
        label={t('codeStudio.studio.settings.acceptButton')}
        value={code.acceptButton}
        choices={[
          { value: 'touchOrPen', label: 'codeStudio.studio.settings.acceptTouch' },
          { value: 'always', label: 'codeStudio.studio.settings.acceptAlways' },
          { value: 'never', label: 'codeStudio.studio.settings.acceptNever' },
        ]}
        onChange={(acceptButton) => save({ acceptButton })}
      />
      <Switch
        label={t('codeStudio.studio.settings.announce')}
        checked={code.announceSuggestions}
        onChange={(announceSuggestions) => save({ announceSuggestions })}
      />
    </Group>
  );
}

function CheckGroup({ code }: { code: CodeSettings }) {
  return (
    <Group heading="codeStudio.studio.settings.checkTitle">
      <Select
        label={t('codeStudio.studio.settings.diagnostics')}
        value={code.diagnostics}
        choices={[
          { value: 'errors', label: 'codeStudio.studio.settings.diagErrors' },
          { value: 'warnings', label: 'codeStudio.studio.settings.diagWarnings' },
          { value: 'everything', label: 'codeStudio.studio.settings.diagEverything' },
        ]}
        onChange={(diagnostics) => save({ diagnostics })}
      />
      <Select
        label={t('codeStudio.studio.settings.cStandard')}
        value={code.cStandard}
        choices={[
          { value: 'c99', label: 'codeStudio.studio.settings.c99' },
          { value: 'c11', label: 'codeStudio.studio.settings.c11' },
          { value: 'c17', label: 'codeStudio.studio.settings.c17' },
          { value: 'c23', label: 'codeStudio.studio.settings.c23' },
        ]}
        onChange={(cStandard) => save({ cStandard })}
      />
      <Select
        label={t('codeStudio.studio.settings.cppStandard')}
        value={code.cppStandard}
        choices={[
          { value: 'cpp14', label: 'codeStudio.studio.settings.cpp14' },
          { value: 'cpp17', label: 'codeStudio.studio.settings.cpp17' },
          { value: 'cpp20', label: 'codeStudio.studio.settings.cpp20' },
          { value: 'cpp23', label: 'codeStudio.studio.settings.cpp23' },
        ]}
        onChange={(cppStandard) => save({ cppStandard })}
      />
      <Switch
        label={t('codeStudio.studio.settings.warnings')}
        checked={code.compilerWarnings}
        onChange={(compilerWarnings) => save({ compilerWarnings })}
      />
    </Group>
  );
}

async function reset(): Promise<void> {
  const yes = await confirm({
    title: t('codeStudio.studio.settings.resetTitle'),
    body: t('codeStudio.studio.settings.resetBody'),
    confirmLabel: t('codeStudio.studio.settings.reset'),
  });
  if (yes) await resetCode();
}

export default function CodeSettingsSection() {
  const code = useSettings((settings) => settings.code);
  return (
    <div className={styles.section} data-testid="code-settings">
      <Indentation code={code} />
      <RunGroup code={code} />
      <SuggestGroup code={code} />
      <CheckGroup code={code} />
      <div className={styles.actions}>
        <Button variant="secondary" onClick={() => void reset()}>
          {t('codeStudio.studio.settings.reset')}
        </Button>
      </div>
    </div>
  );
}
