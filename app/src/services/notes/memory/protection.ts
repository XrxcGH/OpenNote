// Password-protected sections in the web build's fake (ADR 0042), so the dialogs, the locked pane and the locks can
// be tried in a browser and in Playwright. Nothing here is secret or sealed: the real sealing is the core's. The web
// host in platform/shellqol.ts answers the protect.* calls from this state, and the library marks its summaries.

export interface FakeProtection {
  state: 'locked' | 'unlocked';
  /** The fake's password, kept to check a guess; the web build has no real notes to protect. */
  password: string;
  hello: boolean;
}

export const fakeProtection = new Map<string, FakeProtection>();

type Fail = { code: string; message: string };
const fail = (code: string, message: string): never => {
  throw { code, message } satisfies Fail;
};

function entry(id: string): FakeProtection {
  return fakeProtection.get(id) ?? fail('notProtected', "The section isn't protected.");
}

function newPassword(args: Record<string, unknown>): string {
  const password = typeof args.password === 'string' ? args.password : '';
  return password.length < 8 ? fail('tooShort', 'The password is too short.') : password;
}

/** Answers a protect.* call as the shell would, or returns undefined for any other call. */
export function answerProtect(name: string, args: Record<string, unknown>): unknown {
  if (!name.startsWith('protect.')) return undefined;
  const id = String(args.id ?? '');
  switch (name) {
    case 'protect.status': {
      const found = fakeProtection.get(id);
      return { protection: found?.state ?? 'none', hello: found?.hello ?? false, helloAvailable: false };
    }
    case 'protect.protect':
      if (fakeProtection.has(id)) fail('alreadyProtected', 'The section is already protected.');
      fakeProtection.set(id, { state: 'locked', password: newPassword(args), hello: false });
      return { ok: true };
    case 'protect.unlock': {
      const found = entry(id);
      if (args.hello === true) fail('noHello', "Windows Hello isn't set up for this section.");
      if (args.password !== found.password) fail('wrongPassword', "The password isn't right.");
      found.state = 'unlocked';
      return { ok: true };
    }
    case 'protect.lock':
      entry(id).state = 'locked';
      return { ok: true };
    case 'protect.lockAll':
      fakeProtection.forEach((one) => (one.state = 'locked'));
      return { ok: true, notebooks: 1 };
    case 'protect.unprotect':
      if (entry(id).state === 'locked') fail('locked', 'Unlock the section first.');
      fakeProtection.delete(id);
      return { ok: true };
    case 'protect.changePassword': {
      const found = entry(id);
      if (found.state === 'locked') fail('locked', 'Unlock the section first.');
      found.password = newPassword(args);
      return { ok: true };
    }
    case 'protect.hello':
      return fail('noHello', "Windows Hello isn't available in the browser.");
    default:
      return null;
  }
}
