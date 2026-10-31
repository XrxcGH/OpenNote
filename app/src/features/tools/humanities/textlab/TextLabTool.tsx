// Text analysis and verse: one text shared by readability, word lists, the concordance, keyness, and comparing
// versions, plus a language sample and scansion with texts of their own.
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { Source, Tabs, Tool, ht } from '../ui/parts';
import { KwicPanel, ReadPanel, TextField, WordsPanel } from './TextPanels';
import { ComparePanel, KeynessPanel, SamplePanel, VersePanel } from './VersePanels';

type Tab = 'read' | 'words' | 'kwic' | 'keyness' | 'compare' | 'sample' | 'verse';
const TABS: readonly Tab[] = ['read', 'words', 'kwic', 'keyness', 'compare', 'sample', 'verse'];
const SHARED: readonly Tab[] = ['read', 'words', 'kwic', 'keyness', 'compare'];

export function TextLabTool() {
  const [tab, setTab] = useState<Tab>('read');
  const [text, setText] = useState(() => t('kitHumanities.textlab.example'));
  return (
    <Tool label={t('kitHumanities.textlab.title')}>
      <Tabs<Tab>
        label={t('kitHumanities.textlab.modes')}
        items={TABS.map((id) => ({ id, label: ht(`textlab.tabs.${id}`) }))}
        value={tab}
        onChange={setTab}
      />
      {SHARED.includes(tab) ? <TextField value={text} onChange={setText} /> : null}
      {tab === 'read' ? <ReadPanel text={text} /> : null}
      {tab === 'words' ? <WordsPanel text={text} /> : null}
      {tab === 'kwic' ? <KwicPanel text={text} /> : null}
      {tab === 'keyness' ? <KeynessPanel text={text} /> : null}
      {tab === 'compare' ? <ComparePanel text={text} /> : null}
      {tab === 'sample' ? <SamplePanel /> : null}
      {tab === 'verse' ? <VersePanel /> : null}
      <Source of="textlab" />
    </Tool>
  );
}
