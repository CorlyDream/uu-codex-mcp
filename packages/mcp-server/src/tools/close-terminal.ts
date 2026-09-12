import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import type { BridgeApi } from '../server.js';
import { jsonResult, toolError } from './common.js';

interface CloseToolInput { device_id: string }

/** Register explicit cleanup that delegates to bridge ownership checks rather than calling UU CLI directly. */
export function registerCloseTerminalTool(server: McpServer, bridge: BridgeApi): void {
  server.registerTool('uu_close_terminal', {
    description: '关闭 uu-codex-mcp 当前进程明确拥有的指定设备终端。',
    inputSchema: z.object({ device_id: z.string().min(1) }),
  }, async ({ device_id }: CloseToolInput) => {
    try {
      await bridge.closeOwnedTerminal(device_id);
      return jsonResult({ device_id, closed: true });
    } catch (error) {
      return toolError(error);
    }
  });
}
