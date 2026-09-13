import { McpServer } from '@modelcontextprotocol/server';
import type { ExecRequest, ExecResult, UuDevice } from '@uu-codex/bridge-core';
import { registerCloseTerminalTool } from './tools/close-terminal.js';
import { registerExecTool } from './tools/exec.js';
import { registerListDevicesTool } from './tools/list-devices.js';

/** Narrow bridge surface exposed to MCP handlers; GUI/helper bootstrap stays outside the protocol layer. */
export interface BridgeApi {
  listDevices(): Promise<UuDevice[]>;
  execute(request: ExecRequest): Promise<ExecResult>;
  closeOwnedTerminal(deviceId: string): Promise<void>;
}

/** Register the complete public MVP tool set on an MCP server instance. */
export function registerUuTools(server: McpServer, bridge: BridgeApi): void {
  registerListDevicesTool(server, bridge);
  registerExecTool(server, bridge);
  registerCloseTerminalTool(server, bridge);
}

/** Construct one connection-scoped MCP server without starting UU/helper side effects. */
export function createServer(bridge: BridgeApi): McpServer {
  const server = new McpServer({ name: 'uu-codex-mcp', version: '0.1.0' });
  registerUuTools(server, bridge);
  return server;
}
