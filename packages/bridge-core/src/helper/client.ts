import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { HELPER_SOCKET_PATH } from '../config.js';
import { UuError } from '../errors.js';
import { helperErrorCode, validateHelperResponse, type HelperArgs, type HelperResult } from './protocol.js';

const MAX_RESPONSE_BYTES = 1024 * 1024;

/** One-request-per-connection JSONL client for the privileged local Desktop Helper. */
export class DesktopHelperClient {
  constructor(
    public readonly socketPath = process.env.UU_HELPER_SOCKET_PATH ?? HELPER_SOCKET_PATH,
    private readonly timeoutMs = 3_000,
  ) {}

  /** Send one bounded request and return its validated result object. */
  call(action: string, args: HelperArgs = {}): Promise<HelperResult> {
    const id = randomUUID();
    const request = `${JSON.stringify({ id, action, args })}\n`;
    return new Promise((resolve, reject) => {
      const socket = createConnection({ path: this.socketPath });
      let settled = false;
      let received = Buffer.alloc(0);
      const timer = setTimeout(() => finish(() => reject(new UuError('UU_HELPER_UNAVAILABLE', 'Desktop Helper 响应超时。', true))), this.timeoutMs);

      const finish = (done: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        done();
      };

      socket.once('connect', () => socket.write(request));
      socket.on('data', (chunk: Buffer) => {
        received = Buffer.concat([received, chunk]);
        if (received.length > MAX_RESPONSE_BYTES) {
          finish(() => reject(new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper 响应超过 1 MiB 限制。', false)));
          return;
        }
        const newline = received.indexOf(0x0a);
        if (newline < 0) return;
        const line = received.subarray(0, newline).toString('utf8');
        try {
          const response = validateHelperResponse(JSON.parse(line), id);
          if (!response.ok) {
            const error = response.error!;
            finish(() => reject(new UuError(helperErrorCode(error.code), error.message, error.retryable)));
            return;
          }
          finish(() => resolve(response.result ?? {}));
        } catch (error) {
          const mapped = error instanceof UuError
            ? error
            : new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper 返回了无法解析的 JSON。', true);
          finish(() => reject(mapped));
        }
      });
      socket.once('error', () => {
        finish(() => reject(new UuError('UU_HELPER_UNAVAILABLE', '无法连接 Desktop Helper。', true)));
      });
    });
  }

  /** Verify the helper protocol is alive and return its advertised health state. */
  async health(): Promise<{ status: string }> {
    const result = await this.call('health');
    if (typeof result.status !== 'string') throw new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper health 响应无效。', true);
    return { status: result.status };
  }

  /** Acquire an opaque interaction for one exact UU terminal window. */
  async beginInteraction(appBundlePath: string, deviceName: string): Promise<{ interactionId: string; windowTitle: string }> {
    const result = await this.call('begin_interaction', { app_bundle_path: appBundlePath, device_name: deviceName });
    if (typeof result.interaction_id !== 'string' || typeof result.window_title !== 'string') {
      throw new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper begin_interaction 响应无效。', true);
    }
    return { interactionId: result.interaction_id, windowTitle: result.window_title };
  }

  /** Snapshot the complete macOS clipboard in helper memory and return only an opaque token. */
  async clipboardSnapshot(): Promise<string> {
    const result = await this.call('clipboard_snapshot');
    if (typeof result.snapshot_id !== 'string') throw new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper clipboard snapshot 响应无效。', true);
    return result.snapshot_id;
  }

  async clipboardSetText(text: string): Promise<void> { await this.call('clipboard_set_text', { text }); }
  async clipboardRestore(snapshotId: string): Promise<void> { await this.call('clipboard_restore', { snapshot_id: snapshotId }); }
  async paste(interactionId: string): Promise<void> { await this.call('paste', { interaction_id: interactionId }); }
  async keyReturn(interactionId: string): Promise<void> { await this.call('key_return', { interaction_id: interactionId }); }

  /** Read only text exposed by the Accessibility tree for the selected terminal window. */
  async readTerminalText(interactionId: string): Promise<string[]> {
    const result = await this.call('read_terminal_text', { interaction_id: interactionId });
    if (!Array.isArray(result.strings) || !result.strings.every((value) => typeof value === 'string')) {
      throw new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper terminal text 响应无效。', true);
    }
    return result.strings as string[];
  }

  async endInteraction(interactionId: string): Promise<void> { await this.call('end_interaction', { interaction_id: interactionId }); }
}
