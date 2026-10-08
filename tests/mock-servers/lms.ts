// Mocks of Canvas, Moodle, and Google Classroom: courses, assignments, and the way each takes a file. Canvas pages with
// `page` and `per_page` and takes a file in three steps (a slot, the bytes at another address, then the submission).
// Moodle answers every call at one address and reports a refusal inside a 200. Classroom pages with a token.
import type { MockServer } from './server';

export interface LmsCourse {
  id: number;
  name: string;
  assignments: LmsAssignment[];
}

export interface LmsAssignment {
  id: number;
  name: string;
  /** ISO time in UTC. */
  due?: string;
  description?: string;
  submitted?: boolean;
}

export function addCanvas(server: MockServer, host: string, courses: LmsCourse[]) {
  const submissions: { course: string; assignment: string; fileId: string }[] = [];
  const uploads: { fields: string[]; fileName: string; bytes: number; token: boolean }[] = [];
  const slots = new Map<string, { name: string; size: number }>();
  const page = (list: unknown[], query: Record<string, string>) => {
    const at = Number(query.page ?? 1);
    const size = Math.min(Number(query.per_page ?? 10), 100);
    return list.slice((at - 1) * size, at * size);
  };
  server.route(`GET ${host}/api/v1/courses`, (request) => ({
    json: page(
      courses.map((course) => ({ id: course.id, name: course.name })),
      request.query,
    ),
  }));
  server.route(`GET ${host}/api/v1/courses/:course/assignments`, (request, params) => {
    const course = courses.find((one) => String(one.id) === params.course);
    if (!course) return undefined;
    return {
      json: page(
        course.assignments.map((one) => ({
          id: one.id,
          name: one.name,
          due_at: one.due ?? null,
          html_url: `https://${host}/courses/${course.id}/assignments/${one.id}`,
          description: one.description ?? '',
          submission: { workflow_state: one.submitted ? 'submitted' : 'unsubmitted' },
        })),
        request.query,
      ),
    };
  });
  server.route(
    `POST ${host}/api/v1/courses/:course/assignments/:assignment/submissions/self/files`,
    (request, params) => {
      const id = `up${slots.size + 1}`;
      slots.set(id, { name: request.form.name ?? '', size: Number(request.form.size ?? 0) });
      return {
        json: {
          upload_url: `https://files.canvas-storage.example/upload/${id}?course=${params.course}`,
          upload_params: { filename: request.form.name, content_type: request.form.content_type, key: 'abc' },
        },
      };
    },
  );
  server.route('POST files.canvas-storage.example/upload/:id', (request, params) => {
    const slot = slots.get(params.id ?? '');
    if (!slot) return undefined;
    const fields = [...request.body.matchAll(/; name="([^"]+)"/g)].map((match) => match[1] ?? '');
    const fileName = /filename="([^"]+)"/.exec(request.body)?.[1] ?? '';
    uploads.push({ fields, fileName, bytes: slot.size, token: Boolean(request.headers.authorization) });
    // Canvas storage answers with a redirect that the app confirms.
    return { status: 303, location: `https://${host}/api/v1/files/${params.id}/confirm` };
  });
  server.route(`GET ${host}/api/v1/files/:id/confirm`, (_request, params) => ({
    status: 201,
    json: { id: 700 + Number(params.id?.replace('up', '')) },
  }));
  server.route(`POST ${host}/api/v1/courses/:course/assignments/:assignment/submissions`, (request, params) => {
    const fileId = request.form['submission[file_ids][]'] ?? '';
    if (request.form['submission[submission_type]'] !== 'online_upload' || !fileId) {
      return { status: 400, json: { message: 'Bad submission.' } };
    }
    submissions.push({ course: params.course ?? '', assignment: params.assignment ?? '', fileId });
    return { status: 201, json: { workflow_state: 'submitted' } };
  });
  return { submissions, uploads };
}

