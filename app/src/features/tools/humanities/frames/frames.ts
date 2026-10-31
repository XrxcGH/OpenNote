// The note frames there are, each with its subject group and, for a table without named rows, how many rows.
// Their names, guidance, and outlines are in the kit's strings.
import type { kitHumanities } from '../../../../strings/en/kitHumanities';
import type { FrameGroup } from './engine';

export type FrameId = keyof (typeof kitHumanities)['frames']['f'];

export const FRAME_GROUPS: readonly FrameGroup[] = [
  'writing',
  'history',
  'law',
  'policy',
  'education',
  'fieldwork',
  'collections',
  'arts',
  'business',
  'science',
];

export const FRAMES: readonly { id: FrameId; group: FrameGroup; rows?: number }[] = [
  { id: 'essayPlanner', group: 'writing' },
  { id: 'claimEvidence', group: 'writing', rows: 3 },
  { id: 'closeReading', group: 'writing' },
  { id: 'rhetorical', group: 'writing' },
  { id: 'literatureReview', group: 'writing', rows: 5 },
  { id: 'researchProposal', group: 'writing' },
  { id: 'translationGrid', group: 'writing' },
  { id: 'adaptation', group: 'writing' },
  { id: 'visualAnalysis', group: 'writing' },
  { id: 'primarySource', group: 'history' },
  { id: 'historiography', group: 'history' },
  { id: 'countryProfile', group: 'history' },
  { id: 'oralHistory', group: 'history', rows: 6 },
  { id: 'caseBrief', group: 'law' },
  { id: 'argument', group: 'law' },
  { id: 'ethicsCase', group: 'law' },
  { id: 'policyMemo', group: 'policy' },
  { id: 'logicModel', group: 'policy', rows: 3 },
  { id: 'optionsMatrix', group: 'policy' },
  { id: 'caseFormulation', group: 'policy' },
  { id: 'lessonPlan', group: 'education' },
  { id: 'smartGoal', group: 'education', rows: 6 },
  { id: 'fieldNotes', group: 'fieldwork' },
  { id: 'interviewGuide', group: 'fieldwork' },
  { id: 'objectRecord', group: 'collections' },
  { id: 'conditionReport', group: 'collections' },
  { id: 'exhibitionLabel', group: 'collections' },
  { id: 'shotList', group: 'arts', rows: 6 },
  { id: 'callSheet', group: 'arts', rows: 6 },
  { id: 'scriptBreakdown', group: 'arts' },
  { id: 'rehearsalReport', group: 'arts' },
  { id: 'eightCount', group: 'arts' },
  { id: 'practiceLog', group: 'arts', rows: 7 },
  { id: 'listeningLog', group: 'arts' },
  { id: 'businessModel', group: 'business' },
  { id: 'swot', group: 'business' },
  { id: 'valueChain', group: 'business' },
  { id: 'fiveForces', group: 'business' },
  { id: 'labReport', group: 'science' },
  { id: 'designReview', group: 'science', rows: 5 },
  { id: 'problemJournal', group: 'science' },
  { id: 'proofOutline', group: 'science' },
];
