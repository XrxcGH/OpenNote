// Rust's defaults for settings and device state, as `cargo test` exports them next to the generated types
// (ARCHITECTURE.md section 6.2). CI fails when the files drift from Rust, so the groups the interface doesn't
// spell out itself (editing for Phase 4, ink for Phase 5) take their defaults from here. A test compares the
// interface's own defaults with the same files.

import deviceStateDefaults from '../platform/bindings/device-state-default.json';
import settingsDefaults from '../platform/bindings/settings-default.json';
import type { DeviceState, Settings } from '../platform/types';

export const RUST_SETTINGS_DEFAULTS = settingsDefaults as Settings;
export const RUST_DEVICE_STATE_DEFAULTS = deviceStateDefaults as DeviceState;
