// The per-source default of Paste Options, in Settings, Editing (ADR 0084): what a paste from Word, Google Docs,
// OneNote, and a web page keeps. The Paste options notice changes the choice for one paste only.
import { updateSettings, useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { RadioCard, RadioGroup } from '../../../ui';
import type { PasteChoice } from './types';

const SOURCES = ['word', 'docs', 'onenote', 'web'] as const;

export default function PasteDefaults() {
  const paste = useSettings((settings) => settings.text.paste);
  return (
    <>
      <h3>{t('textPaste.settings.title')}</h3>
      <p>{t('textPaste.settings.hint')}</p>
      {SOURCES.map((source) => (
        <RadioGroup<PasteChoice>
          key={source}
          label={t(`textPaste.settings.${source}`)}
          value={paste[source]}
          onChange={(choice) => void updateSettings({ text: { paste: { [source]: choice } } })}
        >
          <RadioCard<PasteChoice> value="keepSource" label={t('textPaste.keepSource')} />
          <RadioCard<PasteChoice> value="mergeFormatting" label={t('textPaste.mergeFormatting')} />
          <RadioCard<PasteChoice> value="textOnly" label={t('textPaste.textOnly')} />
        </RadioGroup>
      ))}
    </>
  );
}
