# UU Codex MCP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 macOS 上构建一个本地 MCP Server，使 Codex CLI 能通过网易 UU 远程在客户 Windows 电脑上执行 PowerShell 并可靠读取结果，同时客户机只安装 UU 远程客户端。

**Architecture:** 使用 pnpm workspace 管理 TypeScript MCP Server 与 Bridge Core；Bridge Core 通过官方 `uuyc-cli` 查询设备、打开/关闭 UU 终端，并通过独立 Swift Desktop Helper 使用 macOS Accessibility、剪贴板和键盘事件驱动 UU 终端。远程执行采用 request marker + PowerShell 结果缓存 + Base64 分页协议；MCP 与具体 Transport 解耦，为未来官方 pipe channel 保留接口。

**Tech Stack:** Node.js 20+、TypeScript、pnpm workspace、Vitest、MCP TypeScript SDK v2 `@modelcontextprotocol/server`、Zod v4、Swift Package Manager、AppKit、ApplicationServices/CoreGraphics、Unix Domain Socket。

**Spec:** `docs/superpowers/specs/2026-09-12-uu-codex-mcp-design.md`

## Global Constraints

- 主控平台是 macOS；客户 Windows 机器只安装 UU 远程客户端，不部署 MCP Server、Agent、SSH Server、HTTP Server 或其他常驻服务。
- Node.js 最低版本为 20。
- 当前 macOS UU 4.40.0 仅假定存在 `uuyc-cli term open <device-id>` / `term exit <device-id>`；不得假设存在 pipe terminal。
- 所有 CLI 能力都必须通过实际 `--help` capability probe 判断，不使用 `uuyc-cli --version` 推断功能。
- MCP Server 使用 stdio；**stdout 只允许 MCP 协议数据，所有日志必须写 stderr**。
- Desktop Helper 是唯一持有 macOS Accessibility 权限的进程；Node/MCP 进程不得直接操作 GUI。
- Desktop Helper 与 Node 只通过本地 Unix Domain Socket 通信；socket 权限必须为 `0600`。
- GuiTransport 不允许 OCR、固定坐标点击、屏幕截图识别等 fallback。
- 执行输入前必须证明目标窗口唯一且已聚焦；无法证明时 fail closed。
- MVP 全局串行执行，不实现多设备并发。
- MVP 只实现 `uu_list_devices`、`uu_exec`、`uu_close_terminal`；文件传输、PTY、命令分块上传不在本计划范围内。
- `uu_exec` 命令 UTF-8 长度上限为 16 KiB；默认超时 30 秒，允许范围 1–300 秒。
- 远程结果使用 Base64 分页；每页最多 384 个 Base64 字符，每行 48 字符，最多 8 行数据，以确保页面保守地留在可访问终端区域内。
- 同一个 request 的完整 marker 字面值不得直接出现在输入命令回显中；必须用 PowerShell 字符串拼接生成，避免命令回显造成假命中。
- 剪贴板必须在 Helper 内存中完整快照并在 `finally` 语义下恢复；原剪贴板内容不得通过 MCP 返回或写入日志。
- 只能关闭本进程明确记录为自己打开的终端；不得清理来源不明的其他 UU 会话。
- 默认日志只记录 request id、device id、耗时、命令长度/哈希和错误码，不记录完整命令、完整 stdout 或剪贴板。
- 新增的类、公共方法和复杂逻辑必须添加必要注释，解释职责、边界和非显然的实现原因。
- TypeScript 使用 ESM；Swift Helper 使用系统 Framework，不引入第三方 Swift 依赖。

---

## File Structure

最终 MVP 文件结构如下；任务中若无特别说明，不新增同职责的平行文件。

```text
uu-codex-mcp/
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── tsconfig.base.json
├── vitest.workspace.ts
├── .gitignore
├── README.md
├── scripts/
│   └── install-helper.mjs
├── packages/
│   ├── bridge-core/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── errors.ts
│   │   │   ├── types.ts
│   │   │   ├── config.ts
│   │   │   ├── logger.ts
│   │   │   ├── cli/
│   │   │   │   ├── runner.ts
│   │   │   │   ├── discovery.ts
│   │   │   │   ├── capabilities.ts
│   │   │   │   ├── devices.ts
│   │   │   │   └── adapter.ts
│   │   │   ├── protocol/
│   │   │   │   ├── markers.ts
│   │   │   │   ├── powershell.ts
│   │   │   │   └── result-pages.ts
│   │   │   ├── helper/
│   │   │   │   ├── protocol.ts
│   │   │   │   ├── client.ts
│   │   │   │   └── process.ts
│   │   │   ├── session/
│   │   │   │   ├── serial-executor.ts
│   │   │   │   └── owned-terminals.ts
│   │   │   └── transport/
│   │   │       ├── types.ts
│   │   │       └── gui-transport.ts
│   │   └── test/
│   │       ├── errors.test.ts
│   │       ├── cli-discovery.test.ts
│   │       ├── cli-capabilities.test.ts
│   │       ├── cli-devices.test.ts
│   │       ├── protocol.test.ts
│   │       ├── helper-client.test.ts
│   │       ├── serial-executor.test.ts
│   │       └── gui-transport.test.ts
│   └── mcp-server/
│       ├── package.json
│       ├── tsconfig.json
│       ├── src/
│       │   ├── main.ts
│       │   ├── server.ts
│       │   └── tools/
│       │       ├── list-devices.ts
│       │       ├── exec.ts
│       │       └── close-terminal.ts
│       └── test/
│           └── server.test.ts
├── native/
│   └── macos-helper/
│       ├── Package.swift
│       ├── Sources/UuDesktopHelper/
│       │   ├── main.swift
│       │   ├── HelperProtocol.swift
│       │   ├── HelperService.swift
│       │   ├── UnixSocketServer.swift
│       │   ├── AccessibilityProvider.swift
│       │   ├── WindowMatcher.swift
│       │   ├── InteractionStore.swift
│       │   ├── ClipboardController.swift
│       │   └── InputController.swift
│       └── Tests/UuDesktopHelperTests/
│           ├── HelperServiceTests.swift
│           ├── WindowMatcherTests.swift
│           └── ClipboardControllerTests.swift
└── tests/
    └── integration/
        └── uu-smoke.ts
```

---

