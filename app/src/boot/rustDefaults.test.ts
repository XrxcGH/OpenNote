import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../state/settings';
import { DEFAULT_DEVICE_STATE } from './defaults';
import { RUST_DEVICE_STATE_DEFAULTS, RUST_SETTINGS_DEFAULTS } from './rustDefaults';

// Rust writes the JSON files from Settings::default() and DeviceState::default() in cargo test (ARCHITECTURE.md
// section 16.7), so these tests fail when the interface's defaults and Rust's disagree.
describe("the interface's defaults", () => {
  it('match the settings Rust starts from', () => {
    expect(DEFAULT_SETTINGS).toEqual(RUST_SETTINGS_DEFAULTS);
  });

  it('match the device state Rust starts from, except that a browser skips setup', () => {
    const { setup, ...rest } = DEFAULT_DEVICE_STATE;
    const { setup: rustSetup, ...rustRest } = RUST_DEVICE_STATE_DEFAULTS;
    expect(rest).toEqual(rustRest);
    expect({ ...setup, status: 'notStarted' }).toEqual(rustSetup);
  });
});
