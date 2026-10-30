// The tutor's flag (ADR 0050): on in development, nightly, and Beta builds, and waiting for a hand test with students
// before Stable. The tutor itself stays off on each device until the person turns it on. app/flags.ts joins this list.
import type { FlagDef } from '../../app/flags';

export type TutorFlagId = 'study.tutor';

const ISSUES = 'https://github.com/XrxcGH/OpenNote/issues?q=label%3Aflag%3A';

export const TUTOR_FLAGS: readonly FlagDef[] = [
  {
    id: 'study.tutor',
    description: 'The tutor: graded hints, explanations of flagged steps, and the Tutor panel.',
    issue: `${ISSUES}${encodeURIComponent('study.tutor')}`,
    enabled: { dev: true, nightly: true, beta: true, stable: false },
  },
];