### Task 1: Workspace Foundation, Shared Types, Errors, and Logging

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.workspace.ts`
- Create: `.gitignore`
- Create: `packages/bridge-core/package.json`
- Create: `packages/bridge-core/tsconfig.json`
- Create: `packages/bridge-core/src/errors.ts`
- Create: `packages/bridge-core/src/types.ts`
- Create: `packages/bridge-core/src/config.ts`
- Create: `packages/bridge-core/src/logger.ts`
- Create: `packages/bridge-core/src/index.ts`
- Test: `packages/bridge-core/test/errors.test.ts`

**Interfaces:**
- Produces: `UuError`, `UuErrorCode`, `UuDevice`, `ExecRequest`, `ExecResult`, `BridgeConfig`, `Logger`.
- Later tasks must import these types rather than redefining equivalent shapes.

- [ ] **Step 1: Create the pnpm/TypeScript workspace**

Root `package.json` must contain at least:

```json
{
  "name": "uu-codex-mcp",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "packageManager": "pnpm@10",
  "scripts": {
    "build": "pnpm -r build && pnpm helper:build",
    "test": "pnpm -r test && pnpm helper:test",
    "typecheck": "pnpm -r typecheck",
    "helper:build": "swift build -c release --package-path native/macos-helper",
    "helper:test": "swift test --package-path native/macos-helper",
    "helper:install": "node scripts/install-helper.mjs"
  },
  "devDependencies": {
    "typescript": "^5.9.0",
    "vitest": "^3.2.0"
  }
}
```

`pnpm-workspace.yaml`:

```yaml
packages:
  - packages/*
```

`tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "declaration": true,
    "sourceMap": true,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 2: Write the failing error-model test**

`packages/bridge-core/test/errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { UuError } from '../src/errors.js';

describe('UuError', () => {
  it('serializes stable MCP-safe error fields', () => {
    const error = new UuError('UU_DEVICE_OFFLINE', '目标设备当前离线', true, { deviceId: 'dev-1' });
    expect(error.toJSON()).toEqual({
      code: 'UU_DEVICE_OFFLINE',
      message: '目标设备当前离线',
      retryable: true,
      details: { deviceId: 'dev-1' },
    });
  });
});
```

- [ ] **Step 3: Run the test and verify failure**

Run:

```bash
pnpm install
pnpm --filter @uu-codex/bridge-core test -- errors.test.ts
```

Expected: FAIL because `UuError` does not exist.

- [ ] **Step 4: Implement shared types and exact error codes**

`errors.ts` must define this exact union:

```ts
export type UuErrorCode =
  | 'UU_CLI_NOT_FOUND'
  | 'UU_APP_NOT_RUNNING'
  | 'UU_DEVICE_NOT_FOUND'
  | 'UU_DEVICE_OFFLINE'
  | 'UU_DEVICE_PLATFORM_UNSUPPORTED'
  | 'UU_TERM_OPEN_FAILED'
  | 'UU_TERM_NOT_OWNED'
  | 'UU_TERM_WINDOW_NOT_FOUND'
  | 'UU_TERM_WINDOW_AMBIGUOUS'
  | 'UU_TERM_FOCUS_UNPROVEN'
  | 'UU_ACCESSIBILITY_PERMISSION_DENIED'
  | 'UU_GUI_SESSION_UNAVAILABLE'
  | 'UU_HELPER_UNAVAILABLE'
  | 'UU_HELPER_PROTOCOL_ERROR'
  | 'UU_CLIPBOARD_FAILED'
  | 'UU_COMMAND_TIMEOUT'
  | 'UU_RESULT_MARKER_TIMEOUT'
  | 'UU_RESULT_DECODE_FAILED'
  | 'UU_SESSION_CLOSE_FAILED'
  | 'UU_COMMAND_TOO_LONG'
  | 'UU_INVALID_ARGUMENT';

export class UuError extends Error {
  /** Stable machine-readable failure returned to MCP callers. */
  constructor(
    public readonly code: UuErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'UuError';
  }

  /** Convert the error to a JSON-safe shape without stack traces or secrets. */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
```

`types.ts` must define:

```ts
export type UuPlatform = 'windows' | 'macos' | 'linux' | 'unknown';

export interface UuDevice {
  id: string;
  name: string;
  platform: UuPlatform;
  online: boolean;
}

export interface ExecRequest {
  deviceId: string;
  command: string;
  timeoutMs: number;
}

export interface ExecResult {
  requestId: string;
  deviceId: string;
  stdout: string;
  success: boolean;
  exitCode: number | null;
  error: string | null;
  durationMs: number;
  transport: 'gui';
}
```

`config.ts` defaults:

```ts
export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const MIN_COMMAND_TIMEOUT_MS = 1_000;
export const MAX_COMMAND_TIMEOUT_MS = 300_000;
export const MAX_COMMAND_BYTES = 16 * 1024;
export const RESULT_PAGE_CHARS = 384;
export const RESULT_PAGE_LINE_CHARS = 48;
export const HELPER_SOCKET_PATH = `/tmp/uu-codex-mcp-${process.getuid?.() ?? process.pid}.sock`;
```

`logger.ts` must write only to `process.stderr`; expose `info(event, fields)`, `warn(...)`, `error(...)`. It must never log full command/stdout/clipboard.

- [ ] **Step 5: Run unit tests and typecheck**

```bash
pnpm --filter @uu-codex/bridge-core test
pnpm --filter @uu-codex/bridge-core typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.workspace.ts .gitignore packages/bridge-core
git commit -m "chore: scaffold bridge core workspace"
```

---

### Task 2: `uuyc-cli` Discovery, Device Parsing, and Capability Probe

**Files:**
- Create: `packages/bridge-core/src/cli/runner.ts`
- Create: `packages/bridge-core/src/cli/discovery.ts`
- Create: `packages/bridge-core/src/cli/capabilities.ts`
- Create: `packages/bridge-core/src/cli/devices.ts`
- Create: `packages/bridge-core/src/cli/adapter.ts`
- Test: `packages/bridge-core/test/cli-discovery.test.ts`
- Test: `packages/bridge-core/test/cli-capabilities.test.ts`
- Test: `packages/bridge-core/test/cli-devices.test.ts`

**Interfaces:**
- Produces: `CommandRunner.run(executable,args,timeoutMs)`, `discoverUuInstallation()`, `probeCliCapabilities()`, `normalizeDeviceList()`, `UuCliAdapter`.
- `discoverUuInstallation()` returns `{ cliPath: string; appBundlePath: string }`.
- `UuCliAdapter.listDevices(): Promise<UuDevice[]>`.
- `UuCliAdapter.openTerminal(deviceId): Promise<void>`.
- `UuCliAdapter.closeTerminal(deviceId): Promise<void>`.
- `UuCliAdapter.capabilities(): Promise<CliCapabilities>`.

- [ ] **Step 1: Write failing discovery tests**

Test the priority order:

```ts
it('prefers UU_CLI_PATH and derives the containing .app bundle', async () => {
  const result = await discoverUuInstallation({
    envPath: '/Applications/UURemote.app/Contents/MacOS/uuyc-cli',
    exists: async () => true,
    listApps: async () => [],
  });
  expect(result).toEqual({
    cliPath: '/Applications/UURemote.app/Contents/MacOS/uuyc-cli',
    appBundlePath: '/Applications/UURemote.app',
  });
});
```

Also test scanning one level under `/Applications` and `~/Applications`, and failure with `UU_CLI_NOT_FOUND`.

- [ ] **Step 2: Run discovery tests and verify failure**

```bash
pnpm --filter @uu-codex/bridge-core test -- cli-discovery.test.ts
```

Expected: FAIL because discovery functions do not exist.

- [ ] **Step 3: Implement shell-free command execution and discovery**

`CommandRunner` must use `execFile`/`spawn` with argument arrays; never concatenate a shell command string.

Discovery order:

1. `UU_CLI_PATH` if present and executable/file exists.
2. PATH lookup via `which uuyc-cli` using `/usr/bin/which`.
3. Scan direct `.app` children of `/Applications` and `$HOME/Applications`; accept an app only when `<app>/Contents/MacOS/uuyc-cli` exists.
4. Walk parents of the resolved CLI path until a `.app` ancestor is found.
5. Otherwise throw `UU_CLI_NOT_FOUND`.

- [ ] **Step 4: Write failing capability tests**

Use exact help fixtures:

```ts
const pipeHelp = `Usage: uuyc-cli term [options]\n--device-id <id>\n--new-session\n--shell <shell>\n--list-sessions`;
const legacyHelp = `Usage: uuyc-cli term <command>\nCommands:\n  open [device-id]\n  exit [device-id]`;

