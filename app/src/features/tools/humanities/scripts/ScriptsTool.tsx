// Scripts, keyboards, and romanization: on-screen keyboards for IPA and many alphabets, romanization by public
// tables, Hangul and its romanizations, kana and Hepburn, pinyin tones and sandhi, Thai tones, and Vietnamese input.
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { Tabs, Tool, ht } from '../ui/parts';
import { ChinesePanel, JapanesePanel, KoreanPanel, RomanizePanel, ThaiPanel, VietnamesePanel } from './ConvertPanels';
import { KeyboardPanel } from './KeyboardPanel';

type Tab = 'keyboards' | 'romanize' | 'korean' | 'japanese' | 'chinese' | 'thai' | 'vietnamese';
const TABS: readonly Tab[] = ['keyboards', 'romanize', 'korean', 'japanese', 'chinese', 'thai', 'vietnamese'];

export function ScriptsTool() {
  const [tab, setTab] = useState<Tab>('keyboards');
  return (
    <Tool label={t('kitHumanities.scripts.title')}>
      <Tabs<Tab>
        label={t('kitHumanities.scripts.modes')}
        items={TABS.map((id) => ({ id, label: ht(`scripts.tabs.${id}`) }))}
        value={tab}
        onChange={setTab}
      />
      {tab === 'keyboards' ? <KeyboardPanel /> : null}
      {tab === 'romanize' ? <RomanizePanel /> : null}
      {tab === 'korean' ? <KoreanPanel /> : null}
      {tab === 'japanese' ? <JapanesePanel /> : null}
      {tab === 'chinese' ? <ChinesePanel /> : null}
      {tab === 'thai' ? <ThaiPanel /> : null}
      {tab === 'vietnamese' ? <VietnamesePanel /> : null}
    </Tool>
  );
}
