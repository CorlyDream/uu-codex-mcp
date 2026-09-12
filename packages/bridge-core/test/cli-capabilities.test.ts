import { describe, expect, it } from 'vitest';
import { UuCliAdapter } from '../src/cli/adapter.js';
import { parseCapabilities } from '../src/cli/capabilities.js';
import type { CommandRunnerLike } from '../src/cli/runner.js';

describe('parseCapabilities', () => {
  it('detects the programmable pipe terminal shape', () => {
    const pipeHelp = `Usage: uuyc-cli term [options]\n--device-id <id>\n--new-session\n--shell <shell>\n--list-sessions`;
    expect(parseCapabilities(pipeHelp, '', '')).toMatchObject({ termPipe: true });
  });

  it('detects legacy open/exit without inventing pipe support', () => {
    const legacyHelp = `Usage: uuyc-cli term <command>\nCommands:\n  open [device-id]\n  exit [device-id]`;
    expect(parseCapabilities(legacyHelp, 'Usage: term open [device-id]', 'Usage: term exit [device-id]')).toMatchObject({
      termPipe: false,
      termOpen: true,
      termExit: true,
      termExitClear: false,
    });
  });

  it('detects --clear only from exit help', () => {
    expect(parseCapabilities('open exit', 'open [device-id] --clear', 'exit [device-id] --clear').termExitClear).toBe(true);
  });
});


describe('UuCliAdapter terminal commands', () => {
  it('appends --clear only when exit help advertises it', async () => {
    const calls: string[][] = [];
    const runner: CommandRunnerLike = {
      async run(_exe, args) {
        calls.push([...args]);
        const joined = args.join(' ');
        if (joined === 'term --help') return { stdout: 'open exit', stderr: '', exitCode: 0 };
        if (joined === 'term open --help') return { stdout: 'term open [device-id]', stderr: '', exitCode: 0 };
        if (joined === 'term exit --help') return { stdout: 'term exit [device-id] --clear', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 0 };
      },
    };
    const adapter = new UuCliAdapter('/fake/uuyc-cli', runner);
    await adapter.closeTerminal('dev-1');
    expect(calls.at(-1)).toEqual(['term', 'exit', 'dev-1', '--clear']);
  });
});
