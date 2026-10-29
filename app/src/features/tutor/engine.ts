// Who writes the tutor's reply (ADR 0050). The rules tutor (ladder.ts) always can. A language model on this device
// writes its own wording when one is downloaded, and the person's own key for a cloud service may be used when they
// chose it, said yes to the exact text of that request, and Work offline is off. A model's reply is checked before
// it is shown: empty or overlong replies are refused, and a hint that gives away the answer or the next line is asked
// for once more (on this device only), then replaced with the built-in hint. The full solution of math always comes
// from the rules, which work it out exactly; a model writes one only for questions the rules cannot solve.
import { claimsAnswer, leaks } from './guard';
import { LAST_RUNG, guardedRuleHint, ruleExplain, ruleSolution, secrets, type Plan, type Rung } from './ladder';
import { t } from '../../strings/t';

export type Where = 'rules' | 'device' | 'cloud';
export type Mode = 'hint' | 'explain' | 'solution' | 'ask';

export interface Turn {
  who: 'you' | 'tutor';
  text: string;
}

export interface TutorRequest {
  mode: Mode;
  /** The hint rung, for mode 'hint' (and the rung an 'ask' builds on). */
  rung: Rung;
  plan: Plan;
  /** Exactly the text the person showed the tutor. */
  context: string;
  /** What the person typed, for mode 'ask'. */
  question?: string;
  /** The last turns of the conversation, already on screen. */
  history?: readonly Turn[];
}

export interface Prompt {
  system: string;
  prompt: string;
}

export interface Reply {
  text: string;
  where: Where;
  /** A model was asked but could not help, so the built-in reply is shown. */
  fellBack: boolean;
}

export interface Writers {
  /** The language model on this device. */
  device?: (prompt: Prompt) => Promise<string>;
  /** The person's own key: `consent` shows the exact text and resolves true only when they agree. */
  cloud?: { send: (prompt: Prompt) => Promise<string>; consent: (prompt: Prompt) => Promise<boolean> };
}

/** The most characters of context the tutor reads. */
export const MAX_CONTEXT_CHARS = 6000;
/** The longest reply shown, except for a full solution. */
const MAX_REPLY_CHARS = 700;
const MAX_SOLUTION_CHARS = 4000;
const HISTORY_TURNS = 4;

const SYSTEM =
  'You are a patient, encouraging tutor for a student. Use short, plain words and no jargon. ' +
  'Reply in at most three short sentences. Write math in plain text, such as x^3/3 or sqrt(x), with no LaTeX. ' +
  'Never give the final answer unless asked for the full solution.';

const TASK: Record<Mode | `hint${Rung}`, string> = {
  hint1: 'Give hint 1 of 4: say only where to look. Do not say what is wrong or how to fix it.',
  hint2: 'Give hint 2 of 4: name the idea or rule involved, in plain words. Do not do the step.',
  hint3: 'Give hint 3 of 4: ask one question that leads to the next step. Do not do the step.',
  hint4: 'Give hint 4 of 4: show only the next step. Do not give the final answer.',
  hint: '',
  explain: 'Explain kindly what went wrong in the step and the rule involved. Do not give the corrected line.',
  solution: 'Write the full worked solution, one short step per line, ending with the answer.',
  ask: "Answer the student's question as a tutor: guide with a hint or a question, and leave the answer to them.",
};

/** The built-in reply, with the answer guard applied to every hint. */
export function rulesReply(request: TutorRequest): string {
  const { plan, rung, context } = request;
  if (request.mode === 'explain') return ruleExplain(plan);
  if (request.mode === 'solution') {
    const lines = ruleSolution(plan);
    if (!lines)
      return t(plan.kind === 'general' && !plan.math ? 'tutor.general.noSolution' : 'tutor.solution.noSolution');
    return `${t('tutor.solution.lead')}\n${lines.join('\n')}`;
  }
  const hint = guardedRuleHint(plan, rung, context);
  return request.mode === 'ask' ? `${t('tutor.ask.rules')} ${hint}` : hint;
}

/** Exactly what a model is sent: the person sees this text before anything goes to a cloud service. */
export function buildPrompt(request: TutorRequest): Prompt {
  const task = request.mode === 'hint' ? TASK[`hint${request.rung}`] : TASK[request.mode];
  const parts = [`The student's text:\n<text>\n${request.context.slice(0, MAX_CONTEXT_CHARS)}\n</text>`];
  if (request.mode !== 'solution') parts.push(`A built-in hint to build on: ${rulesReply(request)}`);
  const history = (request.history ?? []).slice(-HISTORY_TURNS);
  if (history.length > 0)
    parts.push(
      `The conversation so far:\n${history.map((turn) => `${turn.who === 'you' ? 'Student' : 'Tutor'}: ${turn.text}`).join('\n')}`,
    );
  if (request.mode === 'ask' && request.question) parts.push(`The student asks: ${request.question}`);
  parts.push(task);
  return { system: SYSTEM, prompt: parts.join('\n\n') };
}

/** A model's reply without the wrapping models like to add. */
export function cleanReply(raw: string): string {
  let text = raw.trim();
  const fenced = /^```[a-z]*\n([\s\S]*?)\n?```$/.exec(text);
  if (fenced) text = (fenced[1] ?? '').trim();
  return text.replace(/^<text>\s*|\s*<\/text>$/gi, '').trim();
}

/** Whether a model's reply may be shown for this request. */
export function acceptable(request: TutorRequest, reply: string): boolean {
  const most = request.mode === 'solution' ? MAX_SOLUTION_CHARS : MAX_REPLY_CHARS;
  if (reply === '' || reply.length > most) return false;
  if (request.mode === 'solution') return true;
  const lastRung = request.mode === 'hint' && request.rung === LAST_RUNG;
  const { answer, next } = secrets(request.plan);
  // No known answer (chemistry, physics, word problems, or a slip in math the rules cannot finish, such as a
  // quadratic): before the last rung, a stated result is refused, even when the corrected line is known.
  if (answer === null && !lastRung && claimsAnswer(reply, request.context)) return false;
  return !leaks(reply, lastRung ? [answer] : [answer, next], request.context);
}

const STRICTER =
  ' Your last reply gave away too much. Do not state the answer, the corrected line, or any final value.';

/** The reply from the best writer the person allows, falling back to the built-in tutor. Never throws. */
export async function tutorReply(request: TutorRequest, writers: Writers): Promise<Reply> {
  const builtIn = (fellBack: boolean): Reply => ({ text: rulesReply(request), where: 'rules', fellBack });
  // Math with a known solution: the exact working, not a model's version of it.
  if (request.mode === 'solution' && ruleSolution(request.plan)) return builtIn(false);
  const prompt = buildPrompt(request);
  if (writers.cloud) {
    try {
      if (await writers.cloud.consent(prompt)) {
        const reply = cleanReply(await writers.cloud.send(prompt));
        // The person agreed to this exact text, so a second, different request is not sent: the built-in hint shows.
        return acceptable(request, reply) ? { text: reply, where: 'cloud', fellBack: false } : builtIn(true);
      }
    } catch {
      return builtIn(true);
    }
  }
  if (writers.device) {
    try {
      let reply = cleanReply(await writers.device(prompt));
      if (!acceptable(request, reply))
        reply = cleanReply(await writers.device({ ...prompt, prompt: prompt.prompt + STRICTER }));
      return acceptable(request, reply) ? { text: reply, where: 'device', fellBack: false } : builtIn(true);
    } catch {
      return builtIn(true);
    }
  }
  return builtIn(false);
}
