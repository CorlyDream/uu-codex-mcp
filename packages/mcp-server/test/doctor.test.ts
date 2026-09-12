import { describe, expect, it } from 'vitest';
import { UuError } from '@uu-codex/bridge-core';
import { runDoctor, type DoctorDependencies } from '../src/doctor.js';

function healthyDeps(): DoctorDependencies {
  return {
    discover: async () => ({ cliPath: '/Applications/UURemote.app/Contents/MacOS/uuyc-cli', appBundlePath: '/Applications/UURemote.app' }),
    listDevices: async () => [],
    capabilities: async () => ({ termOpen: true, termPipe: false }),
    helperBinaryPath: () => '/Users/test/.local/share/uu-codex-mcp/bin/uu-desktop-helper',
    pathExists: async () => true,
    helperHealth: async () => ({ status: 'ok', accessibilityTrusted: true }),
    startHelperAndHealth: async () => ({ health: { status: 'ok', accessibilityTrusted: true } }),
  };
}

describe('runDoctor', () => {
  it('reports all read-only capability fields', async () => {
    expect(await runDoctor(healthyDeps())).toEqual({
      cli_found: true,
      app_bundle_found: true,
      device_list_ok: true,
      term_open_supported: true,
      term_pipe_supported: false,
      helper_binary_found: true,
      helper_reachable: true,
      accessibility_trusted: true,
      errors: [],
    });
  });

  it('keeps every field when independent checks fail', async () => {
    const deps = healthyDeps();
    deps.listDevices = async () => { throw new UuError('UU_DEVICE_OFFLINE', 'device list failed', true); };
    deps.helperHealth = async () => { throw new UuError('UU_HELPER_UNAVAILABLE', 'not running', true); };
    deps.pathExists = async () => false;
    const report = await runDoctor(deps);
    expect(report.device_list_ok).toBe(false);
    expect(report.helper_binary_found).toBe(false);
    expect(report.helper_reachable).toBe(false);
    expect(report.accessibility_trusted).toBe(false);
    expect(report.cli_found).toBe(true);
    expect(report.term_open_supported).toBe(true);
    expect(report.errors.length > 0).toBe(true);
  });
});
