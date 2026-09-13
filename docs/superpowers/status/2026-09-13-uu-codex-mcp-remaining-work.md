# UU Codex MCP 当前状态与待完成事项

日期：2026-09-13

## 1. 当前分支

- 功能分支：`feat/uu-codex-mcp-mvp`
- 合并目标：`master`
- 设计文档：`docs/superpowers/specs/2026-09-12-uu-codex-mcp-design.md`
- 实施计划：`docs/superpowers/plans/2026-09-12-uu-codex-mcp.md`

本分支已经完成 MVP 的主要代码实现。客户 Windows 仍只需要安装网易 UU 远程被控端，不需要部署 MCP Server、Agent、SSH Server、HTTP Server 或其他常驻服务。

## 2. 已完成内容

### 2.1 Bridge Core

已经完成：

- Node.js 20+ / TypeScript / pnpm workspace 基础工程。
- 稳定的 `UuError` 错误码和安全日志模型。
- `uuyc-cli` 自动发现。
- `device list` 多版本 JSON 兼容：`devices` / `connections` / `connected_devices`。
- capability probe：根据 `term --help` / `term open --help` / `term exit --help` 判断能力，不根据版本号猜测。
- `term open` / `term exit` 适配。
- 修复 UU CLI 某些失败场景 exit code 仍为 0 的问题：同时检查显式错误文本和 JSON `success=false`。
- 全局串行执行。
- 本进程拥有的 UU Terminal ownership 管理。
- PowerShell wrapper：原始命令先 UTF-8 → Base64，不直接插值到包装脚本。
- request marker + Base64 结果缓存 + 分页协议。
- 每页最多 384 个 Base64 字符，每行 48 字符。
- Windows PowerShell 5.1 兼容的 `$?` / `$LASTEXITCODE` 结果判断。
- `GuiTransport` 的超时、分页、解码、cleanup 和错误优先级。

### 2.2 macOS Desktop Helper

已经完成 Swift Helper：

- 本地 Unix Domain Socket JSONL 协议。
- socket 权限 `0600`。
- 最大请求 256 KiB。
- 只删除本进程成功 bind 的 socket 文件。
- Accessibility 权限检查。
- 按 UU `.app` 的准确路径定位运行进程。
- AX Window 枚举和终端窗口匹配。
- 设备名边界匹配，避免例如 `PC` 错配到 `PC2 - Terminal`。
- 多候选窗口 fail closed。
- 每次 Paste / Return 前重新聚焦并验证目标窗口。
- 不使用 OCR、截图识别、鼠标坐标或固定位置点击。
- 完整剪贴板快照，保存各种 pasteboard representation，而不只是文本。
- clipboard restore 失败时保留 snapshot，允许再次恢复。
- 仅通过本地 UUID 暴露 interaction/window handle，不把 PID 或 AX 引用交给 Node。

### 2.3 Node ↔ Swift Helper

已经完成：

- 一请求一连接的 Unix Socket JSONL Client。
- 1 MiB 响应上限。
- request id 校验。
- malformed JSON / timeout / socket failure 统一错误映射。
- Helper 健康探测和按需启动。
- Helper 安装路径：`$HOME/.local/share/uu-codex-mcp/bin/uu-desktop-helper`。
- 启动失败、超时和子进程退出处理。
- MCP 生命周期结束时，只清理本 MCP 自己启动的 Helper 子进程。

### 2.4 MCP Server

已经完成 3 个公开工具：

- `uu_list_devices`
- `uu_exec`
- `uu_close_terminal`

其它已完成内容：

- MCP stdio Server。
- `uu_list_devices` 不要求 Accessibility 权限，也不会启动 Helper。
- `uu_exec` 首次使用 GUI 时再按需启动 Helper。
- MCP 输出使用结构化 JSON text content。
- UuError 映射为稳定的 `isError: true` 工具结果。
- stdout 保留给 MCP 协议，应用日志写 stderr。
- stdio 生命周期结束及 SIGINT / SIGTERM 时清理本进程拥有的 Helper。

### 2.5 Doctor 与真实 Smoke 脚本

已经完成：

- `doctor` 只做本机只读检查，不执行 `term open`。
- 检查 CLI、app bundle、device list、term capability、Helper binary、Helper health 和 Accessibility trust。
- `tests/integration/uu-smoke.ts`。
- smoke matrix 包含：
  - `hostname`
  - 中文输出
  - 空输出
  - PowerShell 错误
  - native non-zero exit code
  - 特殊字符
  - 120 行分页
  - 240 字符长行
  - timeout → cleanup → recovery
  - 连续执行 10 次
  - 剪贴板恢复
  - owned terminal 最终清理检查

### 2.6 文档

