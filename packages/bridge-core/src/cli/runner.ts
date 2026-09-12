import { execFile } from 'node:child_process';

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CommandRunnerLike {
  run(executable: string, args: readonly string[], timeoutMs: number): Promise<CommandResult>;
}

/** Execute a binary directly with an argument vector so user/device data never passes through a shell. */
export class CommandRunner implements CommandRunnerLike {
  run(executable: string, args: readonly string[], timeoutMs: number): Promise<CommandResult> {
    return new Promise((resolve) => {
      execFile(executable, [...args], { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
        const exitCode = typeof error?.code === 'number' ? error.code : error ? 1 : 0;
        resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), exitCode });
      });
    });
  }
}
