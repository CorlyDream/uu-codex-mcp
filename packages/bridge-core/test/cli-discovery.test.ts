import { describe, expect, it } from 'vitest';
import { discoverUuInstallation } from '../src/cli/discovery.js';
import { UuError } from '../src/errors.js';

describe('discoverUuInstallation', () => {
  it('prefers UU_CLI_PATH and derives the containing .app bundle', async () => {
    const result = await discoverUuInstallation({
      envPath: '/Applications/UURemote.app/Contents/MacOS/uuyc-cli',
      exists: async () => true,
      listApps: async () => [],
      which: async () => null,
    });
    expect(result).toEqual({
      cliPath: '/Applications/UURemote.app/Contents/MacOS/uuyc-cli',
      appBundlePath: '/Applications/UURemote.app',
    });
  });

  it('scans application directories when env and PATH are empty', async () => {
    const result = await discoverUuInstallation({
      homeDir: '/Users/tester',
      exists: async (path) => path === '/Applications/UURemote.app/Contents/MacOS/uuyc-cli',
      listApps: async (dir) => dir === '/Applications' ? ['/Applications/UURemote.app'] : [],
      which: async () => null,
    });
    expect(result.cliPath).toBe('/Applications/UURemote.app/Contents/MacOS/uuyc-cli');
  });

  it('throws UU_CLI_NOT_FOUND when no installation can be found', async () => {
    let caught: unknown;
    try {
      await discoverUuInstallation({ exists: async () => false, listApps: async () => [], which: async () => null });
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof UuError ? caught.code : null).toBe('UU_CLI_NOT_FOUND');
  });
});