已经完成：

- README 安装与使用说明。
- Codex MCP 配置示例。
- 安全边界和已知限制。
- Design spec。
- Implementation plan。
- 真实集成测试说明。

## 3. 当前验证结果

### 已在当前执行环境验证

Swift Helper 使用当前分支代码重新执行：

```text
swift test
12 tests
0 failures

swift build -c release
Build complete
```

这覆盖 Swift 协议、socket、纯窗口匹配、clipboard、HelperService 等可在 Linux 条件编译环境运行的部分。

另外，针对最终 review 修复的以下行为已做定向回归检查：

- UU CLI exit code=0 但显式返回错误。
- Windows PowerShell 5.1 的错误状态捕获。
- 设备名 `PC` / `PC2` 前缀碰撞。
- Clipboard restore 失败后重试。
- MCP / Helper 生命周期清理逻辑。

### 当前环境无法完成的验证

当前执行容器无法正常访问 npm/GitHub 网络，不能在这里完成干净环境下的：

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

因此不能把 TypeScript / MCP 全量 suite 声称为已经在当前 HEAD 上完整通过。

另外 Linux 不能真实验证以下 macOS-only 路径：

- AppKit。
- ApplicationServices / Accessibility。
- `AXUIElement` 真实 UU Terminal Tree。
- `NSPasteboard`。
- CoreGraphics 键盘事件。
- 真正的 `Mac → UU Remote → Windows PowerShell` 链路。

## 4. 合并前必须完成的事项

建议在实际使用的 Mac 上执行以下步骤。

### 4.1 安装依赖并生成 lockfile

```bash
git checkout feat/uu-codex-mcp-mvp
corepack enable
pnpm install
```

确认生成并提交：

```text
pnpm-lock.yaml
```

然后执行：

```bash
pnpm typecheck
pnpm test
pnpm build
```

验收要求：全部 exit code 0。

### 4.2 安装 Desktop Helper

```bash
pnpm helper:install
```

然后在：

```text
macOS 系统设置
→ 隐私与安全性
→ 辅助功能
```

允许：

```text
$HOME/.local/share/uu-codex-mcp/bin/uu-desktop-helper
```

### 4.3 执行 doctor

```bash
pnpm --filter @uu-codex/mcp-server doctor
```

期望至少确认：

- `cli_found = true`
- `app_bundle_found = true`
- `device_list_ok = true`
- `term_open_supported = true`
- `helper_binary_found = true`
- `helper_reachable = true`
- `accessibility_trusted = true`

`term_pipe_supported = false` 对当前 macOS CLI 是允许状态，因为 MVP 使用 `GuiTransport`。

### 4.4 真实 Windows 授权测试机 smoke

仅使用明确授权的测试 Windows：

```bash
export UU_TEST_DEVICE_ID='<exact-authorized-windows-device-id>'
pnpm test:uu
```

要求最终出现：

```text
UU SMOKE PASS
```

并确认：

- 测试结束后没有项目遗留的 owned UU Terminal。
- Mac 原剪贴板正确恢复。
- timeout 后下一条命令可以恢复执行。
- 中文、长输出、native exit code 均正确。

## 5. 建议的合并门槛

满足以下条件后再合并到 `master`：

- [ ] `pnpm-lock.yaml` 已生成并提交。
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm test` 通过。
- [ ] `pnpm build` 通过。
- [ ] macOS Helper 已成功安装并取得 Accessibility 权限。
- [ ] `doctor` 关键项通过。
- [ ] `pnpm test:uu` 在授权 Windows 测试机上显示 `UU SMOKE PASS`。
- [ ] 对真实测试期间发现的 UU UI / Accessibility Tree 差异已经修复并补测试。

## 6. 暂不在本 PR 实现的后续能力

以下属于后续版本，不作为当前 MVP 合并阻塞项：

- `PipeTransport`：等 macOS 官方 CLI 暴露真正 stdin/stdout pipe 后单独实现和验证。
- 小文件读写。
- 交互式 PTY。
- 多设备并发。
- 超过 16 KiB 的命令分块上传。
- 大文件传输。
- UU 私有 XPC / 网络协议逆向。

## 7. 当前结论

当前分支已经具备完整的 MVP 代码结构、主要安全边界、MCP 工具、macOS Helper、远程结果协议、诊断工具和真实 smoke harness。

剩余工作的重点不是继续增加功能，而是：

1. 在可联网的真实 Mac 上完成 Node/pnpm 的干净构建与全量测试；
2. 完成 macOS Accessibility 的真实运行验证；
3. 在一台授权 Windows 测试设备上完成 UU 端到端 smoke；
4. 根据实机结果做最后兼容修复后再合并。