expect(parseCapabilities(pipeHelp, '', '')).toMatchObject({ termPipe: true });
expect(parseCapabilities(legacyHelp, 'Usage: term open [device-id]', 'Usage: term exit [device-id]')).toMatchObject({
  termPipe: false,
  termOpen: true,
  termExit: true,
});
```

Also detect `termExitClear` only if exit help contains `--clear`.

- [ ] **Step 5: Implement capability probing**

Define:

```ts
export interface CliCapabilities {
  termPipe: boolean;
  termOpen: boolean;
  termExit: boolean;
  termExitClear: boolean;
}
```

Probe these commands independently with 5 second timeouts:

```text
uuyc-cli term --help
uuyc-cli term open --help
uuyc-cli term exit --help
```

If a probe errors, use the text collected from stdout/stderr; never default an unknown capability to `true`.

- [ ] **Step 6: Write failing device-normalization tests**

Cover all known containers:

```ts
const fixtures = [
  { data: { devices: [{ deviceId: 'a', deviceName: 'A', isOnline: true, platform: 'windows' }] } },
  { data: { connections: [{ id: 'b', name: 'B', online: true, platform: 1 }] } },
  { data: { connected_devices: [{ device_id: 'c', device_name: 'C', status: 'online', platform: 'windows' }] } },
];
```

Expected normalized output uses `id`, `name`, `online`, `platform`. Numeric platform `1` maps to `windows`; unrecognized numeric values map to `unknown` rather than guessing.

- [ ] **Step 7: Implement `UuCliAdapter`**

Important behavior:

```ts
class UuCliAdapter {
  /** List and normalize all devices returned by the installed UU CLI variant. */
  async listDevices(): Promise<UuDevice[]> { /* ... */ }

  /** Open the UU main-app terminal window for exactly one device. */
  async openTerminal(deviceId: string): Promise<void> { /* term open */ }

