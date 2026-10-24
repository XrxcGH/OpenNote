// The dialogs of the transcript features: adding a transcript from text, naming a speaker, and choosing what goes
// into the recap. Each resolves with the answer, or with null when the person cancels.
import { useEffect, useId, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button, Dialog, showToast, TextField } from '../../../../ui';
import { openDialog } from '../dialog';
import { collectRecap, copyRecapText } from './actions';
import styles from './transcripts.module.css';
import { recapHtml, recapMarkdown } from './model';
import type { Recap, RecapParts } from './model';
import { savedSpeakerNames } from './store';

/** Asks for the text of a transcript: captions, lines that start with a time, or plain text. */
export function askForTranscript(): Promise<string | null> {
  let answer: string | null = null;
  return openDialog((close) => <AddDialog onDone={(text) => ((answer = text), close())} />).then(() => answer);
}

function AddDialog({ onDone }: { onDone(text: string | null): void }) {
  const [text, setText] = useState('');
  const field = useId();
  return (
    <Dialog
      title={t('audioMore.transcript.addTitle')}
      description={t('audioMore.transcript.addBody')}
      size="large"
      onDismiss={() => onDone(null)}
      actions={[
        { id: 'cancel', label: t('audioMore.transcript.addCancel'), variant: 'secondary', onPress: () => onDone(null) },
        {
          id: 'add',
          label: t('audioMore.transcript.addSave'),
          variant: 'primary',
          onPress: () => {
            if (text.trim()) onDone(text);
            else showToast({ message: t('audioMore.transcript.addEmpty') });
          },
        },
      ]}
    >
      <label htmlFor={field} className={styles.label}>
        {t('audioMore.transcript.addLabel')}
      </label>
      <textarea
        id={field}
        className={styles.paste}
        rows={10}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <p className={styles.help}>{t('audioMore.transcript.rights')}</p>
    </Dialog>
  );
}

/** Asks what a speaker is called. The names used before are offered as suggestions. */
export function askSpeakerName(current: string, label: string): Promise<string | null> {
  let answer: string | null = null;
  return openDialog((close) => (
    <NameDialog current={current} label={label} onDone={(name) => ((answer = name), close())} />
  )).then(() => answer);
}

