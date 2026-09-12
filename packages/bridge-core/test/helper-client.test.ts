import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DesktopHelperClient } from '../src/helper/client.js';
import { UuError } from '../src/errors.js';

async function withSocketServer(responder: (request: Record<string, unknown>) => string | undefined, run: (socketPath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'uu-helper-test-'));
  const socketPath = join(dir, 'helper.sock');
  const server = createServer((socket) => {
    let data = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      data += chunk;
      const newline = data.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(data.slice(0, newline)) as Record<string, unknown>;
      const response = responder(request);
      if (response !== undefined) socket.write(`${response}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  try { await run(socketPath); }
  finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

async function errorCode(promise: Promise<unknown>): Promise<string | null> {
  try { await promise; return null; }
  catch (error) { return error instanceof UuError ? error.code : null; }
}

describe('DesktopHelperClient', () => {
  it('returns a typed health result from one JSONL request', async () => {
    await withSocketServer((request) => JSON.stringify({ id: request.id, ok: true, result: { status: 'ok' } }), async (socketPath) => {
      const client = new DesktopHelperClient(socketPath, 500);
      expect(await client.health()).toEqual({ status: 'ok' });
    });
  });

  it('rejects a mismatched response id', async () => {
    await withSocketServer(() => JSON.stringify({ id: 'wrong', ok: true, result: {} }), async (socketPath) => {
      expect(await errorCode(new DesktopHelperClient(socketPath, 500).health())).toBe('UU_HELPER_PROTOCOL_ERROR');
    });
  });

  it('rejects malformed JSON', async () => {
    await withSocketServer(() => '{not-json', async (socketPath) => {
      expect(await errorCode(new DesktopHelperClient(socketPath, 500).health())).toBe('UU_HELPER_PROTOCOL_ERROR');
    });
  });

  it('maps connection refusal to UU_HELPER_UNAVAILABLE', async () => {
    const socketPath = join(tmpdir(), `uu-helper-missing-${process.pid}.sock`);
    expect(await errorCode(new DesktopHelperClient(socketPath, 100).health())).toBe('UU_HELPER_UNAVAILABLE');
  });

  it('maps response timeout to UU_HELPER_UNAVAILABLE', async () => {
    await withSocketServer(() => undefined, async (socketPath) => {
      expect(await errorCode(new DesktopHelperClient(socketPath, 30).health())).toBe('UU_HELPER_UNAVAILABLE');
    });
  });
});
