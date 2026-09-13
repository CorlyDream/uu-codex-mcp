import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';
import type { BridgeApi } from '../server.js';
import { jsonResult, toolError } from './common.js';

/** Register read-only UU device discovery; it never starts the Desktop Helper. */
export function registerListDevicesTool(server: McpServer, bridge: BridgeApi): void {
  server.registerTool('uu_list_devices', {
    description: '列出当前 UU 账号可见设备及在线状态。',
    inputSchema: z.object({}),
  }, async () => {
    try {
      return jsonResult({ devices: await bridge.listDevices() });
    } catch (error) {
      return toolError(error);
    }
  });
}
