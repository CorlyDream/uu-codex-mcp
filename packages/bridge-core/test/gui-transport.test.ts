import { describe, expect, it } from 'vitest';
import { UuError } from '../src/errors.js';
import { markersFor } from '../src/protocol/markers.js';
import { GuiTransport, type DesktopHelperLike, type UuCliLike } from '../src/transport/gui-transport.js';
import { OwnedTerminals } from '../src/session/owned-terminals.js';
import type { UuDevice } from '../src/types.js';

const requestId = '0123456789abcdef01234567';
const device: UuDevice = { id: 'dev-1', name: '客户A', platform: 'windows', online: true };

class FakeCli implements UuCliLike {
  events: string[] = [];
  devices = [device];
  openError?: Error;
  closeError?: Error;
  async listDevices() { this.events.push('listDevices'); return this.devices; }
  async openTerminal(_deviceId: string) { this.events.push('openTerminal'); if (this.openError) throw this.openError; }
  async closeTerminal(_deviceId: string) { this.events.push('closeTerminal'); if (this.closeError) throw this.closeError; }
}

class FakeHelper implements DesktopHelperLike {
  events: string[] = [];
  payload = Buffer.from(JSON.stringify({ stdout: 'hello\n', success: true, exitCode: 0, error: null }), 'utf8').toString('base64');
  currentCommand = '';
  beginError?: UuError;
  restoreError?: UuError;
  async beginInteraction() { this.events.push('beginInteraction'); if (this.beginError) throw this.beginError; return { interactionId: 'i-1', windowTitle: '客户A - Terminal' }; }
  async clipboardSnapshot() { this.events.push('clipboardSnapshot'); return 'snap-1'; }
  async clipboardSetText(text: string) { this.events.push('clipboardSetText'); this.currentCommand = text; }
  async paste() { this.events.push('paste'); }
  async keyReturn() { this.events.push('keyReturn'); }
  async readTerminalText() {
    this.events.push('readTerminalText');
    const markers = markersFor(requestId);
    if (this.currentCommand.includes('__UU_META_')) return [`${markers.meta}:${this.payload.length}`];
    const offset = Number(/\$__uuStart=(\d+)/.exec(this.currentCommand)?.[1] ?? 0);
    return [markers.pageBegin, this.payload.slice(offset, offset + 384), markers.pageEnd];
  }
  async clipboardRestore() { this.events.push('clipboardRestore'); if (this.restoreError) throw this.restoreError; }
  async endInteraction() { this.events.push('endInteraction'); }
}

function makeTransport(cli = new FakeCli(), helper = new FakeHelper(), owned = new OwnedTerminals(), timing: { clock?: () => number; sleep?: (ms: number) => Promise<void> } = {}) {
  return { cli, helper, owned, transport: new GuiTransport({
    cli,
    helper,
    appBundlePath: '/Applications/UURemote.app',
    ownedTerminals: owned,
    requestIdFactory: () => requestId,
    sleep: timing.sleep ?? (async () => undefined),
    ...(timing.clock ? { clock: timing.clock } : {}),
  }) };
}

async function codeOf(promise: Promise<unknown>): Promise<string | null> {
  try { await promise; return null; }
  catch (error) { return error instanceof UuError ? error.code : null; }
}

