// The courses and assignments of a school's learning system, in one shape for Canvas, Moodle, and Classroom.

import type { ConnectorsClient } from '../../connectors';
import type { AccountsHost } from '../host';

export type LmsService = 'canvas' | 'moodle' | 'classroom';

export interface Course {
  service: LmsService;
  id: string;
  name: string;
}

export interface Assignment {
  service: LmsService;
  courseId: string;
  id: string;
  title: string;
  /** When it is due, as an ISO time in UTC, or null. */
  due: string | null;
  /** Where the assignment is on the web, or null. */
  url: string | null;
  /** The instructions as plain text. */
  text: string;
  /** Whether the person has already handed it in. */
  submitted: boolean;
}

/** A file to hand in. */
export interface HandIn {
  name: string;
  mime: string;
  bytes: Uint8Array;
}

/** What handing in did: the work is in, or it is saved where the person finishes it. */
export type HandInResult = { kind: 'submitted' } | { kind: 'saved'; link: string };

export interface LmsDeps {
  client: ConnectorsClient;
  host: AccountsHost;
}

export interface LmsApi {
  readonly service: LmsService;
  /** The name shown in sentences. */
  readonly label: string;
  courses(): Promise<Course[]>;
  assignments(course: Course): Promise<Assignment[]>;
  handIn(assignment: Assignment, file: HandIn): Promise<HandInResult>;
}

export const SERVICE_LABEL: Record<LmsService, string> = {
  canvas: 'Canvas',
  moodle: 'Moodle',
  classroom: 'Google Classroom',
};

/** The connector that holds the sign-in for each service. */
export const CONNECTOR_OF: Record<LmsService, string> = { canvas: 'canvas', moodle: 'moodle', classroom: 'google' };
