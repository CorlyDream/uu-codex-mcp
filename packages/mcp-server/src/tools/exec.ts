import type { McpServer } from '@modelcontextprotocol/server';
import { DEFAULT_COMMAND_TIMEOUT_MS } from '@uu-codex/bridge-core';
import { z } from 'zod/v4';
import type { BridgeApi } from '../server.js';
import { jsonResult, toolError } from './common.js';

interface ExecToolInput {
  device_id: string;
  command: string;
  timeout_ms?: number;
}

/** Register remote PowerShell execution with schema validation and stable snake_case result fields. */
export function registerExecTool(server: McpServer, bridge: BridgeApi): void {
  server.registerTool('uu_exec', {
    description: '通过 macOS UU 远程终端在指定 Windows 设备执行 PowerShell。',
    inputSchema: z.object({
      device_id: z.string().min(1),
      command: z.string().min(1),
      timeout_ms: z.number().int().min(1_000).max(300_000).optional(),
    }),
  }, async ({ device_id, command, timeout_ms }: ExecToolInput) => {
    try {
      const result = await bridge.execute({ deviceId: device_id, command, timeoutMs: timeout_ms ?? DEFAULT_COMMAND_TIMEOUT_MS });
      return jsonResult({
        request_id: result.requestId,
        device_id: result.deviceId,
        stdout: result.stdout,
        success: result.success,
        exit_code: result.exitCode,
        error: result.error,
        duration_ms: result.durationMs,
        transport: result.transport,
      });
    } catch (error) {
      return toolError(error);
    }
  });
}
