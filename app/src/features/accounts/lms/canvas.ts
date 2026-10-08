// Canvas: the courses the person is in, their assignments, and handing in a file. The person's token is the host's.
// Canvas pages its lists with a Link header, which the interface does not see, so each list asks for a page number
// until a page comes back short.

import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import { bytesPart } from '../host';
import { agendaText } from '../meetings/text';
import type { Assignment, Course, HandIn, HandInResult, LmsApi, LmsDeps } from './types';

const PAGE = 50;
const MAX_PAGES = 40;

/** The school's address the person connected with. */
export async function schoolAddress(client: ConnectorsClient, connector: string): Promise<string> {
  const info = (await client.list()).find((item) => item.id === connector);
  if (!info?.baseUrl) throw new ConnectorHttpError(400, JSON.stringify({ message: 'The school address is missing.' }));
  return info.baseUrl.replace(/\/+$/, '');
}

interface CanvasCourse {
  id: number;
  name?: string;
  course_code?: string;
}

interface CanvasAssignment {
  id: number;
  name?: string;
  due_at?: string | null;
  html_url?: string;
  description?: string | null;
  submission?: { workflow_state?: string; submitted_at?: string | null } | null;
}

async function listPages<T>(
  client: ConnectorsClient,
  access: string,
  url: string,
  query: Record<string, string>,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const reply = await requestConnector<T[]>(
      'canvas',
      [access],
      { url, query: { ...query, per_page: PAGE, page } },
      client,
    );
    const items = Array.isArray(reply.data) ? reply.data : [];
    all.push(...items);
    if (items.length < PAGE) break;
  }
  return all;
}

export function canvasApi({ client, host }: LmsDeps): LmsApi {
  return {
    service: 'canvas',
    label: 'Canvas',
    async courses() {
      const base = await schoolAddress(client, 'canvas');
      const found = await listPages<CanvasCourse>(client, 'canvasRead', `${base}/api/v1/courses`, {
        enrollment_state: 'active',
      });
      return found
        .filter((course) => course.name)
        .map((course) => ({ service: 'canvas' as const, id: String(course.id), name: course.name ?? '' }));
    },
    async assignments(course: Course) {
      const base = await schoolAddress(client, 'canvas');
      const found = await listPages<CanvasAssignment>(
        client,
        'canvasRead',
        `${base}/api/v1/courses/${encodeURIComponent(course.id)}/assignments`,
        { 'include[]': 'submission', order_by: 'due_at' },
      );
      return found.map((one): Assignment => ({
        service: 'canvas',
        courseId: course.id,
        id: String(one.id),
        title: one.name ?? '',
        due: one.due_at ?? null,
        url: one.html_url ?? null,
        text: agendaText(one.description ?? '', true),
        submitted: ['submitted', 'graded', 'pending_review'].includes(one.submission?.workflow_state ?? ''),
      }));
    },
    async handIn(assignment: Assignment, file: HandIn): Promise<HandInResult> {
      const base = await schoolAddress(client, 'canvas');
      const root = `${base}/api/v1/courses/${encodeURIComponent(assignment.courseId)}/assignments/${encodeURIComponent(assignment.id)}`;
      // 1. Canvas says where the file goes.
      const slot = (
        await requestConnector<{ upload_url?: string; upload_params?: Record<string, string> }>(
          'canvas',
          ['canvasSubmit'],
          {
            url: `${root}/submissions/self/files`,
            form: { name: file.name, size: String(file.bytes.length), content_type: file.mime },
          },
          client,
        )
      ).data;
      if (!slot?.upload_url) throw new ConnectorHttpError(502, '');
      // 2. The file goes to that address, as a form with the fields Canvas listed and the file last.
      const boundary = `----opennote${Math.random().toString(36).slice(2)}`;
      const parts = Object.entries(slot.upload_params ?? {}).map(
        ([name, value]) =>
          ({
            kind: 'text',
            text: `--${boundary}\r\nContent-Disposition: form-data; name="${name.replace(/"/g, '')}"\r\n\r\n${value}\r\n`,
          }) as const,
      );
      const upload = await host.uploadPublic(
        'canvas',
        slot.upload_url,
        [
          ...parts,
          {
            kind: 'text',
            text: `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name.replace(/"/g, '')}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
          },
          bytesPart(file.bytes),
          { kind: 'text', text: `\r\n--${boundary}--\r\n` },
        ],
        `multipart/form-data; boundary=${boundary}`,
      );
      // Canvas answers with the file, or with a redirect that the app confirms with the token.
      let uploaded: { id?: number } | undefined;
      if (upload.status >= 300 && upload.status < 400 && upload.location) {
        uploaded = (
          await requestConnector<{ id?: number }>('canvas', ['canvasSubmit'], { url: upload.location }, client)
        ).data;
      } else if (upload.status >= 200 && upload.status < 300) {
        try {
          uploaded = JSON.parse(upload.body) as { id?: number };
        } catch {
          uploaded = undefined;
        }
      } else throw new ConnectorHttpError(upload.status, upload.body);
      if (!uploaded?.id) throw new ConnectorHttpError(502, '');
      // 3. The file is handed in.
      await requestConnector(
        'canvas',
        ['canvasSubmit'],
        {
          url: `${root}/submissions`,
          form: { 'submission[submission_type]': 'online_upload', 'submission[file_ids][]': String(uploaded.id) },
        },
        client,
      );
      return { kind: 'submitted' };
    },
  };
}
