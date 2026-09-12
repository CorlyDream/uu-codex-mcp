import { execFile } from 'node:child_process';
import {
  DesktopHelperClient,
  GuiTransport,
  OwnedTerminals,
  StderrLogger,
  UuCliAdapter,
  UuError,
  discoverUuInstallation,
  ensureDesktopHelper,
  type ExecResult,
} from '@uu-codex/bridge-core';

interface SmokeCase {
  name: string;
  command: string;
  assert(result: ExecResult): void;
}

function fail(message: string): never {
  throw new Error(message);
}

function expect(value: unknown, message: string): asserts value {
  if (!value) fail(message);
}

function stderr(message: string): void {
  process.stderr.write(`${message}\n`);
}

/** Read the current plain-text clipboard without writing its contents to logs. */
async function readClipboard(): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    execFile('/usr/bin/pbpaste', [], { encoding: 'utf8' }, (error, stdout) => error ? reject(error) : resolve(String(stdout ?? '')));
  });
}

function mandatoryCases(): SmokeCase[] {
  return [
    {
      name: 'hostname',
      command: 'hostname',
      assert: (result) => expect(result.success && result.stdout.trim().length > 0, 'hostname must return non-empty output'),
    },
    {
      name: 'chinese',
      command: "Write-Output '你好世界'",
      assert: (result) => expect(result.success && result.stdout.includes('你好世界'), 'Chinese output was not preserved'),
    },
    {
      name: 'empty',
      command: '$null',
      assert: (result) => expect(result.success, 'empty-output command must complete successfully'),
    },
    {
      name: 'powershell-error',
      command: "Write-Error 'EXPECTED_PS_ERROR'",
      assert: (result) => {
        expect(!result.success, 'PowerShell error must set success=false');
        expect(`${result.stdout}\n${result.error ?? ''}`.includes('EXPECTED_PS_ERROR'), 'PowerShell error text was not preserved');
      },
    },
    {
      name: 'native-nonzero',
      command: "cmd /c 'exit 7'",
      assert: (result) => expect(!result.success && result.exitCode === 7, 'native exit code 7 was not preserved'),
    },
    {
      name: 'special-chars',
      command: `Write-Output 'a$b | c; d'; Write-Output 'quote"double'; Write-Output "it's-ok"`,
      assert: (result) => {
        expect(result.stdout.includes('a$b | c; d'), 'dollar/pipe/semicolon text was altered');
        expect(result.stdout.includes('quote"double'), 'double quote text was altered');
        expect(result.stdout.includes("it's-ok"), 'single quote text was altered');
      },
    },
    {
      name: 'many-lines',
      command: "1..120 | ForEach-Object { 'LINE-' + $_ }",
      assert: (result) => {
        const lines = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
        expect(lines.length === 120, `expected 120 lines, received ${lines.length}`);
        expect(lines[0] === 'LINE-1' && lines.at(-1) === 'LINE-120', 'paged output lost first or last line');
      },
    },
    {
      name: 'long-line',
      command: "Write-Output ('X' * 240 + '-END')",
      assert: (result) => expect(result.stdout.trimEnd().endsWith('-END'), 'long line was truncated'),
    },
  ];
}

async function runCase(transport: GuiTransport, deviceId: string, testCase: SmokeCase): Promise<void> {
  const result = await transport.execute({ deviceId, command: testCase.command, timeoutMs: 30_000 });
  testCase.assert(result);
  stderr(`PASS ${testCase.name}`);
}

