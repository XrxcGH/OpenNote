// One tutor session (ADR 0050): the text the person chose to show the tutor, the conversation, the hint rung, and
// the consent for the person's own key. A session lasts until the panel closes; closing it forgets the conversation
// and every consent. Nothing here reads the page or the notebook: the page side (features/page/tutor) hands in only
// the lines the person picked, and the person can edit them.
import { isEnabled } from '../../app/flags';
import { isOffline } from '../diagnostics';
import type { StepLine, StepResult } from '../math';
import { mathKit } from './kit';
import { createStore } from '../../state/store';
import { t } from '../../strings/t';
import { announce, confirm } from '../../ui';
import { MAX_CONTEXT_CHARS, tutorReply, type Mode, type Prompt, type Turn, type Where, type Writers } from './engine';
import { LAST_RUNG, planFor, rungName, type Plan, type Rung } from './ladder';

export interface ShownTurn extends Turn {
  /** Such as "Hint 2 of 4: The idea". */
  label?: string;
  where?: Where;
  /** The service a cloud reply came from. */
  host?: string;
  fellBack?: boolean;
}

export interface Seed {
  lines: StepLine[];
  results: StepResult[] | null;
  focus?: number;
}

export interface TutorState {
  context: string;
  /** The lines and verdicts the context came from, while the person has not edited it. */
  seed: Seed | null;
  rung: 0 | Rung;
  /** The person tried: asked for a hint, asked a question, or brought their own working. */
  tried: boolean;
  turns: ShownTurn[];
  busy: boolean;
  /** The exact text waiting for the person's yes or no before it goes to their cloud service. */
  consent: { text: string; host: string } | null;
  /** Work offline was on for the last reply, and a cloud key was chosen. */
  offlineNote: boolean;
}

const EMPTY: TutorState = {
  context: '',
  seed: null,
  rung: 0,
  tried: false,
  turns: [],
  busy: false,
  consent: null,
  offlineNote: false,
};

export const tutorState = createStore<TutorState>(EMPTY, 'tutor');

const granted = new Set<string>();
const declined = new Set<string>();
let answerConsent: ((yes: boolean) => void) | null = null;

/** Reasons Check my work gives a line that is not the student's working: the problem itself, a note, or words. */
const NOT_WORKING = new Set<string>(['start', 'note', 'notMath', 'unreadable']);

/**
 * Whether the seed holds working of the student's own: a line after the first that Check my work read as a step.
 * Selecting the problem with a line of words, or the problem alone, is not a try.
 */
const hasWorking = (seed: Seed | null): boolean =>
  seed?.results?.some((result) => result.index > 0 && !NOT_WORKING.has(result.reason)) ?? false;

/** Puts the chosen lines in front of the tutor. The rung starts over; the conversation stays. */
export function setContext(context: string, seed: Seed | null = null): void {
  tutorState.set((state) => ({
    ...state,
    context: context.slice(0, MAX_CONTEXT_CHARS * 2),
    seed,
    rung: 0,
    tried: hasWorking(seed),
  }));
}

/** The person typed in the context box: the lines read from the page no longer match it. */
export function editContext(context: string): void {
  tutorState.set((state) => ({ ...state, context, seed: null, rung: 0 }));
}

function checked(lines: readonly StepLine[]): StepResult[] | null {
  try {
    return mathKit()?.checkSteps(lines, { budgetMs: 1500 }) ?? null;
  } catch {
    return null;
  }
}

/** The plan for what the tutor sees now. */
export function currentPlan(state: Pick<TutorState, 'context' | 'seed'> = tutorState.get()): Plan {
  if (state.seed) return planFor(state.seed.lines, state.seed.results, state.seed.focus);
  const lines = state.context
    .split('\n')
    .map((text) => text.trim())
    .filter((text) => text !== '')
    .slice(0, 60)
    .map((text): StepLine => ({ text }));
  if (lines.length === 0) return { kind: 'general', math: false };
  return planFor(lines, checked(lines));
}

/** The person's answer to the consent card. */
export function answerConsentCard(yes: boolean): void {
  const answer = answerConsent;
  answerConsent = null;
  tutorState.set((state) => ({ ...state, consent: null }));
  answer?.(yes);
}

/**
 * Asks before text leaves the device. A yes holds only for the exact text it showed, so every request whose text
 * differs (the next rung, new turns, a typed question) shows its own card first. A no keeps that context (or that
 * typed question) on the device until the panel closes.
 */
function askConsent(context: string, question: string | undefined, host: string, prompt: Prompt): Promise<boolean> {
  const text = `${prompt.system}\n\n${prompt.prompt}`;
  const yesKey = `${host}\u0000${text}`;
  const noKey = question === undefined ? context : `${context}\u0000${question}`;
  if (declined.has(noKey)) return Promise.resolve(false);
  if (granted.has(yesKey)) return Promise.resolve(true);
  answerConsent?.(false);
  return new Promise((resolve) => {
    answerConsent = (yes) => {
      if (yes) granted.add(yesKey);
      else declined.add(noKey);
      resolve(yes);
    };
    tutorState.set((state) => ({ ...state, consent: { text, host } }));
  });
}

