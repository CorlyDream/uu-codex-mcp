import type { ExecRequest, ExecResult } from '../types.js';

/** Remote command transport consumed by the MCP layer, independent of UU's current terminal implementation. */
export interface RemoteTransport {
  execute(request: ExecRequest): Promise<ExecResult>;
  closeOwnedTerminal(deviceId: string): Promise<void>;
}