async function runTimeoutRecovery(transport: GuiTransport, deviceId: string): Promise<void> {
  let timeoutCode: string | undefined;
  try {
    await transport.execute({ deviceId, command: "Start-Sleep -Seconds 5; Write-Output 'TOO-LATE'", timeoutMs: 2_000 });
  } catch (error) {
    if (error instanceof UuError) timeoutCode = error.code;
    else throw error;
  }
  expect(timeoutCode === 'UU_RESULT_MARKER_TIMEOUT' || timeoutCode === 'UU_COMMAND_TIMEOUT', `expected timeout error, received ${timeoutCode ?? 'none'}`);

  const recovered = await transport.execute({ deviceId, command: "Write-Output 'RECOVERED'", timeoutMs: 30_000 });
  expect(recovered.success && recovered.stdout.includes('RECOVERED'), 'transport did not recover after timeout cleanup');
  stderr('PASS timeout-recovery');
}

async function runStabilityAndClipboard(
  transport: GuiTransport,
  helper: DesktopHelperClient,
  owned: OwnedTerminals,
  deviceId: string,
): Promise<void> {
  const harnessSnapshotId = await helper.clipboardSnapshot();
  const benignClipboard = `UU_CODEX_MCP_CLIPBOARD_TEST_${Date.now()}`;
  try {
    await helper.clipboardSetText(benignClipboard);
    for (let index = 1; index <= 10; index += 1) {
      const result = await transport.execute({
        deviceId,
        command: `Write-Output ('RUN-' + ${index})`,
        timeoutMs: 30_000,
      });
      expect(result.success && result.stdout.includes(`RUN-${index}`), `stability run ${index} failed`);
    }
    expect(await readClipboard() === benignClipboard, 'Desktop Helper did not restore the clipboard after repeated execution');
    expect(owned.listOwned().length === 0, 'a project-owned UU terminal remained after the stability loop');
    stderr('PASS stability-10x-and-clipboard');
  } finally {
    await helper.clipboardRestore(harnessSnapshotId);
  }
}

/** Run the authorized end-to-end matrix. No remote action occurs before exact device validation succeeds. */
async function main(deviceId: string): Promise<void> {
  if (process.platform !== 'darwin') fail('UU smoke tests require macOS because GuiTransport depends on the macOS Desktop Helper.');

  const installation = await discoverUuInstallation();
  const cli = new UuCliAdapter(installation.cliPath);
  const devices = await cli.listDevices();
  const device = devices.find((candidate) => candidate.id === deviceId);
  expect(device, `UU_TEST_DEVICE_ID ${deviceId} was not found; no remote action attempted.`);
  expect(device.online, `UU_TEST_DEVICE_ID ${deviceId} is offline; no remote action attempted.`);
  expect(device.platform === 'windows', `UU_TEST_DEVICE_ID ${deviceId} is not Windows; no remote action attempted.`);

  const helper = new DesktopHelperClient();
  const helperChild = await ensureDesktopHelper(helper, { logger: new StderrLogger() });
  const owned = new OwnedTerminals();
  const transport = new GuiTransport({
    cli,
    helper,
    appBundlePath: installation.appBundlePath,
    ownedTerminals: owned,
    logger: new StderrLogger(),
  });

  try {
    for (const testCase of mandatoryCases()) await runCase(transport, deviceId, testCase);
    await runTimeoutRecovery(transport, deviceId);
    await runStabilityAndClipboard(transport, helper, owned, deviceId);
    expect(owned.listOwned().length === 0, 'owned-terminal registry is not empty at final verification');
    stderr('UU SMOKE PASS');
  } finally {
    for (const ownedDeviceId of owned.listOwned()) {
      try { await transport.closeOwnedTerminal(ownedDeviceId); }
      catch { /* best-effort harness cleanup; primary failure is preserved */ }
    }
    helperChild?.kill();
  }
}

const deviceId = process.env.UU_TEST_DEVICE_ID?.trim();
if (!deviceId) {
  stderr('UU_TEST_DEVICE_ID is not set; no remote action was attempted.');
  process.exitCode = 2;
} else {
  try {
    await main(deviceId);
  } catch (error) {
    const message = error instanceof UuError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'unknown smoke-test failure';
    stderr(`UU SMOKE FAIL: ${message}`);
    process.exitCode = 1;
  }
}