async function writers(
  context: string,
  question?: string,
): Promise<{ writers: Writers; offlineNote: boolean; host?: string }> {
  const found: Writers = {};
  let offlineNote = false;
  let host: string | undefined;
  try {
    const cloud = await (await import('../intel')).loadApi();
    const ext = await cloud.intelExt();
    if (isEnabled('intel.cloudKeys')) {
      const state = await cloud.loadCloud();
      if (cloud.usesCloud('tutor', state)) {
        // Work offline wins: nothing is sent, and nothing is asked.
        if (isOffline()) offlineNote = true;
        else {
          const to = cloud.hostOf('tutor', state);
          host = to;
          found.cloud = {
            consent: (prompt) => askConsent(context, question, to, prompt),
            send: (prompt) => ext.cloud.tutor(prompt.system, prompt.prompt),
          };
        }
      }
    }
    const list = await ext.models.list().catch(() => null);
    const downloaded = list?.models.some((one) => one.kind === 'language' && one.state === 'installed') ?? false;
    const info = downloaded ? await ext.engines.info().catch(() => null) : null;
    if (info?.languageModel && info.llmHost)
      found.device = ({ system, prompt }) => ext.llm.generate({ system, prompt, maxTokens: 300, temperature: 0.3 });
  } catch {
    // No shell to ask: the built-in tutor answers.
  }
  return { writers: found, offlineNote, host };
}

function push(turn: ShownTurn): void {
  tutorState.set((state) => ({ ...state, turns: [...state.turns, turn].slice(-60) }));
}

async function run(mode: Mode, rung: Rung, label: string | undefined, question?: string): Promise<void> {
  const state = tutorState.get();
  if (state.busy) return;
  if (state.context.trim() === '') {
    push({ who: 'tutor', text: t('tutor.errors.nothing') });
    announce(t('tutor.errors.nothing'));
    return;
  }
  if (state.context.length > MAX_CONTEXT_CHARS) {
    push({ who: 'tutor', text: t('tutor.errors.tooLong') });
    announce(t('tutor.errors.tooLong'));
    return;
  }
  tutorState.set((one) => ({ ...one, busy: true }));
  try {
    const plan = currentPlan(state);
    const { writers: found, offlineNote, host } = await writers(state.context, question);
    const reply = await tutorReply(
      { mode, rung, plan, context: state.context, question, history: state.turns.slice(-4) },
      found,
    );
    const from = reply.where === 'cloud' ? { host } : {};
    push({ who: 'tutor', text: reply.text, label, where: reply.where, fellBack: reply.fellBack, ...from });
    tutorState.set((one) => ({ ...one, offlineNote }));
    announce(label ? `${label}. ${reply.text}` : reply.text);
  } finally {
    tutorState.set((one) => ({ ...one, busy: false }));
  }
}

/** The next rung of the hint ladder. After the last rung, it says so. */
export async function nextHint(): Promise<void> {
  const state = tutorState.get();
  if (state.rung >= LAST_RUNG) {
    push({ who: 'tutor', text: t('tutor.panel.lastRung') });
    announce(t('tutor.panel.lastRung'));
    return;
  }
  const rung = (state.rung + 1) as Rung;
  tutorState.set((one) => ({ ...one, rung, tried: true }));
  await run('hint', rung, t('tutor.panel.rung', { rung, name: rungName(rung) }));
}

/** Explains the flagged step, without the corrected line. */
export async function explainMistake(): Promise<void> {
  await run('explain', 1, t('tutor.panel.explain'));
}

/** A question the person typed. */
export async function askTutor(question: string): Promise<void> {
  const text = question.trim().slice(0, 1000);
  if (text === '') return;
  push({ who: 'you', text });
  const state = tutorState.get();
  tutorState.set((one) => ({ ...one, tried: true }));
  await run('ask', (state.rung === 0 ? 1 : state.rung) as Rung, undefined, text);
}

/** The full solution: only after the person tried, and only after they confirm. */
export async function showSolution(): Promise<void> {
  if (!tutorState.get().tried) {
    push({ who: 'tutor', text: t('tutor.panel.solutionLocked') });
    announce(t('tutor.panel.solutionLocked'));
    return;
  }
  const yes = await confirm({
    title: t('tutor.solutionConfirm.title'),
    body: t('tutor.solutionConfirm.body'),
    confirmLabel: t('tutor.solutionConfirm.confirm'),
    cancelLabel: t('tutor.solutionConfirm.cancel'),
  });
  if (yes) await run('solution', LAST_RUNG, t('tutor.panel.solution'));
}

/** Ends the session: the conversation, the context, and every consent are forgotten. */
export function endSession(): void {
  answerConsent?.(false);
  answerConsent = null;
  granted.clear();
  declined.clear();
  tutorState.set(EMPTY);
}
