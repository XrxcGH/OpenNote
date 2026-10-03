// The Paste part of Settings, Editing (Phase 4 ARCHITECTURE.md section 15.7): source links below text from a
// browser, saving web images into the page, and joining broken lines from PDFs.
import { updateSettings, useSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { RadioCard, RadioGroup, Switch } from '../../../ui';
import styles from './EditingTyping.module.css';

type SourceLink = 'ask' | 'always' | 'never';

export default function EditingPaste() {
  const paste = useSettings((settings) => settings.editing.paste);
  const set = (patch: Partial<typeof paste>) => void updateSettings({ editing: { paste: patch } });
  return (
    <section className={styles.part} aria-labelledby="editing-paste">
      <h2 id="editing-paste">{t('paste.settings.title')}</h2>
      <RadioGroup<SourceLink>
        label={t('paste.settings.sourceLink')}
        value={paste.sourceLink}
        onChange={(sourceLink) => set({ sourceLink })}
      >
        <RadioCard<SourceLink> value="ask" label={t('paste.settings.sourceLinkAsk')} />
        <RadioCard<SourceLink> value="always" label={t('paste.settings.sourceLinkAlways')} />
        <RadioCard<SourceLink> value="never" label={t('paste.settings.sourceLinkNever')} />
      </RadioGroup>
      <Switch
        label={t('paste.settings.saveWebImages')}
        checked={paste.saveWebImages}
        onChange={(saveWebImages) => set({ saveWebImages })}
      >
        {t('paste.settings.saveWebImagesHint')}
      </Switch>
      <Switch
        label={t('paste.settings.joinPdfLines')}
        checked={paste.joinPdfLines}
        onChange={(joinPdfLines) => set({ joinPdfLines })}
      />
    </section>
  );
}
