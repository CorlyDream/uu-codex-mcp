import { UuError } from '../errors.js';
import type { UuDevice } from '../types.js';
import { probeCliCapabilities, type CliCapabilities } from './capabilities.js';
import { normalizeDeviceList } from './devices.js';
import { CommandRunner, type CommandResult, type CommandRunnerLike } from './runner.js';

function tryParseJsonEnvelope(text: string): unknown | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function parseJsonEnvelope(text: string): unknown {
  const parsed = tryParseJsonEnvelope(text);
  if (parsed === undefined) {
    throw new UuError('UU_INVALID_ARGUMENT', 'uuyc-cli 返回了无法解析的设备 JSON。', true);
  }
  return parsed;
}

/**
 * UU CLI variants do not consistently use a non-zero process exit status for failures.
 * Treat explicit text errors and JSON success=false as failures even when exitCode is 0.
 */
function commandReportedFailure(result: CommandResult): boolean {
  if (result.exitCode !== 0) return true;

  const text = `${result.stdout}\n${result.stderr}`;
  if (/^\s*(?:Error:|Unknown option|Unexpected argument|Unrecognized(?:\s+(?:option|argument))?\b)/im.test(text)) {
    return true;
  }

  const parsed = tryParseJsonEnvelope(text);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const envelope = parsed as Record<string, unknown>;
  if (envelope.success === false) return true;
  const data = envelope.data;
  return Boolean(data && typeof data === 'object' && !Array.isArray(data) && (data as Record<string, unknown>).success === false);
}

/** Cross-version adapter around the official UU CLI surfaces used by the MVP. */
export class UuCliAdapter {
  private cachedCapabilities?: CliCapabilities;

  constructor(
    public readonly cliPath: string,
    private readonly runner: CommandRunnerLike = new CommandRunner(),
  ) {}

  async capabilities(): Promise<CliCapabilities> {
    this.cachedCapabilities ??= await probeCliCapabilities(this.cliPath, this.runner);
    return this.cachedCapabilities;
  }

  /** List and normalize all devices returned by the installed UU CLI variant. */
  async listDevices(): Promise<UuDevice[]> {
    const result = await this.runner.run(this.cliPath, ['device', 'list'], 10_000);
    if (commandReportedFailure(result)) {
      throw new UuError('UU_CLI_NOT_FOUND', 'uuyc-cli device list 执行失败。', true, { exitCode: result.exitCode });
    }
    return normalizeDeviceList(parseJsonEnvelope(`${result.stdout}\n${result.stderr}`));
  }

  /** Open the UU main-app terminal window for exactly one device. */
  async openTerminal(deviceId: string): Promise<void> {
    const capabilities = await this.capabilities();
    if (!capabilities.termOpen) throw new UuError('UU_TERM_OPEN_FAILED', '当前 uuyc-cli 不支持 term open。', false);
    const result = await this.runner.run(this.cliPath, ['term', 'open', deviceId], 15_000);
    if (commandReportedFailure(result)) {
      throw new UuError('UU_TERM_OPEN_FAILED', '打开 UU 远程终端失败。', true, { exitCode: result.exitCode });
    }
  }

  /** Close the terminal using the strongest supported legacy command. */
  async closeTerminal(deviceId: string): Promise<void> {
    const capabilities = await this.capabilities();
    if (!capabilities.termExit) throw new UuError('UU_SESSION_CLOSE_FAILED', '当前 uuyc-cli 不支持 term exit。', false);
    const args = ['term', 'exit', deviceId];
    if (capabilities.termExitClear) args.push('--clear');
    const result = await this.runner.run(this.cliPath, args, 15_000);
    if (commandReportedFailure(result)) {
      throw new UuError('UU_SESSION_CLOSE_FAILED', '关闭 UU 远程终端失败。', true, { exitCode: result.exitCode });
    }
  }
}
