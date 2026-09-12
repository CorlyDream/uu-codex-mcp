import { access, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { UuError } from '../errors.js';
import { CommandRunner, type CommandRunnerLike } from './runner.js';

export interface UuInstallation {
  cliPath: string;
  appBundlePath: string;
}

export interface DiscoveryOptions {
  envPath?: string;
  homeDir?: string;
  exists?: (path: string) => Promise<boolean>;
  listApps?: (dir: string) => Promise<string[]>;
  which?: () => Promise<string | null>;
  runner?: CommandRunnerLike;
}

async function defaultExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultListApps(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory() && entry.name.endsWith('.app')).map((entry) => join(dir, entry.name));
  } catch {
    return [];
  }
}

/** Walk upward from a CLI binary until its containing application bundle is found. */
export function findContainingApp(cliPath: string): string | null {
  let current = dirname(cliPath);
  for (;;) {
    if (current.endsWith('.app')) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/** Locate the installed UU CLI without assuming a fixed application bundle name. */
export async function discoverUuInstallation(options: DiscoveryOptions = {}): Promise<UuInstallation> {
  const exists = options.exists ?? defaultExists;
  const listApps = options.listApps ?? defaultListApps;
  const runner = options.runner ?? new CommandRunner();
  const which = options.which ?? (async () => {
    const result = await runner.run('/usr/bin/which', ['uuyc-cli'], 5_000);
    const value = result.stdout.trim();
    return result.exitCode === 0 && value ? value : null;
  });
  const envPath = options.envPath ?? process.env.UU_CLI_PATH;

  const candidates: string[] = [];
  if (envPath) candidates.push(envPath);
  const pathCli = await which();
  if (pathCli) candidates.push(pathCli);

  const home = options.homeDir ?? homedir();
  for (const root of ['/Applications', join(home, 'Applications')]) {
    for (const appPath of await listApps(root)) {
      candidates.push(join(appPath, 'Contents', 'MacOS', 'uuyc-cli'));
    }
  }

  for (const cliPath of candidates) {
    if (!(await exists(cliPath))) continue;
    const appBundlePath = findContainingApp(cliPath);
    if (appBundlePath) return { cliPath, appBundlePath };
  }

  throw new UuError('UU_CLI_NOT_FOUND', '未找到 uuyc-cli，请确认已安装并登录 UU 远程。', false);
}
