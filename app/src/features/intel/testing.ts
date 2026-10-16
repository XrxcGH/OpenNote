// Test helpers for the intel feature: a host over the fake transport, with choices that live in memory.
import type { IntelHost } from '../../platform/intel';
import { createFakeIntelTransport } from '../../services/intel';
import type { FakeIntelOptions, FakeIntelTransport, IntelSettings } from '../../services/intel';
import { resetIntelForTests } from './runtime';

export interface TestHost extends IntelHost {
  transport: FakeIntelTransport;
  /** The saves received, in order. */
  saved: Partial<IntelSettings>[];
  /** Makes the next save fail. */
  failNextSave(): void;
}

/** Installs a host whose features start as `options.settings` says, and returns it. */
export function installTestHost(options: FakeIntelOptions = {}): TestHost {
  const transport = createFakeIntelTransport(options);
  let failing = false;
  const current = async (): Promise<IntelSettings> => {
    const status = await transport.invoke('intel_status', {});
    return Object.fromEntries(status.map((one) => [one.feature, one.enabled])) as unknown as IntelSettings;
  };
  const host: TestHost = {
    transport,
    saved: [],
    failNextSave: () => {
      failing = true;
    },
    loadChoices: current,
    async saveChoices(patch) {
      if (failing) {
        failing = false;
        throw new Error('The disk is full.');
      }
      host.saved.push(patch);
      transport.setSettings(patch);
      return current();
    },
  };
  resetIntelForTests(host);
  return host;
}
