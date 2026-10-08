// Google Classroom: the courses the person is in and their assignments. Classroom lets a student attach a file only
// to work that the same app made, so handing in saves the PDF in the person's Drive and gives its link, and the
// person attaches it in Classroom and turns it in there.

import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import { bytesPart } from '../host';
import { agendaText } from '../meetings/text';
import type { Assignment, Course, HandIn, HandInResult, LmsApi, LmsDeps } from './types';

const CLASSROOM = 'https://classroom.googleapis.com/v1';
const MAX_PAGES = 40;

interface Work {
  id: string;
  title?: string;
  description?: string;
  alternateLink?: string;
  state?: string;
  dueDate?: { year: number; month: number; day: number };
  dueTime?: { hours?: number; minutes?: number };
}

interface Submission {
  courseWorkId: string;
  state?: string;
}

async function pages<T>(
  client: ConnectorsClient,
  access: string,
  url: string,
  key: string,
  query: Record<string, string> = {},
): Promise<T[]> {
  const all: T[] = [];
  let token = '';
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const reply = await requestConnector<Record<string, unknown>>(
      'google',
      [access],
      { url, query: { ...query, pageSize: 100, pageToken: token || null } },
      client,
    );
    all.push(...((reply.data?.[key] as T[] | undefined) ?? []));
    token = (reply.data?.nextPageToken as string | undefined) ?? '';
    if (!token) break;
  }
  return all;
}

/** Classroom's due date and time (UTC) as an ISO time, or null. */
export function dueOf(work: Work): string | null {
  const day = work.dueDate;
  if (!day) return null;
  const time = work.dueTime ?? {};
  return new Date(Date.UTC(day.year, day.month - 1, day.day, time.hours ?? 0, time.minutes ?? 0)).toISOString();
}

function webLink(body: string): string {
  try {
    return (JSON.parse(body) as { webViewLink?: string }).webViewLink ?? '';
  } catch {
    return '';
  }
}

export function classroomApi({ client, host }: LmsDeps): LmsApi {
  return {
    service: 'classroom',
    label: 'Google Classroom',
    async courses() {
      const found = await pages<{ id: string; name?: string; section?: string }>(
        client,
        'classroomRead',
        `${CLASSROOM}/courses`,
        'courses',
        { courseStates: 'ACTIVE', studentId: 'me' },
      );
      return found.map((course) => ({
        service: 'classroom' as const,
        id: course.id,
        name: course.section ? `${course.name ?? ''} (${course.section})` : (course.name ?? ''),
      }));
    },
    async assignments(course: Course) {
      const base = `${CLASSROOM}/courses/${encodeURIComponent(course.id)}`;
      const work = await pages<Work>(client, 'classroomRead', `${base}/courseWork`, 'courseWork');
      let handedIn = new Set<string>();
      try {
        const mine = await pages<Submission>(
          client,
          'classroomRead',
          `${base}/courseWork/-/studentSubmissions`,
          'studentSubmissions',
          { userId: 'me' },
        );
        handedIn = new Set(
          mine.filter((one) => one.state === 'TURNED_IN' || one.state === 'RETURNED').map((one) => one.courseWorkId),
        );
      } catch {
        // Without the submissions, nothing is marked as handed in.
      }
      return work
        .filter((one) => one.state === undefined || one.state === 'PUBLISHED')
        .map((one): Assignment => ({
          service: 'classroom',
          courseId: course.id,
          id: one.id,
          title: one.title ?? '',
          due: dueOf(one),
          url: one.alternateLink ?? null,
          text: agendaText(one.description ?? '', false),
          submitted: handedIn.has(one.id),
        }));
    },
    async handIn(_assignment: Assignment, file: HandIn): Promise<HandInResult> {
      const boundary = `opennote${Math.random().toString(36).slice(2)}`;
      const sent = await host.upload(
        'google',
        ['driveFiles'],
        {
          method: 'POST',
          url: 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        },
        [
          {
            kind: 'text',
            text: `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: file.name })}\r\n--${boundary}\r\nContent-Type: ${file.mime}\r\n\r\n`,
          },
          bytesPart(file.bytes),
          { kind: 'text', text: `\r\n--${boundary}--` },
        ],
        `multipart/related; boundary=${boundary}`,
      );
      if (sent.status < 200 || sent.status >= 300) throw new ConnectorHttpError(sent.status, sent.body);
      return { kind: 'saved', link: webLink(sent.body) };
    },
  };
}
