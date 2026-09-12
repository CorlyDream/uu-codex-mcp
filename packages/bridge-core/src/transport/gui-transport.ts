import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { MAX_COMMAND_BYTES, MAX_COMMAND_TIMEOUT_MS, MIN_COMMAND_TIMEOUT_MS, RESULT_PAGE_CHARS } from '../config.js';
import { UuError } from '../errors.js';
import type { DesktopHelperClient } from '../helper/client.js';
import type { Logger } from '../logger.js';
import { StderrLogger } from '../logger.js';
import { createRequestId, markersFor, type RequestMarkers } from '../protocol/markers.js';
import { buildExecutionCommand } from '../protocol/powershell.js';
import { buildPageCommand, decodeRemoteResult, parseMeta, parsePage } from '../protocol/result-pages.js';
import { OwnedTerminals } from '../session/owned-terminals.js';
import { SerialExecutor } from '../session/serial-executor.js';
import type { ExecRequest, ExecResult, UuDevice } from '../types.js';
import type { RemoteTransport } from './types.js';

export interface UuCliLike {
  listDevices(): Promise<UuDevice[]>;
  openTerminal(deviceId: string): Promise<void>;
  closeTerminal(deviceId: string): Promise<void>;
}

export interface DesktopHelperLike {
  beginInteraction(appBundlePath: string, deviceName: string): Promise<{ interactionId: string; windowTitle: string }>;
  clipboardSnapshot(): Promise<string>;
  clipboardSetText(text: string): Promise<void>;
  clipboardRestore(snapshotId: string): Promise<void>;
  paste(interactionId: string): Promise<void>;
  keyReturn(interactionId: string): Promise<void>;
  readTerminalText(interactionId: string): Promise<string[]>;
  endInteraction(interactionId: string): Promise<void>;
}

