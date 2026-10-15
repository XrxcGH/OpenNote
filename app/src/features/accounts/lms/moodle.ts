// Moodle: the courses the person is in, their assignments, and handing in a file, all through the school's web service.
// Every call is a form posted to one address; Moodle answers 200 even when it refuses, with an exception in the body.
// The token is the host's (Moodle takes it as a form field, which the connector adds).

import { ConnectorHttpError, requestConnector } from '../../connectors';
import type { ConnectorsClient } from '../../connectors';
import { base64Of } from '../host';
import { agendaText } from '../meetings/text';
import { schoolAddress } from './canvas';
import type { Assignment, Course, HandIn, HandInResult, LmsApi, LmsDeps } from './types';

/** How many assignments get their hand-in status asked for. */
const STATUS_LIMIT = 60;

async function moodleCall<T>(
  client: ConnectorsClient,
  access: string,
  base: string,
  fn: string,
  fields: Record<string, string> = {},
): Promise<T> {
  const reply = await requestConnector<T & { exception?: string; message?: string; errorcode?: string }>(
    'moodle',
    [access],
    { url: `${base}/webservice/rest/server.php`, form: { wsfunction: fn, moodlewsrestformat: 'json', ...fields } },
    client,
  );
  const data = reply.data;
  if (data && typeof data === 'object' && !Array.isArray(data) && 'exception' in data && data.exception) {
    throw new ConnectorHttpError(
      data.errorcode === 'invalidtoken' ? 401 : 400,
      JSON.stringify({ message: data.message }),
    );
  }
  return data as T;
}

interface MoodleAssignment {
  id: number;
  cmid?: number;
  name: string;
  duedate?: number;
  intro?: string;
}

export function moodleApi({ client }: LmsDeps): LmsApi {
  const userId = async (base: string): Promise<number> =>
    (await moodleCall<{ userid: number }>(client, 'moodleRead', base, 'core_webservice_get_site_info')).userid;
  return {
    service: 'moodle',
    label: 'Moodle',
    async courses() {
      const base = await schoolAddress(client, 'moodle');
      const list = await moodleCall<{ id: number; fullname?: string; shortname?: string }[]>(
        client,
        'moodleRead',
        base,
        'core_enrol_get_users_courses',
        { userid: String(await userId(base)) },
      );
      return (Array.isArray(list) ? list : []).map((course) => ({
        service: 'moodle' as const,
        id: String(course.id),
        name: course.fullname || course.shortname || '',
      }));
    },
    async assignments(course: Course) {
      const base = await schoolAddress(client, 'moodle');
      const answer = await moodleCall<{ courses?: { id: number; assignments?: MoodleAssignment[] }[] }>(
        client,
        'moodleRead',
        base,
        'mod_assign_get_assignments',
        { 'courseids[0]': course.id },
      );
      const found = (answer.courses ?? []).flatMap((one) => one.assignments ?? []);
      const result: Assignment[] = [];
      for (const [at, one] of found.entries()) {
        let submitted = false;
        if (at < STATUS_LIMIT) {
          try {
            const status = await moodleCall<{ lastattempt?: { submission?: { status?: string } } }>(
              client,
              'moodleRead',
              base,
              'mod_assign_get_submission_status',
              { assignid: String(one.id) },
            );
            submitted = status.lastattempt?.submission?.status === 'submitted';
          } catch {
            // The status is a convenience; an assignment without it is shown as not handed in.
          }
        }
        result.push({
          service: 'moodle',
          courseId: course.id,
          id: String(one.id),
          title: one.name,
          due: one.duedate ? new Date(one.duedate * 1000).toISOString() : null,
          url: one.cmid ? `${base}/mod/assign/view.php?id=${one.cmid}` : null,
          text: agendaText(one.intro ?? '', true),
          submitted,
        });
      }
      return result;
    },
    async handIn(assignment: Assignment, file: HandIn): Promise<HandInResult> {
      const base = await schoolAddress(client, 'moodle');
      const user = await userId(base);
      // The file goes to the person's draft area first (as base64 in the call), then into the submission.
      const draft = await moodleCall<{ itemid?: number }>(client, 'moodleSubmit', base, 'core_files_upload', {
        component: 'user',
        filearea: 'draft',
        itemid: '0',
        filepath: '/',
        filename: file.name,
        filecontent: base64Of(file.bytes),
        contextlevel: 'user',
        instanceid: String(user),
      });
      if (draft.itemid === undefined) throw new ConnectorHttpError(502, '');
      await moodleCall(client, 'moodleSubmit', base, 'mod_assign_save_submission', {
        assignmentid: assignment.id,
        'plugindata[files_filemanager]': String(draft.itemid),
      });
      await moodleCall(client, 'moodleSubmit', base, 'mod_assign_submit_for_grading', {
        assignmentid: assignment.id,
        acceptsubmissionstatement: '1',
      });
      return { kind: 'submitted' };
    },
  };
}
