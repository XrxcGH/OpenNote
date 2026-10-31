// Linguistic structures: syntax and dependency trees, interlinear glosses, distinctive features, and natural
// classes, ordered rules and sound changes, syllables by sonority, and vowel charts.
import '../text';
import { useState } from 'react';
import { t } from '../../../../strings/t';
import { takeInputs } from '../open';
import { Source, Tabs, Tool, ht } from '../ui/parts';
import { FeaturePanel, RulePanel, SyllablePanel, VowelPanel } from './SoundPanels';
import { GlossPanel, TreePanel } from './TreePanels';
import type { TreeInputs } from './TreePanels';

type Tab = 'trees' | 'gloss' | 'features' | 'rules' | 'syllables' | 'vowels';
const TABS: readonly Tab[] = ['trees', 'gloss', 'features', 'rules', 'syllables', 'vowels'];

function startingTree(): TreeInputs {
  const saved = takeInputs('linguistics') as Partial<TreeInputs> | null;
  return {
    mode: saved?.mode === 'dependency' ? 'dependency' : 'syntax',
    syntax: typeof saved?.syntax === 'string' ? saved.syntax : '[S [NP the cat] [VP sat]]',
    dependency: typeof saved?.dependency === 'string' ? saved.dependency : 'the 2 det\ncat 3 nsubj\nsat 0 root',
  };
}

export function LinguisticsTool() {
  const [tab, setTab] = useState<Tab>('trees');
  const [tree, setTree] = useState(startingTree);
  const [gloss, setGloss] = useState({ example: 'kitap-lar-ım', gloss: 'book-PL-1SG.POSS', translation: 'my books' });
  return (
    <Tool label={t('kitHumanities.linguistics.title')}>
      <Tabs<Tab>
        label={t('kitHumanities.linguistics.modes')}
        items={TABS.map((id) => ({ id, label: ht(`linguistics.tabs.${id}`) }))}
        value={tab}
        onChange={setTab}
      />
      {tab === 'trees' ? <TreePanel inputs={tree} onChange={setTree} /> : null}
      {tab === 'gloss' ? <GlossPanel value={gloss} onChange={setGloss} /> : null}
      {tab === 'features' ? <FeaturePanel /> : null}
      {tab === 'rules' ? <RulePanel /> : null}
      {tab === 'syllables' ? <SyllablePanel /> : null}
      {tab === 'vowels' ? <VowelPanel /> : null}
      <Source of="linguistics" />
    </Tool>
  );
}