  /** Close the terminal using the strongest supported legacy command. */
  async closeTerminal(deviceId: string): Promise<void> { /* term exit [--clear] */ }
}
```

`openTerminal` must reject when `termOpen === false`.
`closeTerminal` must append `--clear` only when `termExitClear === true`.

- [ ] **Step 8: Run tests and commit**

```bash
pnpm --filter @uu-codex/bridge-core test -- cli-discovery.test.ts cli-capabilities.test.ts cli-devices.test.ts
pnpm --filter @uu-codex/bridge-core typecheck
git add packages/bridge-core/src/cli packages/bridge-core/test/cli-*.test.ts
git commit -m "feat: add uu cli adapter and capability probe"
```

---

### Task 3: PowerShell Marker, Result Cache, and Base64 Paging Protocol

**Files:**
- Create: `packages/bridge-core/src/protocol/markers.ts`
- Create: `packages/bridge-core/src/protocol/powershell.ts`
- Create: `packages/bridge-core/src/protocol/result-pages.ts`
- Test: `packages/bridge-core/test/protocol.test.ts`

**Interfaces:**
- Produces: `createRequestId()`, `markersFor(requestId)`, `buildExecutionCommand(command, requestId)`, `parseMeta(text, markers)`, `buildPageCommand(requestId, offset)`, `parsePage(text, markers)`, `decodeRemoteResult(base64)`.
- `GuiTransport` in Task 8 relies on these exact names.

- [ ] **Step 1: Write marker tests that prevent false positives from command echo**

```ts
it('does not embed the complete output marker literal in the command text', () => {
  const requestId = '0123456789abcdef01234567';
  const markers = markersFor(requestId);
  const script = buildExecutionCommand('Write-Output "hello"', requestId);
  expect(script).not.toContain(markers.meta);
  expect(script).toContain("'__UU_META_' +");
});
```

`createRequestId()` must return 24 lowercase hex characters from 12 cryptographically random bytes.

- [ ] **Step 2: Write protocol round-trip tests**

Test:

- UTF-8 Chinese output.
- Empty output.
- JSON error string.
- Meta parsing from noisy text using `lastIndexOf` semantics.
- Page extraction from noisy text.
- Corrupt Base64 returns `UU_RESULT_DECODE_FAILED`.
- `buildPageCommand` emits no more than 8 payload lines of 48 chars each.

- [ ] **Step 3: Run tests and verify failure**

```bash
pnpm --filter @uu-codex/bridge-core test -- protocol.test.ts
```

Expected: FAIL because protocol functions do not exist.

- [ ] **Step 4: Implement exact remote result JSON contract**

Remote payload schema:

```ts
export interface RemoteCommandResult {
  stdout: string;
  success: boolean;
  exitCode: number | null;
  error: string | null;
}
```

The user command must first be UTF-8 → Base64 locally. Do not interpolate raw user PowerShell into the wrapper.

PowerShell wrapper must follow this behavior:

```powershell
$__uuCmd = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('<COMMAND_B64>'))
$__uuError = $null
$__uuExit = $null
$__uuSuccess = $true
$global:LASTEXITCODE = $null
try {
  $__uuItems = @(& ([scriptblock]::Create($__uuCmd)) 2>&1)
  $__uuPowerShellOk = $?
  $__uuText = ($__uuItems | Out-String)
  if ($null -ne $LASTEXITCODE) {
    $__uuExit = [int]$LASTEXITCODE
    $__uuSuccess = ($LASTEXITCODE -eq 0)
  } elseif (-not $__uuPowerShellOk) {
    $__uuExit = 1
    $__uuSuccess = $false
  } else {
    $__uuExit = 0
  }
} catch {
  $__uuText = ''
  $__uuError = ($_ | Out-String)
  $__uuExit = 1
  $__uuSuccess = $false
}
$__uuPayload = [ordered]@{
  stdout = $__uuText
  success = $__uuSuccess
  exitCode = $__uuExit
  error = $__uuError
} | ConvertTo-Json -Compress -Depth 4
$global:__uuResultB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($__uuPayload))
$__uuMarker = '__UU_META_' + '<REQUEST_ID>' + '__'
Clear-Host
Write-Output ($__uuMarker + ':' + $global:__uuResultB64.Length)
```

The actual generated script may be compacted to one line, but semantics must remain identical.

- [ ] **Step 5: Implement paging command generation**

For `offset`, calculate remote length with max 384 chars. Output at most 8 lines of 48 characters, bounded by begin/end markers constructed by concatenation.

Conceptual PowerShell:

```powershell
$__uuStart = 0
$__uuTake = [Math]::Min(384, $global:__uuResultB64.Length - $__uuStart)
$__uuChunk = $global:__uuResultB64.Substring($__uuStart, $__uuTake)
$__uuBegin = '__UU_PAGE_BEGIN_' + '<REQUEST_ID>' + '__'
$__uuEnd = '__UU_PAGE_END_' + '<REQUEST_ID>' + '__'
Clear-Host
Write-Output $__uuBegin
for ($i = 0; $i -lt $__uuChunk.Length; $i += 48) {
  Write-Output $__uuChunk.Substring($i, [Math]::Min(48, $__uuChunk.Length - $i))
}
Write-Output $__uuEnd
```

`parsePage` joins only text strictly between the last complete begin/end marker pair and strips whitespace around Base64 lines.

- [ ] **Step 6: Run protocol tests and commit**

```bash
pnpm --filter @uu-codex/bridge-core test -- protocol.test.ts
pnpm --filter @uu-codex/bridge-core typecheck
git add packages/bridge-core/src/protocol packages/bridge-core/test/protocol.test.ts
git commit -m "feat: add remote powershell result protocol"
```

---

### Task 4: Global Serialization and Owned-Terminal Safety

**Files:**
- Create: `packages/bridge-core/src/session/serial-executor.ts`
- Create: `packages/bridge-core/src/session/owned-terminals.ts`
- Test: `packages/bridge-core/test/serial-executor.test.ts`

**Interfaces:**
- Produces: `SerialExecutor.run<T>(task): Promise<T>`.
- Produces: `OwnedTerminals.markOpened(deviceId)`, `isOwned(deviceId)`, `markClosed(deviceId)`, `listOwned()`.

- [ ] **Step 1: Write failing serialization tests**

```ts
it('never overlaps two operations in MVP mode', async () => {
  const executor = new SerialExecutor();
  let active = 0;
  let maxActive = 0;
  await Promise.all([1, 2, 3].map(() => executor.run(async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 10));
    active -= 1;
  })));
  expect(maxActive).toBe(1);
});
```

Also test that a rejected task does not poison the queue.

- [ ] **Step 2: Implement serialization and ownership registry**

Use a promise chain, not a spin lock. `OwnedTerminals` is in-memory only; after process restart, no terminal is considered owned.

`uu_close_terminal` later must reject with `UU_TERM_NOT_OWNED` when `isOwned(deviceId)` is false.

- [ ] **Step 3: Run tests and commit**

```bash
pnpm --filter @uu-codex/bridge-core test -- serial-executor.test.ts
git add packages/bridge-core/src/session packages/bridge-core/test/serial-executor.test.ts
git commit -m "feat: add serialized session ownership"
```

---

### Task 5: Swift Desktop Helper JSON Protocol and Unix Socket Server

**Files:**
- Create: `native/macos-helper/Package.swift`
- Create: `native/macos-helper/Sources/UuDesktopHelper/main.swift`
- Create: `native/macos-helper/Sources/UuDesktopHelper/HelperProtocol.swift`
- Create: `native/macos-helper/Sources/UuDesktopHelper/HelperService.swift`
- Create: `native/macos-helper/Sources/UuDesktopHelper/UnixSocketServer.swift`
- Create: `native/macos-helper/Sources/UuDesktopHelper/InteractionStore.swift`
- Test: `native/macos-helper/Tests/UuDesktopHelperTests/HelperServiceTests.swift`

**Interfaces:**
- Helper listens on a filesystem Unix socket and consumes exactly one JSON object per newline.
- Request shape: `{ "id": string, "action": string, "args": object }`.
- Response shape: success `{ "id": string, "ok": true, "result": object }`; failure `{ "id": string, "ok": false, "error": { "code": string, "message": string, "retryable": bool } }`.
- Actions implemented by this task: `health`, `end_interaction`. Other actions may return `UU_HELPER_PROTOCOL_ERROR` until their task implements them.

- [ ] **Step 1: Create Swift package and write failing service tests**

`Package.swift` defines one executable target `UuDesktopHelper` and one test target.

Test decoding and response IDs:

```swift
func testHealthResponseKeepsRequestId() throws {
    let service = HelperService(/* fake dependencies */)
    let request = HelperRequest(id: "r1", action: "health", args: [:])
    let response = service.handle(request)
    XCTAssertEqual(response.id, "r1")
    XCTAssertTrue(response.ok)
}
```

Also test unknown action returns `UU_HELPER_PROTOCOL_ERROR`.

- [ ] **Step 2: Run Swift tests and verify failure**

```bash
swift test --package-path native/macos-helper
```

Expected: FAIL because Helper types do not exist.

- [ ] **Step 3: Implement protocol models and `HelperService` dispatch**

Use `Codable`. Errors sent over the socket must not include Swift stack traces.

`InteractionStore` stores only locally generated UUID interaction IDs and associated window handles/snapshots. It never accepts an arbitrary PID/window ID from Node as authoritative.

- [ ] **Step 4: Implement a bounded Unix Domain Socket server**

Requirements:

- Default socket path comes from `--socket <path>`; process exits if missing.
- On startup, if a path exists, remove it only when it is a Unix socket owned by the current uid and no live server accepts a connection.
- Bind/listen using Darwin Unix sockets.
- Immediately `chmod(path, 0o600)` after bind.
- Accept newline-delimited UTF-8 JSON.
- Maximum request line: 256 KiB; larger input closes the client connection.
- Process requests sequentially on a dedicated serial queue for MVP.
- Remove its own socket file on normal termination signals.

- [ ] **Step 5: Add method/class comments and run tests**

Every Swift class and public/internal method with non-trivial behavior must have `///` documentation describing its safety boundary.

