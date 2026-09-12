import { spawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { UuError } from '../errors.js';
import type { Logger } from '../logger.js';
import { StderrLogger } from '../logger.js';
import { DesktopHelperClient } from './client.js';

export interface EnsureHelperOptions {
  binaryPath?: string;
  socketPath?: string;
  logger?: Logger;
}

/** Resolve the stable installed helper path; an explicit environment override wins. */
export function desktopHelperBinaryPath(): string {
  return process.env.UU_DESKTOP_HELPER_PATH ?? join(homedir(), '.local', 'share', 'uu-codex-mcp', 'bin', 'uu-desktop-helper');
}

/** Ensure a helper is healthy, starting a child owned by the MCP process only when needed. */
export async function ensureDesktopHelper(client: DesktopHelperClient, options: EnsureHelperOptions = {}): Promise<ChildProcess | null> {
  try {
    await client.health();
    return null;
  } catch (error) {
    if (!(error instanceof UuError) || error.code !== 'UU_HELPER_UNAVAILABLE') throw error;
  }

  const logger = options.logger ?? new StderrLogger();
  const binaryPath = options.binaryPath ?? desktopHelperBinaryPath();
  const socketPath = options.socketPath ?? client.socketPath;
  if (socketPath !== client.socketPath) {
    throw new UuError('UU_INVALID_ARGUMENT', 'Desktop Helper 启动 socket 必须与客户端 socket 一致。', false);
  }
  const child = spawn(binaryPath, ['--socket', socketPath], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
  let spawnError: Error | null = null;
  child.once('error', (error: Error) => {
    spawnError = error;
    logger.error('helper.spawn_failed', { binaryPath });
  });
  child.stdout?.on('data', (chunk: Buffer) => logger.warn('helper.stdout', { bytes: chunk.length }));
  child.stderr?.on('data', (chunk: Buffer) => logger.warn('helper.stderr', { bytes: chunk.length }));

  for (let attempt = 0; attempt < 30; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (spawnError) {
      child.kill();
      throw new UuError('UU_HELPER_UNAVAILABLE', '无法启动 Desktop Helper。', false, { binaryPath });
    }
    try {
      await client.health();
      return child;
    } catch (error) {
      if (!(error instanceof UuError) || error.code !== 'UU_HELPER_UNAVAILABLE') {
        child.kill();
        throw error;
      }
    }
  }
  child.kill();
  throw new UuError('UU_HELPER_UNAVAILABLE', 'Desktop Helper 启动后 3 秒内未就绪。', true, { binaryPath });
}
