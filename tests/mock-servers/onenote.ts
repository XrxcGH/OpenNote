// A mock of the OneNote part of Microsoft Graph: notebooks, sections, section groups, the pages of a section (across
// pages of results), a page's HTML, and the pictures it names. It is the same shape as Graph's answers, with the same
// next links, so an importer is tested against what Graph really sends.
import { MockServer } from './server';

export interface MockOnePage {
  id: string;
  title: string;
  modified: string;
  level?: number;
  html: string;
}

export interface MockOneSection {
  id: string;
  name: string;
  pages: MockOnePage[];
}

export interface MockOneGroup {
  id: string;
  name: string;
  sections: MockOneSection[];
  groups?: MockOneGroup[];
}

export interface MockOneNotebook {
  id: string;
  name: string;
  sections: MockOneSection[];
  groups?: MockOneGroup[];
}

const BASE = 'graph.microsoft.com/v1.0/me/onenote';

/** Graph pages its lists with `@odata.nextLink`, which this follows with `$skip`. */
function paged<T>(items: T[], query: Record<string, string>, url: string, size: number) {
  const skip = Number(query.$skip ?? 0) || 0;
  const slice = items.slice(skip, skip + size);
  const more = skip + size < items.length;
  const next = more ? `https://graph.microsoft.com/v1.0${url}?$skip=${skip + size}` : undefined;
  return { value: slice, ...(next ? { '@odata.nextLink': next } : {}) };
}

export function addOneNote(
  server: MockServer,
  notebooks: MockOneNotebook[],
  pictures: Record<string, { type: string; body: string }> = {},
  options: { pageSize?: number } = {},
  // checks-disable-next-line modifiability: one test group that shares its fixtures; split it when it grows again
) {
  const size = options.pageSize ?? 2;
  const sections = new Map<string, MockOneSection>();
  const groups = new Map<string, MockOneGroup>();
  const walk = (list: MockOneSection[], inner: MockOneGroup[] | undefined) => {
    for (const section of list) sections.set(section.id, section);
    for (const group of inner ?? []) {
      groups.set(group.id, group);
      walk(group.sections, group.groups);
    }
  };
  for (const notebook of notebooks) walk(notebook.sections, notebook.groups);
  // Looked up when asked, so a test can add or change a page after the server is made.
  const pages = {
    get: (id: string): MockOnePage | undefined => {
      for (const section of sections.values()) {
        const found = section.pages.find((one) => one.id === id);
        if (found) return found;
      }
      return undefined;
    },
  };

  server.route(`GET ${BASE}/notebooks`, (request) => ({
    json: paged(
      notebooks.map((one) => ({ id: one.id, displayName: one.name })),
      request.query,
      '/me/onenote/notebooks',
      size,
    ),
  }));
  server.route(`GET ${BASE}/notebooks/:id/sections`, (request, params) => {
    const notebook = notebooks.find((one) => one.id === params.id);
    if (!notebook) return undefined;
    return {
      json: paged(
        notebook.sections.map((one) => ({ id: one.id, displayName: one.name })),
        request.query,
        `/me/onenote/notebooks/${params.id}/sections`,
        size,
      ),
    };
  });
  server.route(`GET ${BASE}/notebooks/:id/sectionGroups`, (request, params) => {
    const notebook = notebooks.find((one) => one.id === params.id);
    if (!notebook) return undefined;
    return {
      json: paged(
        (notebook.groups ?? []).map((one) => ({ id: one.id, displayName: one.name })),
        request.query,
        `/me/onenote/notebooks/${params.id}/sectionGroups`,
        size,
      ),
    };
  });
  server.route(`GET ${BASE}/sectionGroups/:id/sections`, (request, params) => {
    const group = groups.get(params.id ?? '');
    if (!group) return undefined;
    return {
      json: paged(
        group.sections.map((one) => ({ id: one.id, displayName: one.name })),
        request.query,
        `/me/onenote/sectionGroups/${params.id}/sections`,
        size,
      ),
    };
  });
  server.route(`GET ${BASE}/sectionGroups/:id/sectionGroups`, (request, params) => {
    const group = groups.get(params.id ?? '');
    if (!group) return undefined;
    return {
      json: paged(
        (group.groups ?? []).map((one) => ({ id: one.id, displayName: one.name })),
        request.query,
        `/me/onenote/sectionGroups/${params.id}/sectionGroups`,
        size,
      ),
    };
  });
  server.route(`GET ${BASE}/sections/:id/pages`, (request, params) => {
    const section = sections.get(params.id ?? '');
    if (!section) return undefined;
    return {
      json: paged(
        section.pages.map((one) => ({
          id: one.id,
          title: one.title,
          lastModifiedDateTime: one.modified,
          level: one.level ?? 0,
        })),
        request.query,
        `/me/onenote/sections/${params.id}/pages`,
        size,
      ),
    };
  });
  server.route(`GET ${BASE}/pages/:id/content`, (_request, params) => {
    const page = pages.get(params.id ?? '');
    return page ? { text: page.html, contentType: 'text/html' } : undefined;
  });
  server.route(`GET ${BASE}/resources/:id/$value`, (_request, params) => {
    const picture = pictures[params.id ?? ''];
    return picture ? { text: picture.body, contentType: picture.type } : undefined;
  });
  return { pages };
}