```bash
swift test --package-path native/macos-helper
swift build -c release --package-path native/macos-helper
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add native/macos-helper
git commit -m "feat: add macos helper socket protocol"
```

---

### Task 6: Accessibility Window Matching, Focus, Clipboard Transaction, and Input

**Files:**
- Create: `native/macos-helper/Sources/UuDesktopHelper/AccessibilityProvider.swift`
- Create: `native/macos-helper/Sources/UuDesktopHelper/WindowMatcher.swift`
- Create: `native/macos-helper/Sources/UuDesktopHelper/ClipboardController.swift`
- Create: `native/macos-helper/Sources/UuDesktopHelper/InputController.swift`
- Modify: `native/macos-helper/Sources/UuDesktopHelper/HelperService.swift`
- Test: `native/macos-helper/Tests/UuDesktopHelperTests/WindowMatcherTests.swift`
- Test: `native/macos-helper/Tests/UuDesktopHelperTests/ClipboardControllerTests.swift`
- Modify: `native/macos-helper/Tests/UuDesktopHelperTests/HelperServiceTests.swift`

**Interfaces:**
- Adds helper actions: `begin_interaction`, `clipboard_snapshot`, `clipboard_set_text`, `clipboard_restore`, `paste`, `key_return`, `read_terminal_text`.
- `begin_interaction` args: `{ app_bundle_path: string, device_name: string }`; result: `{ interaction_id: string, window_title: string }`.
- All actions that manipulate/read the terminal require a valid `interaction_id` created by `begin_interaction`.

- [ ] **Step 1: Write pure window-matcher tests first**

Define pure input:

```swift
struct WindowSnapshot: Equatable {
    let handleId: UUID
    let title: String
    let role: String
    let focused: Bool
}
```

Tests:

- zero candidates → `UU_TERM_WINDOW_NOT_FOUND`;
- exactly one `AXWindow` whose title contains exact device name and one token from `终端`, `terminal`, `powershell`, `cmd` (case-insensitive where applicable) → success;
- more than one candidate → `UU_TERM_WINDOW_AMBIGUOUS`;
- a window from the right app but wrong device name does not match.

- [ ] **Step 2: Run matcher tests and verify failure**

```bash
swift test --package-path native/macos-helper --filter WindowMatcherTests
```

- [ ] **Step 3: Implement `AccessibilityProviding` and system provider**

Define an injectable protocol similar to:

```swift
protocol AccessibilityProviding {
    func isTrusted() -> Bool
    func listWindows(appBundlePath: String) throws -> [WindowSnapshot]
    func focus(windowId: UUID, appBundlePath: String) throws
    func readText(windowId: UUID, maxDepth: Int, maxNodes: Int) throws -> [String]
}
```

Production implementation requirements:

- `AXIsProcessTrusted()` must be true or return `UU_ACCESSIBILITY_PERMISSION_DENIED`.
- Identify the exact running UU process by comparing `NSRunningApplication.bundleURL` to the canonical `app_bundle_path`, not by guessing bundle ID.
- Use `AXUIElementCreateApplication(pid)` and `kAXWindowsAttribute`.
- Cache opaque `AXUIElement` values behind locally generated `UUID` handles; Node never supplies raw AX references/PIDs.
- Focus by activating the matching NSRunningApplication, raising the window, setting/checking focused state.
- After focus, re-read focus; if unproven return `UU_TERM_FOCUS_UNPROVEN`.
- Recursively collect `AXTitle`, `AXValue`, and `AXDescription` strings from the selected window, bounded to depth 10 and 2,000 nodes.

- [ ] **Step 4: Write clipboard preservation tests**

Do not expose clipboard contents over the socket. Model a snapshot token:

```swift
let snapshotId = try clipboard.snapshot()
try clipboard.setText("temporary command")
try clipboard.restore(snapshotId)
```

Test that multiple pasteboard item types are restored, not just plain text.

- [ ] **Step 5: Implement clipboard transaction and keyboard input**

`ClipboardController` stores pasteboard items in memory keyed by UUID snapshot IDs. `clipboard_snapshot` returns only the UUID.

`InputController` uses CoreGraphics keyboard events:

- Paste: keycode `9` (`V`) with `.maskCommand` down/up.
- Return: keycode `36` down/up.

No mouse coordinates are allowed.

- [ ] **Step 6: Implement HelperService action flow**

`begin_interaction` must:

1. verify Accessibility trust;
2. list windows only from the exact UU app path;
3. uniquely match target device terminal;
4. focus and verify it;
5. create an interaction record holding the selected local window handle.

`read_terminal_text` returns `{ strings: string[] }` for the selected interaction.

`end_interaction` removes the interaction handle only; it does not close UU itself.

- [ ] **Step 7: Run Swift tests and commit**

```bash
swift test --package-path native/macos-helper
swift build -c release --package-path native/macos-helper
git add native/macos-helper
git commit -m "feat: automate uu terminal with macos accessibility"
```

---

### Task 7: Node Desktop Helper Client, Process Bootstrap, and Fixed Install Path

