import type { ChildProcess } from 'node:child_process';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import {
  DesktopHelperClient,
  GuiTransport,
  StderrLogger,
  UuCliAdapter,
  UuError,
  discoverUuInstallation,
  ensureDesktopHelper,
} from '@uu-codex/bridge-core';
import { createServer, type BridgeApi } from './server.js';

const logger = new StderrLogger();

/** Run one stdio MCP connection while deferring Accessibility/helper startup until a GUI execution request. */
async function main(): Promise<void> {
  const installation = await discoverUuInstallation();
  const cli = new UuCliAdapter(installation.cliPath);
  const helper = new DesktopHelperClient();
  const transport = new GuiTransport({ cli, helper, appBundlePath: installation.appBundlePath, logger });
  const helperOwner: { child: ChildProcess | null } = { child: null };
  let helperEnsureInFlight: Promise<void> | null = null;

  /** Re-check helper health for every execution, coalescing only concurrent startup attempts. */
  const ensureHelperReady = (): Promise<void> => {
    if (!helperEnsureInFlight) {
      helperEnsureInFlight = (async () => {
        const child = await ensureDesktopHelper(helper, { logger });
        if (child) {
          helperOwner.child = child;
          child.once('exit', () => {
            if (helperOwner.child === child) helperOwner.child = null;
          });
        }
      })().finally(() => {
        helperEnsureInFlight = null;
      });
    }
    return helperEnsureInFlight;
  };

  const bridge: BridgeApi = {
    listDevices: () => cli.listDevices(),
    execute: async (request) => {
      await ensureHelperReady();
      return transport.execute(request);
    },
    closeOwnedTerminal: (deviceId) => transport.closeOwnedTerminal(deviceId),
  };

  const handle = serveStdio(() => createServer(bridge));
  let shuttingDown = false;

  /** Kill only the Desktop Helper process started and owned by this MCP process. */
  const stopOwnedHelper = (): void => {
    const child = helperOwner.child;
    helperOwner.child = null;
    if (child && !child.killed) child.kill();
  };

  /** Close stdio transport and local helper on explicit process termination signals. */
  const shutdown = async (exitCode: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopOwnedHelper();
    try {
      await handle.close();
    } catch {
      logger.warn('mcp.close_failed', {});
    }
    process.exitCode = exitCode;
  };

  // Host disconnect is the normal stdio lifecycle; close both the MCP handle and any helper child we own.
  process.stdin.once('end', () => { void shutdown(0); });
  process.once('exit', stopOwnedHelper);
  process.once('SIGINT', () => { void shutdown(130); });
  process.once('SIGTERM', () => { void shutdown(143); });
}

try {
  await main();
} catch (error) {
  const safe = error instanceof UuError ? error : new UuError('UU_HELPER_PROTOCOL_ERROR', 'UU MCP 启动失败。', false);
  logger.error('mcp.fatal', { errorCode: safe.code });
  process.exitCode = 1;
}
