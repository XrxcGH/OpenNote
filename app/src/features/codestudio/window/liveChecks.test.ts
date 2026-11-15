// The studio's live checks with a stand-in diagnostics service: each change goes to the service with a new version
// and the project's other files, the newest change of a file wins, and a closed studio publishes nothing.
import { describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '../contracts';
import type { DiagnosticRequest, DiagnosticsService } from '../diagnostics';
import { LiveChecks } from './liveChecks';

function standIn() {
  const updates: DiagnosticRequest[] = [];
  let publish: (file: string, items: Diagnostic[]) => void = () => undefined;
  const service = {
    update: (request: DiagnosticRequest) => updates.push(request),
    close: vi.fn(),
    dispose: vi.fn(),
  } as unknown as DiagnosticsService;
  const load = vi.fn(async (onPublish: typeof publish) => {
    publish = onPublish;
    return service;
  });
  return { updates, service, load, publish: (file: string, items: Diagnostic[]) => publish(file, items) };
}

const mark: Diagnostic = {
  file: 'main.py',
  from: 0,
  to: 1,
  severity: 'error',
  message: 'x',
  source: 'lezer',
  code: 'x',
};

describe('live checks in the studio', () => {
  it('sends each change with a new version, its language, and the other files', async () => {
    const stand = standIn();
    const checks = new LiveChecks(() => undefined, stand.load);
    const files = [
      { path: 'main.py', text: 'print(1)\n' },
      { path: 'util.py', text: 'x = 1\n' },
    ];
    checks.update(files[0]!, files);
    await vi.waitFor(() => expect(stand.updates).toHaveLength(1));
    expect(stand.updates[0]).toEqual({
      file: 'main.py',
      version: 1,
      language: 'python',
      text: 'print(1)\n',
      files: [{ path: 'util.py', text: 'x = 1\n' }],
    });
    checks.update({ path: 'main.py', text: 'print(2)\n' }, files);
    await vi.waitFor(() => expect(stand.updates).toHaveLength(2));
    expect(stand.updates[1]).toMatchObject({ version: 2, text: 'print(2)\n' });
    expect(stand.load).toHaveBeenCalledTimes(1);
  });

  it('checks only the newest of two quick changes to one file', async () => {
    const stand = standIn();
    const checks = new LiveChecks(() => undefined, stand.load);
    checks.update({ path: 'main.lua', text: 'a' }, []);
    checks.update({ path: 'main.lua', text: 'ab' }, []);
    await vi.waitFor(() => expect(stand.updates).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stand.updates.map((request) => [request.version, request.text, request.language])).toEqual([
      [2, 'ab', 'lua'],
    ]);
  });

  it('publishes to the studio until it closes, then lets the service go', async () => {
    const stand = standIn();
    const published: string[] = [];
    const checks = new LiveChecks((file) => published.push(file), stand.load);
    checks.update({ path: 'main.py', text: 'x' }, []);
    await vi.waitFor(() => expect(stand.updates).toHaveLength(1));
    stand.publish('main.py', [mark]);
    checks.close('main.py');
    await vi.waitFor(() => expect(stand.service.close).toHaveBeenCalledWith('main.py'));
    checks.dispose();
    stand.publish('main.py', [mark]);
    expect(published).toEqual(['main.py']);
    await vi.waitFor(() => expect(stand.service.dispose).toHaveBeenCalledTimes(1));
  });
});