**Files:**
- Create: `packages/bridge-core/src/helper/protocol.ts`
- Create: `packages/bridge-core/src/helper/client.ts`
- Create: `packages/bridge-core/src/helper/process.ts`
- Create: `scripts/install-helper.mjs`
- Test: `packages/bridge-core/test/helper-client.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `DesktopHelperClient.call(action,args)`, typed convenience methods, and `ensureDesktopHelper()`.
- Default installed binary path: `$HOME/.local/share/uu-codex-mcp/bin/uu-desktop-helper`.
- Environment override: `UU_DESKTOP_HELPER_PATH`.
- Default socket: `HELPER_SOCKET_PATH` from Task 1; environment override `UU_HELPER_SOCKET_PATH`.

- [ ] **Step 1: Write failing client protocol tests using a temporary Unix socket**

Test:

```ts
const result = await client.health();
expect(result).toEqual({ status: 'ok' });
```

Also test:

- mismatched response id → `UU_HELPER_PROTOCOL_ERROR`;
- malformed JSON → same error;
- connection refused → `UU_HELPER_UNAVAILABLE`;
- timeout → `UU_HELPER_UNAVAILABLE`.

- [ ] **Step 2: Implement one-request-per-connection JSONL client**

Use `node:net.createConnection({ path })`.

Each call:

1. generate local request UUID;
2. connect;
3. write one JSON line;
4. read until first newline;
5. enforce response max 1 MiB;
6. validate id/ok/result/error;
7. close socket.

Expose typed methods:

```ts
health(): Promise<void>
beginInteraction(appBundlePath: string, deviceName: string): Promise<{ interactionId: string; windowTitle: string }>
clipboardSnapshot(): Promise<string>
clipboardSetText(text: string): Promise<void>
clipboardRestore(snapshotId: string): Promise<void>
paste(interactionId: string): Promise<void>
keyReturn(interactionId: string): Promise<void>
readTerminalText(interactionId: string): Promise<string[]>
endInteraction(interactionId: string): Promise<void>
```

- [ ] **Step 3: Implement helper bootstrap**

`ensureDesktopHelper()`:

1. try `health()` first;
2. if unavailable, resolve installed binary path;
3. spawn `[binary, '--socket', socketPath]` without shell;
4. pipe helper stdout/stderr to Node stderr logger only;
5. poll `health()` for up to 3 seconds at 100 ms intervals;
6. if still unavailable, throw `UU_HELPER_UNAVAILABLE`.

Do not daemonize; MCP owns the helper child lifetime when it starts it.

- [ ] **Step 4: Implement install script**

`scripts/install-helper.mjs`:

- source: `native/macos-helper/.build/release/uu-desktop-helper`;
- destination: `$HOME/.local/share/uu-codex-mcp/bin/uu-desktop-helper`;
- mkdir recursively with user-only writable directory permissions;
- copy atomically using temporary sibling + rename;
- chmod executable `0755`;
- print the final path and explicit instruction to add that executable in macOS **System Settings → Privacy & Security → Accessibility**.

It must not invoke `tccutil` or attempt to bypass the user permission prompt.

- [ ] **Step 5: Run tests/build/install smoke and commit**

```bash
pnpm --filter @uu-codex/bridge-core test -- helper-client.test.ts
pnpm helper:build
pnpm helper:install
pnpm --filter @uu-codex/bridge-core typecheck
git add packages/bridge-core/src/helper packages/bridge-core/test/helper-client.test.ts scripts/install-helper.mjs package.json
git commit -m "feat: connect bridge core to desktop helper"
```

---

### Task 8: GuiTransport End-to-End Orchestration and Cleanup

**Files:**
- Create: `packages/bridge-core/src/transport/types.ts`
- Create: `packages/bridge-core/src/transport/gui-transport.ts`
- Test: `packages/bridge-core/test/gui-transport.test.ts`
- Modify: `packages/bridge-core/src/index.ts`

**Interfaces:**
- Produces: `RemoteTransport` and `GuiTransport`.
- `GuiTransport.execute(request: ExecRequest): Promise<ExecResult>`.
- `GuiTransport.closeOwnedTerminal(deviceId: string): Promise<void>`.

- [ ] **Step 1: Define the transport interface and write the first failing happy-path test**

```ts
export interface RemoteTransport {
  execute(request: ExecRequest): Promise<ExecResult>;
  closeOwnedTerminal(deviceId: string): Promise<void>;
}
```

Test with fakes in exact lifecycle order:

```text
listDevices
openTerminal
markOwned
beginInteraction
clipboardSnapshot
clipboardSetText(execution wrapper)
paste
keyReturn
readTerminalText(meta)
clipboardSetText(page command)
paste
keyReturn
readTerminalText(page)
clipboardRestore
endInteraction
closeTerminal
markClosed
```

Expected `ExecResult.transport === 'gui'`.

- [ ] **Step 2: Write all failure/cleanup tests before implementation**

Required tests:

1. missing exact device → `UU_DEVICE_NOT_FOUND`, terminal never opens;
2. offline device → `UU_DEVICE_OFFLINE`;
3. non-Windows/unknown platform → `UU_DEVICE_PLATFORM_UNSUPPORTED`;
4. command >16 KiB UTF-8 → `UU_COMMAND_TOO_LONG` before terminal open;
5. helper begin interaction failure still closes owned terminal;
6. marker timeout restores clipboard, ends interaction, closes terminal;
7. Base64 decode failure performs the same cleanup;
8. clipboard restore failure is logged but must not mask an earlier command failure;
9. close failure after a successful command returns `UU_SESSION_CLOSE_FAILED` only if no earlier error occurred;
10. two concurrent execute calls are globally serialized.

- [ ] **Step 3: Implement validation and target selection**

`execute()` must run inside `SerialExecutor.run` and validate timeout bounds.

Device matching is exact `device.id === request.deviceId` only. Do not silently resolve a name.

- [ ] **Step 4: Implement terminal open and interaction acquisition with bounded retry**

After successful `openTerminal`, immediately mark ownership.

`beginInteraction` may initially fail with `UU_TERM_WINDOW_NOT_FOUND` while the GUI appears. Retry only that error for up to 10 seconds using 250 ms delay. Do not retry ambiguity/focus/accessibility errors.

- [ ] **Step 5: Implement clipboard-safe command send helper**

Within one interaction:

```ts
async function sendCommand(text: string): Promise<void> {
  await helper.clipboardSetText(text);
  await helper.paste(interactionId);
  await helper.keyReturn(interactionId);
}
```

Take exactly one clipboard snapshot before the first send. Restore exactly once in outer `finally`.

- [ ] **Step 6: Implement meta polling and page polling**

Polling helper text:

- interval: 150 ms;
- search joined accessible strings plus each individual string;
- use `parseMeta`/`parsePage` from Task 3 with `lastIndexOf` to prefer newest complete marker pair;
- meta and all pages share the caller timeout budget using a monotonic deadline;
- timeout maps to `UU_RESULT_MARKER_TIMEOUT` or `UU_COMMAND_TIMEOUT` as appropriate.

After meta length `N`, loop offsets `0, 384, 768, ...` until exactly `N` Base64 characters are assembled. Any overrun/underrun before decode is `UU_RESULT_DECODE_FAILED`.

- [ ] **Step 7: Implement strict cleanup precedence**

Cleanup order in `finally`:

1. restore clipboard snapshot if created;
2. end helper interaction if created;
3. if terminal is owned, `uuyc-cli term exit` and unmark it only after successful/terminal-already-gone close.

Preserve the first operational error. Cleanup errors go to stderr logger with request id; only surface a cleanup error when the main operation otherwise succeeded.

- [ ] **Step 8: Implement `closeOwnedTerminal`**

If not owned: throw `UU_TERM_NOT_OWNED` and do not invoke CLI.

If owned: close via adapter; mark closed on success.

- [ ] **Step 9: Run tests and commit**

```bash
pnpm --filter @uu-codex/bridge-core test -- gui-transport.test.ts
pnpm --filter @uu-codex/bridge-core test
pnpm --filter @uu-codex/bridge-core typecheck
git add packages/bridge-core/src/transport packages/bridge-core/src/index.ts packages/bridge-core/test/gui-transport.test.ts
git commit -m "feat: execute powershell through uu gui transport"
```

---

### Task 9: MCP stdio Server and Three Public Tools

**Files:**
- Create: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/tsconfig.json`
- Create: `packages/mcp-server/src/main.ts`
- Create: `packages/mcp-server/src/server.ts`
- Create: `packages/mcp-server/src/tools/list-devices.ts`
- Create: `packages/mcp-server/src/tools/exec.ts`
- Create: `packages/mcp-server/src/tools/close-terminal.ts`
- Test: `packages/mcp-server/test/server.test.ts`

