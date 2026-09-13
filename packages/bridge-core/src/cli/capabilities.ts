import type { CommandRunnerLike } from './runner.js';

export interface CliCapabilities {
  termPipe: boolean;
  termOpen: boolean;
  termExit: boolean;
  termExitClear: boolean;
}

/** Parse help text conservatively: unknown or incomplete capabilities are always false. */
export function parseCapabilities(termHelp: string, openHelp: string, exitHelp: string): CliCapabilities {
  const pipeMarkers = ['--device-id', '--new-session', '--shell', '--list-sessions'];
  const termPipe = pipeMarkers.every((marker) => termHelp.includes(marker));
  const termOpen = /(?:^|\s)open(?:\s|\[|<|$)/im.test(termHelp) || /\bterm\s+open\b|\bopen\s*\[/im.test(openHelp);
  const termExit = /(?:^|\s)exit(?:\s|\[|<|$)/im.test(termHelp) || /\bterm\s+exit\b|\bexit\s*\[/im.test(exitHelp);
  return { termPipe, termOpen, termExit, termExitClear: termExit && exitHelp.includes('--clear') };
}

/** Probe each terminal help surface independently; stderr remains useful when the CLI exits non-zero. */
export async function probeCliCapabilities(cliPath: string, runner: CommandRunnerLike): Promise<CliCapabilities> {
  const [term, open, exit] = await Promise.all([
    runner.run(cliPath, ['term', '--help'], 5_000),
    runner.run(cliPath, ['term', 'open', '--help'], 5_000),
    runner.run(cliPath, ['term', 'exit', '--help'], 5_000),
  ]);
  return parseCapabilities(`${term.stdout}\n${term.stderr}`, `${open.stdout}\n${open.stderr}`, `${exit.stdout}\n${exit.stderr}`);
}
