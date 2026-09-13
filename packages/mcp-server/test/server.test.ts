import { spawn } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/server';
import { UuError, type ExecRequest, type ExecResult, type UuDevice } from '@uu-codex/bridge-core';
import { registerUuTools, type BridgeApi } from '../src/server.js';

class FakeBridge implements BridgeApi {
  devices: UuDevice[] = [{ id: 'dev-1', name: '客户A', platform: 'windows', online: true }];
  execRequests: ExecRequest[] = [];
  closed: string[] = [];
  execError?: Error;
  async listDevices() { return this.devices; }
  async execute(request: ExecRequest): Promise<ExecResult> {
    this.execRequests.push(request);
    if (this.execError) throw this.execError;
    return { requestId: 'r1', deviceId: request.deviceId, stdout: 'ok\n', success: true, exitCode: 0, error: null, durationMs: 12, transport: 'gui' };
  }
  async closeOwnedTerminal(deviceId: string) { this.closed.push(deviceId); }
}

function fakeRegistrar() {
  const tools = new Map<string, { handler: (args: any) => Promise<any> }>();
  const server = { registerTool(name: string, _config: unknown, handler: (args: any) => Promise<any>) { tools.set(name, { handler }); } } as unknown as McpServer;
  return { server, tools };
}

describe('MCP tool registration', () => {
  it('registers exactly the three public UU tools', () => {
    const fake = fakeRegistrar();
    registerUuTools(fake.server, new FakeBridge());
    expect([...fake.tools.keys()]).toEqual(['uu_list_devices', 'uu_exec', 'uu_close_terminal']);
  });

  it('returns device JSON without requiring a GUI transport', async () => {
    const fake = fakeRegistrar(); const bridge = new FakeBridge(); registerUuTools(fake.server, bridge);
    const result = await fake.tools.get('uu_list_devices')!.handler({});
    expect(JSON.parse(result.content[0].text)).toEqual({ devices: bridge.devices });
  });

  it('maps exec input/output and applies the 30s default timeout', async () => {
    const fake = fakeRegistrar(); const bridge = new FakeBridge(); registerUuTools(fake.server, bridge);
    const result = await fake.tools.get('uu_exec')!.handler({ device_id: 'dev-1', command: 'hostname' });
    expect(bridge.execRequests[0]).toEqual({ deviceId: 'dev-1', command: 'hostname', timeoutMs: 30_000 });
    expect(JSON.parse(result.content[0].text)).toEqual({
      request_id: 'r1', device_id: 'dev-1', stdout: 'ok\n', success: true,
      exit_code: 0, error: null, duration_ms: 12, transport: 'gui',
    });
  });

  it('returns stable structured UuError JSON', async () => {
    const fake = fakeRegistrar(); const bridge = new FakeBridge();
    bridge.execError = new UuError('UU_DEVICE_OFFLINE', 'offline', true);
    registerUuTools(fake.server, bridge);
    const result = await fake.tools.get('uu_exec')!.handler({ device_id: 'dev-1', command: 'hostname' });
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0].text)).toEqual({ code: 'UU_DEVICE_OFFLINE', message: 'offline', retryable: true });
  });

  it('routes close through bridge ownership checks', async () => {
    const fake = fakeRegistrar(); const bridge = new FakeBridge(); registerUuTools(fake.server, bridge);
    const result = await fake.tools.get('uu_close_terminal')!.handler({ device_id: 'dev-1' });
    expect(bridge.closed).toEqual(['dev-1']);
    expect(JSON.parse(result.content[0].text)).toEqual({ device_id: 'dev-1', closed: true });
  });
});

describe('stdio entrypoint', () => {
  it('emits no plain diagnostics on stdout before MCP traffic', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uu-mcp-stdio-'));
    const app = join(dir, 'UURemote.app');
    const cli = join(app, 'Contents', 'MacOS', 'uuyc-cli');
    await mkdir(dirname(cli), { recursive: true });
    await writeFile(cli, '#!/bin/sh\nexit 0\n');
    await chmod(cli, 0o755);
    const testDir = dirname(fileURLToPath(import.meta.url));
    const sourceRunMain = join(testDir, '..', 'dist', 'main.js');
    const compiledRunMain = join(testDir, '..', 'main.js');
    let main = sourceRunMain;
    try { await access(main); } catch { main = compiledRunMain; }
    const child = spawn(process.execPath, [main], { env: { ...process.env, UU_CLI_PATH: cli }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout?.setEncoding('utf8'); child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr?.on('data', (chunk: string) => { stderr += chunk; });
    child.stdin?.end();
    await new Promise<void>((resolve) => child.once('close', () => resolve()));
    expect(stdout).toBe('');
    expect(stderr.includes('console.log')).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});