function NameDialog(props: { current: string; label: string; onDone(name: string | null): void }) {
  const [name, setName] = useState(props.current);
  const suggestions = savedSpeakerNames()
    .filter((saved) => saved !== name)
    .slice(0, 8);
  return (
    <Dialog
      title={t('audioMore.transcript.renameTitle', { name: props.label })}
      description={t('audioMore.transcript.renameBody')}
      onDismiss={() => props.onDone(null)}
      actions={[
        {
          id: 'cancel',
          label: t('audioMore.transcript.renameCancel'),
          variant: 'secondary',
          onPress: () => props.onDone(null),
        },
        {
          id: 'save',
          label: t('audioMore.transcript.renameSave'),
          variant: 'primary',
          onPress: () => props.onDone(name),
        },
      ]}
    >
      <TextField
        label={t('audioMore.transcript.renameLabel')}
        value={name}
        onChange={setName}
        autoSelect
        onCommit={() => props.onDone(name)}
        onCancel={() => props.onDone(null)}
      />
      {suggestions.length > 0 && (
        <div className={styles.suggest}>
          <span className={styles.help}>{t('audioMore.transcript.renameSuggestions')}</span>
          <ul className={styles.chips}>
            {suggestions.map((saved) => (
              <li key={saved}>
                <Button variant="quiet" onClick={() => setName(saved)}>
                  {saved}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Dialog>
  );
}

/** Lets the person choose which parts of the meeting recap to copy, shows them, and copies them. */
export function openRecap(): Promise<void> {
  return openDialog((close) => <RecapDialog onClose={close} />);
}

const words = () => ({
  summary: t('audioMore.transcript.recapSummary'),
  decisions: t('audioMore.transcript.recapDecisions'),
  actions: t('audioMore.transcript.recapActions'),
  headings: t('audioMore.transcript.heading'),
});

function RecapDialog({ onClose }: { onClose(): void }) {
  const [recap, setRecap] = useState<Recap | null>(null);
  const [parts, setParts] = useState<RecapParts>({ summary: true, decisions: true, actions: true, headings: false });
  const [format, setFormat] = useState<'formatted' | 'markdown'>('formatted');
  useEffect(() => {
    let current = true;
    void collectRecap().then((found) => {
      if (!current) return;
      setRecap(found);
      setParts({
        summary: true,
        decisions: true,
        actions: true,
        headings: !found.summary && found.decisions.length === 0,
      });
    });
    return () => {
      current = false;
    };
  }, []);
  const preview = recap ? (format === 'markdown' ? recapMarkdown(recap, parts, words()) : plain(recap, parts)) : '';
  const empty = recap !== null && !recapMarkdown(recap, parts, words());
  const toggle = (key: keyof RecapParts) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setParts({ ...parts, [key]: event.target.checked });
  const choices: { key: keyof RecapParts; label: string; has: boolean }[] = recap
    ? [
        { key: 'summary', label: t('audioMore.transcript.recapSummary'), has: recap.summary !== '' },
        { key: 'decisions', label: t('audioMore.transcript.recapDecisions'), has: recap.decisions.length > 0 },
        { key: 'actions', label: t('audioMore.transcript.recapActions'), has: recap.actions.length > 0 },
        { key: 'headings', label: t('audioMore.transcript.heading'), has: recap.headings.length > 0 },
      ]
    : [];
  return (
    <Dialog
      title={t('audioMore.transcript.recapTitle')}
      description={
        recap?.summary || recap?.decisions.length
          ? t('audioMore.transcript.recapBody')
          : t('audioMore.transcript.recapFromPage')
      }
      size="large"
      onDismiss={onClose}
      actions={[
        { id: 'cancel', label: t('audioMore.transcript.recapCancel'), variant: 'secondary', onPress: onClose },
        {
          id: 'copy',
          label: t('audioMore.transcript.recapCopy'),
          variant: 'primary',
          onPress: async () => {
            if (!recap || empty) return void showToast({ message: t('audioMore.transcript.recapEmpty') });
            await copyRecapText(recap, parts, format);
            onClose();
          },
        },
      ]}
    >
      {recap && !choices.some((choice) => choice.has) && (
        <p className={styles.help}>{t('audioMore.transcript.recapNothing')}</p>
      )}
      <div className={styles.choices}>
        {choices
          .filter((choice) => choice.has)
          .map((choice) => (
            <label key={choice.key} className={styles.choice}>
              <input type="checkbox" checked={parts[choice.key]} onChange={toggle(choice.key)} />
              {choice.label}
            </label>
          ))}
      </div>
      <div className={styles.choices}>
        <span className={styles.help}>{t('audioMore.transcript.recapFormat')}</span>
        {(['formatted', 'markdown'] as const).map((one) => (
          <label key={one} className={styles.choice}>
            <input type="radio" name="recap-format" checked={format === one} onChange={() => setFormat(one)} />
            {t(one === 'formatted' ? 'audioMore.transcript.recapFormatted' : 'audioMore.transcript.recapMarkdown')}
          </label>
        ))}
      </div>
      <h3 className={styles.previewHeading}>{t('audioMore.transcript.recapPreview')}</h3>
      <pre className={styles.preview}>{preview}</pre>
    </Dialog>
  );
}

/** The recap as formatted text appears when pasted: headings and bullets, without the Markdown marks. */
function plain(recap: Recap, parts: RecapParts): string {
  const html = recapHtml(recap, parts, words());
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.body.children]
    .map((node) =>
      node.tagName === 'UL'
        ? [...node.children].map((item) => `• ${item.textContent ?? ''}`).join('\n')
        : (node.textContent ?? ''),
    )
    .join('\n\n');
}
