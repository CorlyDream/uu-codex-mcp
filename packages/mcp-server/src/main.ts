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

/** Run one stdio MCP connection while deferring Accessibility/helper startup until the first execution request. */
async function main(): Promise<void> {
  const installation = await discoverUuInstallation();
  const cli = new UuCliAdapter(installation.cliPath);
  const helper = new DesktopHelperClient();
  const transport = new GuiTransport({ cli, helper, appBundlePath: installation.appBundlePath, logger });
  const helperOwner: { child: ChildProcess | null } = { child: null };
  let helperReady: Promise<void> | undefined;

  const ensureHelperReady = (): Promise<void> => {
    if (!helperReady) {
      helperReady = (async () => {
        const child = await ensureDesktopHelper(helper, { logger });
        if (child) helperOwner.child = child;
      })().catch((error) => {
        helperReady = undefined;
        throw error;
      });
    }
    return helperReady;
  };

  const bridge: BridgeApi = {
    listDevices: () => cli.listDevices(),
    execute: async (request) => {
      await ensureHelperReady();
      return transport.execute(request);
    },
    closeOwnedTerminal: (deviceId) => transport.closeOwnedTerminal(deviceId),
  };

  try {
    await serveStdio(() => createServer(bridge));
  } finally {
    helperOwner.child?.kill();
  }
}

try {
  await main();
} catch (error) {
  const safe = error instanceof UuError ? error : new UuError('UU_HELPER_PROTOCOL_ERROR', 'UU MCP 启动失败。', false);
  logger.error('mcp.fatal', { errorCode: safe.code });
  process.exitCode = 1;
}