export interface GuiTransportOptions {
  cli: UuCliLike;
  helper: DesktopHelperLike | DesktopHelperClient;
  appBundlePath: string;
  ownedTerminals?: OwnedTerminals;
  serialExecutor?: SerialExecutor;
  logger?: Logger;
  requestIdFactory?: () => string;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Serial GUI transport for legacy macOS UU clients.
 * It treats window focus, clipboard restoration, and terminal ownership as fail-closed safety boundaries.
 */
export class GuiTransport implements RemoteTransport {
  private readonly cli: UuCliLike;
  private readonly helper: DesktopHelperLike;
  private readonly appBundlePath: string;
  private readonly owned: OwnedTerminals;
  private readonly serial: SerialExecutor;
  private readonly logger: Logger;
  private readonly requestIdFactory: () => string;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: GuiTransportOptions) {
    this.cli = options.cli;
    this.helper = options.helper;
    this.appBundlePath = options.appBundlePath;
    this.owned = options.ownedTerminals ?? new OwnedTerminals();
    this.serial = options.serialExecutor ?? new SerialExecutor();
    this.logger = options.logger ?? new StderrLogger();
    this.requestIdFactory = options.requestIdFactory ?? createRequestId;
    this.clock = options.clock ?? (() => performance.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** Execute one PowerShell command while preserving the user's clipboard and cleaning only owned UU terminals. */
  execute(request: ExecRequest): Promise<ExecResult> {
    return this.serial.run(() => this.executeSerialized(request));
  }

  /** Close only a terminal explicitly opened by this bridge process. */
  closeOwnedTerminal(deviceId: string): Promise<void> {
    return this.serial.run(async () => {
      if (!this.owned.isOwned(deviceId)) {
        throw new UuError('UU_TERM_NOT_OWNED', '拒绝关闭非本进程创建的 UU 终端。', false, { deviceId });
      }
      await this.cli.closeTerminal(deviceId);
      this.owned.markClosed(deviceId);
    });
  }

  private async executeSerialized(request: ExecRequest): Promise<ExecResult> {
    this.validateRequest(request);
    const devices = await this.cli.listDevices();
    const device = devices.find((candidate) => candidate.id === request.deviceId);
    if (!device) throw new UuError('UU_DEVICE_NOT_FOUND', '未找到指定 UU 设备。', false, { deviceId: request.deviceId });
    if (!device.online) throw new UuError('UU_DEVICE_OFFLINE', '目标 UU 设备当前离线。', true, { deviceId: request.deviceId });
    if (device.platform !== 'windows') {
      throw new UuError('UU_DEVICE_PLATFORM_UNSUPPORTED', 'MVP 仅支持远程 Windows PowerShell。', false, { deviceId: request.deviceId, platform: device.platform });
    }

    const startedAt = this.clock();
    const deadline = startedAt + request.timeoutMs;
    const requestId = this.requestIdFactory();
    const commandBytes = Buffer.byteLength(request.command, 'utf8');
    const commandHash = createHash('sha256').update(request.command).digest('hex').slice(0, 12);
    let interactionId: string | undefined;
    let snapshotId: string | undefined;
    let result: ExecResult | undefined;
    let primaryError: unknown;
    let cleanupError: unknown;

    this.logger.info('uu_exec.start', { requestId, deviceId: request.deviceId, commandBytes, commandHash });

    try {
      await this.cli.openTerminal(request.deviceId);
      this.owned.markOpened(request.deviceId);

      interactionId = (await this.beginInteractionWithRetry(device, deadline)).interactionId;
      snapshotId = await this.helper.clipboardSnapshot();
      await this.sendCommand(interactionId, buildExecutionCommand(request.command, requestId));

      const markers = markersFor(requestId);
      const meta = await this.waitForMeta(interactionId, markers, deadline);
      let encoded = '';
      for (let offset = 0; offset < meta.length; offset += RESULT_PAGE_CHARS) {
        await this.sendCommand(interactionId, buildPageCommand(requestId, offset));
        const expected = Math.min(RESULT_PAGE_CHARS, meta.length - offset);
        encoded += await this.waitForPage(interactionId, markers, deadline, expected);
      }
      if (encoded.length !== meta.length) {
        throw new UuError('UU_RESULT_DECODE_FAILED', 'UU 终端分页结果长度与元数据不一致。', true, { expected: meta.length, actual: encoded.length });
      }
      const remote = decodeRemoteResult(encoded);
      result = {
        requestId,
        deviceId: request.deviceId,
        stdout: remote.stdout,
        success: remote.success,
        exitCode: remote.exitCode,
        error: remote.error,
        durationMs: Math.max(0, Math.round(this.clock() - startedAt)),
        transport: 'gui',
      };
    } catch (error) {
      primaryError = this.safeError(error);
    } finally {
      if (snapshotId) {
        try { await this.helper.clipboardRestore(snapshotId); }
        catch (error) { cleanupError ??= this.safeError(error); this.logCleanup('clipboard_restore', error, requestId, request.deviceId); }
      }
      if (interactionId) {
        try { await this.helper.endInteraction(interactionId); }
        catch (error) { cleanupError ??= this.safeError(error); this.logCleanup('end_interaction', error, requestId, request.deviceId); }
      }
      if (this.owned.isOwned(request.deviceId)) {
        try {
          await this.cli.closeTerminal(request.deviceId);
          this.owned.markClosed(request.deviceId);
        } catch (error) {
          cleanupError ??= this.safeError(error);
          this.logCleanup('term_close', error, requestId, request.deviceId);
        }
      }
    }

    const finalError = primaryError ?? cleanupError;
    if (finalError) throw finalError;
    if (!result) throw new UuError('UU_HELPER_PROTOCOL_ERROR', '远程执行未产生结果。', true);
    this.logger.info('uu_exec.finish', { requestId, deviceId: request.deviceId, durationMs: result.durationMs, success: result.success });
    return result;
  }

  private validateRequest(request: ExecRequest): void {
    if (!Number.isInteger(request.timeoutMs) || request.timeoutMs < MIN_COMMAND_TIMEOUT_MS || request.timeoutMs > MAX_COMMAND_TIMEOUT_MS) {
      throw new UuError('UU_INVALID_ARGUMENT', 'timeoutMs 必须位于 1000–300000 毫秒。', false);
    }
    if (Buffer.byteLength(request.command, 'utf8') > MAX_COMMAND_BYTES) {
      throw new UuError('UU_COMMAND_TOO_LONG', '远程命令超过 16 KiB UTF-8 限制。', false);
    }
  }

  private async beginInteractionWithRetry(device: UuDevice, deadline: number): Promise<{ interactionId: string; windowTitle: string }> {
    const retryDeadline = Math.min(deadline, this.clock() + 10_000);
    for (;;) {
      try {
        return await this.helper.beginInteraction(this.appBundlePath, device.name);
      } catch (error) {
        if (!(error instanceof UuError) || error.code !== 'UU_TERM_WINDOW_NOT_FOUND') throw error;
        if (this.clock() >= retryDeadline) throw error;
        await this.sleep(Math.min(250, Math.max(0, retryDeadline - this.clock())));
      }
    }
  }

  private async sendCommand(interactionId: string, text: string): Promise<void> {
    await this.helper.clipboardSetText(text);
    await this.helper.paste(interactionId);
    await this.helper.keyReturn(interactionId);
  }

  private async waitForMeta(interactionId: string, markers: RequestMarkers, deadline: number): Promise<{ length: number }> {
    for (;;) {
      const strings = await this.helper.readTerminalText(interactionId);
      for (const candidate of this.textCandidates(strings)) {
        try { return parseMeta(candidate, markers); }
        catch (error) {
          if (!(error instanceof UuError) || error.code !== 'UU_RESULT_MARKER_TIMEOUT') throw error;
        }
      }
      if (this.clock() >= deadline) throw new UuError('UU_RESULT_MARKER_TIMEOUT', '等待远程命令结果标记超时。', true);
      await this.sleep(Math.min(150, Math.max(0, deadline - this.clock())));
    }
  }

  private async waitForPage(interactionId: string, markers: RequestMarkers, deadline: number, expectedLength: number): Promise<string> {
    for (;;) {
      const strings = await this.helper.readTerminalText(interactionId);
      for (const candidate of this.textCandidates(strings)) {
        try {
          const page = parsePage(candidate, markers);
          if (page.length === expectedLength) return page;
          if (page.length > expectedLength) {
            throw new UuError('UU_RESULT_DECODE_FAILED', 'UU 终端分页结果超过预期长度。', true, { expectedLength, actual: page.length });
          }
        } catch (error) {
          if (!(error instanceof UuError) || error.code !== 'UU_RESULT_MARKER_TIMEOUT') throw error;
        }
      }
      if (this.clock() >= deadline) throw new UuError('UU_RESULT_MARKER_TIMEOUT', '等待 UU 终端分页结果超时。', true);
      await this.sleep(Math.min(150, Math.max(0, deadline - this.clock())));
    }
  }

  private textCandidates(strings: string[]): string[] {
    return [strings.join('\n'), ...strings];
  }

  private safeError(error: unknown): UuError {
    return error instanceof UuError ? error : new UuError('UU_HELPER_PROTOCOL_ERROR', 'UU 远程执行发生内部错误。', true);
  }

  private logCleanup(stage: string, error: unknown, requestId: string, deviceId: string): void {
    const code = error instanceof UuError ? error.code : 'UU_HELPER_PROTOCOL_ERROR';
    this.logger.warn('uu_exec.cleanup_failed', { stage, requestId, deviceId, errorCode: code });
  }
}