**Interfaces:**
- MCP tools: `uu_list_devices`, `uu_exec`, `uu_close_terminal`.
- Uses MCP v2 stable packages: `@modelcontextprotocol/server` and `zod/v4`.

- [ ] **Step 1: Create package dependencies and write failing registration test**

`packages/mcp-server/package.json` must depend on:

```json
{
  "dependencies": {
    "@modelcontextprotocol/server": "^2.0.0",
    "@uu-codex/bridge-core": "workspace:*",
    "zod": "^4.0.0"
  }
}
```

Test server construction through an injected fake bridge/transport; assert all three tool registrations are present without spawning real UU/helper processes.

- [ ] **Step 2: Implement `uu_list_devices`**

Register with `McpServer.registerTool` and empty Zod input object.

Result text must be JSON matching:

```json
{
  "devices": [
    { "id": "dev-1", "name": "客户A", "platform": "windows", "online": true }
  ]
}
```

- [ ] **Step 3: Implement `uu_exec` input validation**

Zod schema:

```ts
z.object({
  device_id: z.string().min(1),
  command: z.string().min(1),
  timeout_ms: z.number().int().min(1_000).max(300_000).optional(),
})
```

Default `timeout_ms` to 30,000 before calling bridge transport.

Successful JSON content follows `ExecResult` with snake_case MCP field names:

```json
{
  "request_id": "...",
  "device_id": "...",
  "stdout": "...",
  "success": true,
  "exit_code": 0,
  "error": null,
  "duration_ms": 4200,
  "transport": "gui"
}
```

- [ ] **Step 4: Implement structured MCP errors**

Catch `UuError`; return tool result with `isError: true` and one JSON text content object containing `error.toJSON()`.

Unexpected errors must be wrapped as `UU_HELPER_PROTOCOL_ERROR` or a generic safe internal message without stack/path secrets; full stack may be written to stderr in development logging only.

- [ ] **Step 5: Implement `uu_close_terminal`**

Schema: `{ device_id: z.string().min(1) }`.

Success result:

```json
{ "device_id": "dev-1", "closed": true }
```

It must call `closeOwnedTerminal`; never call CLI directly.

- [ ] **Step 6: Implement stdio entrypoint**

Use current MCP v2 API:

```ts
import { McpServer } from '@modelcontextprotocol/server';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';

const server = createServer(/* dependencies */);
const transport = new StdioServerTransport();
await server.connect(transport);
```

Before connecting, initialize/discover CLI and ensure helper only when a GUI execution is first requested; `uu_list_devices` must work without Accessibility permission.

- [ ] **Step 7: Test stdout discipline**

Spawn the built MCP process in a test with stderr captured. Assert application logs are emitted on stderr and no `console.log`/plain diagnostics are emitted on stdout outside MCP protocol traffic.

- [ ] **Step 8: Run tests and commit**

```bash
pnpm --filter @uu-codex/mcp-server test
pnpm --filter @uu-codex/mcp-server typecheck
pnpm --filter @uu-codex/mcp-server build
git add packages/mcp-server
git commit -m "feat: expose uu remote tools over mcp stdio"
```

---

### Task 10: Doctor/Diagnostics Without Remote Mutation

**Files:**
- Create: `packages/mcp-server/src/doctor.ts`
- Modify: `packages/mcp-server/package.json`
- Create: `packages/mcp-server/test/doctor.test.ts`
- Modify: `packages/bridge-core/src/index.ts`

**Interfaces:**
- CLI command: `node dist/doctor.js`.
- Read-only checks only; never opens a remote terminal.

- [ ] **Step 1: Write failing doctor test**

With fake dependencies, expected JSON:

```json
{
  "cli_found": true,
  "app_bundle_found": true,
  "device_list_ok": true,
  "term_open_supported": true,
  "term_pipe_supported": false,
  "helper_binary_found": true,
  "helper_reachable": true,
  "accessibility_trusted": true
}
```

Each field must remain present even when another check fails; include an `errors` array with safe error codes/messages.

- [ ] **Step 2: Expose a helper `health` result with accessibility trust state**

Extend Helper `health` result to:

```json
{ "status": "ok", "accessibility_trusted": true }
```

Doctor may start the local helper but must not call `term open`.

- [ ] **Step 3: Implement doctor command and package script**

Add:

```json
"doctor": "node dist/doctor.js"
```

The command prints exactly one JSON document to stdout because it is a standalone diagnostic process, not the MCP stdio process.

- [ ] **Step 4: Run tests and commit**

```bash
pnpm --filter @uu-codex/mcp-server test -- doctor.test.ts
pnpm --filter @uu-codex/mcp-server build
git add packages/mcp-server native/macos-helper packages/bridge-core/src/index.ts
git commit -m "feat: add read-only uu diagnostics"
```

---

### Task 11: Real UU Smoke Harness and Reliability Matrix

**Files:**
- Create: `tests/integration/uu-smoke.ts`
- Modify: `package.json`
- Create: `tests/integration/README.md`

**Interfaces:**
- Integration runner requires environment variable `UU_TEST_DEVICE_ID` pointing to an authorized Windows test machine.
- It invokes the Bridge Core directly, not through UI automation external to the project.

- [ ] **Step 1: Implement a guarded integration runner**

If `UU_TEST_DEVICE_ID` is absent, exit with code 2 and message on stderr explaining that no remote action was attempted.

Add root script:

```json
"test:uu": "tsx tests/integration/uu-smoke.ts"
```

Add `tsx` as dev dependency.

- [ ] **Step 2: Encode the mandatory integration matrix**

Run these cases sequentially; fail immediately on wrong device/platform/offline:

