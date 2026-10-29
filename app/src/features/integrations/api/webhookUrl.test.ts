import { describe, expect, it } from 'vitest';
import { webhookUrlProblem } from './WebhooksPanel';

describe('webhookUrlProblem', () => {
  it('takes an https address on the internet', () => {
    expect(webhookUrlProblem('https://hooks.zapier.com/x')).toBeNull();
  });

  it('asks for https when the address is not one', () => {
    for (const url of [
      'http://hooks.zapier.com/x',
      'hooks.zapier.com',
      'https://user:pw@hooks.zapier.com/',
      'https://intranet/x',
    ]) {
      expect(webhookUrlProblem(url), url).toBe('badUrl');
    }
  });

  it('says why an address on this PC or network is refused', () => {
    for (const url of [
      'https://127.0.0.1/hook',
      'https://0x7f.0.0.1/hook',
      'https://[::1]/hook',
      'https://localhost/x',
      'https://printer.local/x',
      'https://box.internal/x',
    ]) {
      expect(webhookUrlProblem(url), url).toBe('localUrl');
    }
  });
});