export function addMoodle(
  server: MockServer,
  host: string,
  courses: LmsCourse[],
  options: { badToken?: boolean } = {},
) {
  const calls: { fn: string; fields: Record<string, string> }[] = [];
  const submitted = new Set<string>();
  server.route(`POST ${host}/webservice/rest/server.php`, (request) => {
    const fn = request.form.wsfunction ?? '';
    calls.push({ fn, fields: { ...request.form } });
    if (options.badToken) {
      return {
        json: { exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token - token not found' },
      };
    }
    if (fn === 'core_webservice_get_site_info') return { json: { userid: 5, fullname: 'Sam Student' } };
    if (fn === 'core_enrol_get_users_courses') {
      return { json: courses.map((course) => ({ id: course.id, fullname: course.name, shortname: `c${course.id}` })) };
    }
    if (fn === 'mod_assign_get_assignments') {
      const found = courses.find((one) => String(one.id) === request.form['courseids[0]']);
      return {
        json: {
          courses: found
            ? [
                {
                  id: found.id,
                  assignments: found.assignments.map((one) => ({
                    id: one.id,
                    cmid: one.id + 1000,
                    name: one.name,
                    duedate: one.due ? Math.floor(Date.parse(one.due) / 1000) : 0,
                    intro: one.description ?? '',
                  })),
                },
              ]
            : [],
        },
      };
    }
    if (fn === 'mod_assign_get_submission_status') {
      const done =
        submitted.has(request.form.assignid ?? '') ||
        courses.some((c) => c.assignments.some((a) => String(a.id) === request.form.assignid && a.submitted));
      return { json: { lastattempt: { submission: { status: done ? 'submitted' : 'new' } } } };
    }
    if (fn === 'core_files_upload') return { json: { itemid: 4242, filename: request.form.filename } };
    if (fn === 'mod_assign_save_submission') {
      return request.form['plugindata[files_filemanager]'] === '4242'
        ? { json: [] }
        : { json: { exception: 'x', message: 'No file.' } };
    }
    if (fn === 'mod_assign_submit_for_grading') {
      submitted.add(request.form.assignmentid ?? '');
      return { json: [] };
    }
    return { json: { exception: 'dml_missing_record_exception', message: `No function ${fn}.` } };
  });
  return { calls, submitted };
}

export function addClassroom(server: MockServer, courses: LmsCourse[]) {
  const driveFiles: { name: string; type: string }[] = [];
  server.route('GET classroom.googleapis.com/v1/courses', () => ({
    json: { courses: courses.map((course) => ({ id: String(course.id), name: course.name, section: 'Period 2' })) },
  }));
  server.route('GET classroom.googleapis.com/v1/courses/:course/courseWork', (request, params) => {
    const course = courses.find((one) => String(one.id) === params.course);
    if (!course) return undefined;
    const start = Number(request.query.pageToken ?? 0) || 0;
    const slice = course.assignments.slice(start, start + 2);
    return {
      json: {
        courseWork: slice.map((one) => {
          const due = one.due ? new Date(one.due) : null;
          return {
            id: String(one.id),
            title: one.name,
            description: one.description,
            state: 'PUBLISHED',
            alternateLink: `https://classroom.google.com/c/${course.id}/a/${one.id}`,
            ...(due
              ? {
                  dueDate: { year: due.getUTCFullYear(), month: due.getUTCMonth() + 1, day: due.getUTCDate() },
                  dueTime: { hours: due.getUTCHours(), minutes: due.getUTCMinutes() },
                }
              : {}),
          };
        }),
        ...(start + 2 < course.assignments.length ? { nextPageToken: String(start + 2) } : {}),
      },
    };
  });
  server.route(
    'GET classroom.googleapis.com/v1/courses/:course/courseWork/-/studentSubmissions',
    (_request, params) => {
      const course = courses.find((one) => String(one.id) === params.course);
      return {
        json: {
          studentSubmissions: (course?.assignments ?? [])
            .filter((one) => one.submitted)
            .map((one) => ({ courseWorkId: String(one.id), state: 'TURNED_IN' })),
        },
      };
    },
  );
  server.route('POST www.googleapis.com/upload/drive/v3/files', (request) => {
    const name = /"name":"([^"]+)"/.exec(request.body)?.[1] ?? '';
    driveFiles.push({ name, type: request.contentType });
    return { json: { id: 'drive1', webViewLink: 'https://drive.google.com/file/d/drive1/view' } };
  });
  return { driveFiles };
}