```ts
const cases = [
  ['hostname', 'hostname'],
  ['chinese', "Write-Output '你好世界'"],
  ['empty', '$null'],
  ['powershell-error', "Write-Error 'EXPECTED_PS_ERROR'"],
  ['native-nonzero', "cmd /c 'exit 7'"],
  ['special-chars', "Write-Output 'a$b | c; d'; Write-Output 'quote\"double'; Write-Output \"it's-ok\""],
  ['many-lines', "1..120 | ForEach-Object { 'LINE-' + $_ }"],
  ['long-line', "Write-Output ('X' * 240 + '-END')"],
];
```

Assertions:

- hostname non-empty;
- Chinese exact substring;
- empty output does not time out;
- PowerShell error appears and success is false when wrapper semantics detect failure;
- native exit code equals 7;
- all special strings survive;
- lines 1 and 120 survive and count is 120;
- long line ends with `-END`.

- [ ] **Step 3: Add timeout/recovery cases**

Run a command exceeding a 2 second timeout:

```powershell
Start-Sleep -Seconds 5; Write-Output 'TOO-LATE'
```

Expect timeout error and then immediately run `Write-Output 'RECOVERED'`; it must succeed after cleanup/reopen.

- [ ] **Step 4: Add 10x stability loop and clipboard verification**

Before loop, user places a known benign test string in clipboard using the harness itself. Take local clipboard value, run 10 executions, then assert it is unchanged.

Each loop executes:

```powershell
Write-Output ('RUN-' + <loop-index>)
```

Assert 10/10 success and no locally owned terminal remains in `OwnedTerminals`.

- [ ] **Step 5: Document human-only negative tests**

`tests/integration/README.md` must list steps for:

- target device offline;
- Accessibility permission revoked;
- Mac screen locked;
- manually create two matching UU terminal windows to confirm ambiguous fail-closed;
- close terminal while command is running and verify next command recovers.

Record expected error code for each.

- [ ] **Step 6: Run the harness on an authorized test device**

First run unit suites:

```bash
pnpm test
pnpm typecheck
pnpm build
```

Then set the environment variable to the exact ID selected from `uu_list_devices` and run:

```bash
pnpm test:uu
```

Expected: all automated cases PASS; no project-owned UU terminal remains open; original clipboard restored.

- [ ] **Step 7: Commit**

```bash
git add tests/integration package.json pnpm-lock.yaml
git commit -m "test: add uu remote end-to-end smoke suite"
```

---

### Task 12: README, Codex Configuration, Security Notes, and Final Verification

**Files:**
- Create: `README.md`
- Modify: `.gitignore`
- Modify: `packages/mcp-server/package.json`

**Interfaces:**
- User-facing install/start/configuration docs only; no new runtime feature.

- [ ] **Step 1: Document prerequisites and installation**

README must state:

- macOS host with unlocked GUI session;
- UU Remote installed/running/logged in;
- customer Windows only needs UU Remote controlled client;
- Node.js 20+, pnpm, Xcode Command Line Tools/Swift;
- build helper → install helper → grant Accessibility permission → run doctor.

Commands:

```bash
pnpm install
pnpm build
pnpm helper:install
pnpm --filter @uu-codex/mcp-server doctor
```

- [ ] **Step 2: Document Codex MCP configuration**

Document the built server entrypoint, using an absolute path in the user's Codex MCP configuration. Do not hardcode a developer-specific home directory; show how to obtain the path with `pwd` and compose it.

The runtime command is:

```text
node <repo-absolute-path>/packages/mcp-server/dist/main.js
```

Environment variables section:

```text
UU_CLI_PATH                 optional explicit uuyc-cli path
UU_DESKTOP_HELPER_PATH      optional helper binary override
UU_HELPER_SOCKET_PATH       optional short Unix socket path override
```

- [ ] **Step 3: Document operation and security boundaries**

README must explicitly state:

- `uu_exec` is equivalent to remote PowerShell authority of the logged-in UU session;
- device id is exact and required;
- no raw command/stdout/clipboard logging by default;
- GUI focus ambiguity fails closed;
- no OCR/coordinate fallback;
- only owned terminals are closed;
- Mac lock screen / no GUI session is unsupported;
- CLI capability is probed dynamically; `CLI 1.0.0` version string alone is not meaningful.

- [ ] **Step 4: Document future PipeTransport boundary without implementing it**

State that `RemoteTransport` is intentionally abstracted. When macOS `uuyc-cli term --device-id ... --new-session --shell powershell` becomes available and is capability-probed, implement `PipeTransport` as a separate follow-up plan. Do not silently enable an untested pipe path in this MVP.

- [ ] **Step 5: Run complete automated verification**

```bash
pnpm test
pnpm typecheck
pnpm build
swift test --package-path native/macos-helper
```

Expected: all PASS.

- [ ] **Step 6: Perform no-placeholder/no-secret scan**

Run:

```bash
grep -RInE 'TODO|TBD|FIXME' packages native scripts tests README.md || true
git grep -nE '(password|token|secret)[[:space:]]*=' -- ':!pnpm-lock.yaml' || true
```

Review every match; there must be no unfinished implementation placeholders and no committed credentials/device IDs.

- [ ] **Step 7: Final functional acceptance**

On an authorized Windows test device, verify from Codex itself:

1. `uu_list_devices` returns the device.
2. `uu_exec` with `hostname` returns expected remote hostname.
3. `uu_exec` with 120-line output returns all 120 lines.
4. a timeout is reported structurally and the next command succeeds.
5. local clipboard content is unchanged afterward.
6. `uu_close_terminal` refuses an unowned device/session.
7. UU contains no project-owned terminal left open after normal completion.

- [ ] **Step 8: Commit documentation**

```bash
git add README.md .gitignore packages/mcp-server/package.json
git commit -m "docs: add uu codex mcp setup and operations"
```

---

## Final Review Gate

Before declaring implementation complete, invoke `superpowers:verification-before-completion` and verify evidence for all of the following:

```text
[ ] pnpm test passes
[ ] pnpm typecheck passes
[ ] pnpm build passes
[ ] Swift tests pass
[ ] doctor reports expected macOS capability state
[ ] real hostname test passes
[ ] Chinese output passes
[ ] 120-line pagination passes
[ ] 240-char long-line case passes
[ ] timeout → cleanup → recovery passes
[ ] 10 sequential executions pass
[ ] clipboard restored
[ ] no unowned session is closed
[ ] no project-owned terminal remains
[ ] MCP logs do not corrupt stdout
[ ] customer Windows has no new server/agent installed
```

Only after this gate should the branch be considered ready for review/merge.