describe('GuiTransport', () => {
  it('executes and cleans up in the required lifecycle order', async () => {
    const { transport, cli, helper } = makeTransport();
    const result = await transport.execute({ deviceId: 'dev-1', command: 'hostname', timeoutMs: 30_000 });
    expect(result).toMatchObject({ deviceId: 'dev-1', stdout: 'hello\n', success: true, exitCode: 0, transport: 'gui' });
    expect([...cli.events, ...helper.events].includes('openTerminal')).toBe(true);
    expect(helper.events).toEqual([
      'beginInteraction', 'clipboardSnapshot',
      'clipboardSetText', 'paste', 'keyReturn', 'readTerminalText',
      'clipboardSetText', 'paste', 'keyReturn', 'readTerminalText',
      'clipboardRestore', 'endInteraction',
    ]);
    expect(cli.events.at(-1)).toBe('closeTerminal');
  });

  it('rejects missing, offline and non-windows devices before terminal open', async () => {
    const missing = makeTransport(); missing.cli.devices = [];
    expect(await codeOf(missing.transport.execute({ deviceId: 'x', command: 'hostname', timeoutMs: 30_000 }))).toBe('UU_DEVICE_NOT_FOUND');
    expect(missing.cli.events).toEqual(['listDevices']);
    const offline = makeTransport(); offline.cli.devices = [{ ...device, online: false }];
    expect(await codeOf(offline.transport.execute({ deviceId: 'dev-1', command: 'hostname', timeoutMs: 30_000 }))).toBe('UU_DEVICE_OFFLINE');
    const platform = makeTransport(); platform.cli.devices = [{ ...device, platform: 'unknown' }];
    expect(await codeOf(platform.transport.execute({ deviceId: 'dev-1', command: 'hostname', timeoutMs: 30_000 }))).toBe('UU_DEVICE_PLATFORM_UNSUPPORTED');
  });

  it('rejects oversized commands before opening a terminal', async () => {
    const state = makeTransport();
    expect(await codeOf(state.transport.execute({ deviceId: 'dev-1', command: '你'.repeat(6000), timeoutMs: 30_000 }))).toBe('UU_COMMAND_TOO_LONG');
    expect(state.cli.events.includes('openTerminal')).toBe(false);
  });

  it('closes an owned terminal when begin interaction fails', async () => {
    const state = makeTransport();
    state.helper.beginError = new UuError('UU_TERM_WINDOW_AMBIGUOUS', 'ambiguous', false);
    expect(await codeOf(state.transport.execute({ deviceId: 'dev-1', command: 'hostname', timeoutMs: 30_000 }))).toBe('UU_TERM_WINDOW_AMBIGUOUS');
    expect(state.cli.events.at(-1)).toBe('closeTerminal');
    expect(state.owned.isOwned('dev-1')).toBe(false);
  });

  it('restores clipboard, ends interaction and closes terminal on marker timeout', async () => {
    let now = 0;
    const state = makeTransport(new FakeCli(), new FakeHelper(), new OwnedTerminals(), { clock: () => now, sleep: async (ms: number) => { now += ms; } });
    state.helper.readTerminalText = async () => { state.helper.events.push('readTerminalText'); return ['no marker']; };
    expect(await codeOf(state.transport.execute({ deviceId: 'dev-1', command: 'hostname', timeoutMs: 1_000 }))).toBe('UU_RESULT_MARKER_TIMEOUT');
    expect(state.helper.events.slice(-2)).toEqual(['clipboardRestore', 'endInteraction']);
    expect(state.cli.events.at(-1)).toBe('closeTerminal');
  });

  it('does not let clipboard restore failure mask an earlier marker timeout', async () => {
    let now = 0;
    const state = makeTransport(new FakeCli(), new FakeHelper(), new OwnedTerminals(), { clock: () => now, sleep: async (ms: number) => { now += ms; } });
    state.helper.readTerminalText = async () => { state.helper.events.push('readTerminalText'); return ['no marker']; };
    state.helper.restoreError = new UuError('UU_CLIPBOARD_FAILED', 'restore', true);
    expect(await codeOf(state.transport.execute({ deviceId: 'dev-1', command: 'hostname', timeoutMs: 1_000 }))).toBe('UU_RESULT_MARKER_TIMEOUT');
    expect(state.helper.events.includes('endInteraction')).toBe(true);
    expect(state.cli.events.at(-1)).toBe('closeTerminal');
  });

  it('cleans up when remote Base64 cannot be decoded', async () => {
    const state = makeTransport();
    state.helper.payload = '%%%%';
    expect(await codeOf(state.transport.execute({ deviceId: 'dev-1', command: 'hostname', timeoutMs: 30_000 }))).toBe('UU_RESULT_DECODE_FAILED');
    expect(state.helper.events.slice(-2)).toEqual(['clipboardRestore', 'endInteraction']);
    expect(state.cli.events.at(-1)).toBe('closeTerminal');
  });

  it('surfaces close failure after an otherwise successful command', async () => {
    const state = makeTransport();
    state.cli.closeError = new UuError('UU_SESSION_CLOSE_FAILED', 'close failed', true);
    expect(await codeOf(state.transport.execute({ deviceId: 'dev-1', command: 'hostname', timeoutMs: 30_000 }))).toBe('UU_SESSION_CLOSE_FAILED');
  });

  it('refuses to close a terminal this process does not own', async () => {
    const state = makeTransport();
    expect(await codeOf(state.transport.closeOwnedTerminal('dev-1'))).toBe('UU_TERM_NOT_OWNED');
    expect(state.cli.events).toEqual([]);
  });

  it('globally serializes concurrent executions', async () => {
    const cli = new FakeCli();
    let active = 0; let maxActive = 0;
    cli.listDevices = async () => {
      active += 1; maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return [device];
    };
    const { transport } = makeTransport(cli);
    await Promise.all([
      transport.execute({ deviceId: 'dev-1', command: 'a', timeoutMs: 30_000 }),
      transport.execute({ deviceId: 'dev-1', command: 'b', timeoutMs: 30_000 }),
    ]);
    expect(maxActive).toBe(1);
  });
});
