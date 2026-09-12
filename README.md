# uu-codex-mcp

让 macOS 上的 Codex CLI 通过网易 UU 远程控制客户 Windows 的 PowerShell，同时 **客户 Windows 只需要安装 UU 远程被控端**。

当前 macOS 版 `uuyc-cli` 在已验证环境中只暴露 `term open <device-id>` / `term exit <device-id>`，没有可编程 stdin/stdout 终端管道。本项目因此在 Mac 本地使用：

```text
Codex CLI
   │ MCP stdio
   ▼
uu-codex-mcp (Node.js / TypeScript)
   │
   ├─ uuyc-cli：设备查询、term open / term exit
   │
   └─ Unix Domain Socket
        ▼
   uu-desktop-helper (Swift)
        │ macOS Accessibility + Clipboard + Keyboard
        ▼
   UU Remote Terminal
        │ UU 官方远程通道
        ▼
   Customer Windows / PowerShell
```

客户机不需要安装 MCP Server、Agent、SSH Server、HTTP Server 或其他常驻服务。

## 当前 MVP

提供 3 个 MCP 工具：

- `uu_list_devices`：列出 UU 账号可见设备。
- `uu_exec`：对指定 **device ID** 的在线 Windows 设备执行 PowerShell，并返回结构化结果。
- `uu_close_terminal`：只关闭当前 `uu-codex-mcp` 进程明确拥有的终端；拒绝关闭未知/外部会话。

不在 MVP 范围：文件传输、交互 PTY、多设备并发、OCR/坐标点击、私有 UU 协议逆向。

## 前置条件

主控 Mac：

- macOS，图形桌面已登录且保持解锁。
- UU 远程已安装、运行并登录。
- Node.js 20+。
- pnpm 10+。
- Xcode Command Line Tools / Swift 工具链。

客户 Windows：

- 只需要安装并运行 UU 远程被控端。
- 不需要开放 SSH、HTTP、WebSocket 或其他新的监听服务。

## 安装

```bash
pnpm install
pnpm build
pnpm helper:install
```

`pnpm helper:install` 会把 release Helper 安装到：

```text
$HOME/.local/share/uu-codex-mcp/bin/uu-desktop-helper
```

然后在 macOS：

**系统设置 → 隐私与安全性 → 辅助功能**

将上面的 `uu-desktop-helper` 加入并允许访问。项目不会调用 `tccutil` 绕过用户授权。

### 诊断

```bash
pnpm --filter @uu-codex/mcp-server doctor
```

`doctor` 只做本机/只读检查，包括：

- 是否找到 `uuyc-cli` 与 UU `.app`。
- `device list` 是否正常。
- 当前 CLI 是否支持 `term open`。
- 当前 CLI 是否已经出现 pipe terminal 能力。
- Desktop Helper 是否已安装、可连接。
- Accessibility 是否已授权。

`doctor` **不会执行 `term open`，也不会对客户 Windows 发命令**。

## Codex CLI 配置

先获取仓库绝对路径：

```bash
pwd
```

构建后的 MCP 入口是：

```text
node <repo-absolute-path>/packages/mcp-server/dist/main.js
```

在 `~/.codex/config.toml` 中加入：

```toml
[mcp_servers.uu-codex-mcp]
command = "node"
args = ["/ABSOLUTE/PATH/TO/uu-codex-mcp/packages/mcp-server/dist/main.js"]
# uu_exec 最长允许 300 秒；留出 GUI 打开/清理余量。
tool_timeout_sec = 330
```

配置后可用 Codex CLI 检查：

```bash
codex mcp list
```

不要在 `args` 中使用相对仓库路径；Codex 启动 MCP 时的工作目录不应成为运行正确性的前提。

### 可选环境变量

```text
UU_CLI_PATH                 显式指定 uuyc-cli 完整路径
UU_DESKTOP_HELPER_PATH      覆盖 Desktop Helper 可执行文件路径
UU_HELPER_SOCKET_PATH       覆盖本地 Unix socket 路径
```

可直接写到对应 MCP 配置的 `env` 中，例如：

```toml
[mcp_servers.uu-codex-mcp]
command = "node"
args = ["/ABSOLUTE/PATH/TO/uu-codex-mcp/packages/mcp-server/dist/main.js"]
tool_timeout_sec = 330
env = { UU_CLI_PATH = "/Applications/UURemote.app/Contents/MacOS/uuyc-cli" }
```

## 使用示例

先让 Codex 查询设备：

```text
列一下 UU 当前在线设备。
```

确认准确 device ID 后再执行：

```text
在 device ID 为 <exact-device-id> 的 Windows 上执行 hostname。
```

`uu_exec` 的 MCP 输入大致为：

```json
{
  "device_id": "<exact-device-id>",
  "command": "hostname",
  "timeout_ms": 30000
}
```

返回结构：

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

## 工作原理

### CLI capability probe

项目不会根据 `uuyc-cli --version` 推断能力。不同平台即使都显示类似 `CLI 1.0.0`，可用参数也可能不同。

启动时通过实际 help 探测：

```text
uuyc-cli term --help
uuyc-cli term open --help
uuyc-cli term exit --help
```

当前 MVP 只启用经过验证的 `GuiTransport`。如果未来 macOS CLI 正式暴露：

```text
term --device-id <id> --new-session --shell powershell
```

也不会自动启用一个未经测试的路径；应单独实现、测试并评审 `PipeTransport`，上层 MCP API 保持不变。

### 结果协议

UU GUI 终端不是普通 stdout 管道。为避免终端回显、滚屏和长输出截断：

1. 原始 PowerShell 命令先在 Mac 端 UTF-8 → Base64，避免直接插值。
2. Windows 端执行后把结构化 JSON 结果转成 Base64 并保存在当前 PowerShell 会话变量。
3. 只显示唯一 marker 与结果长度。
4. 按每页最多 384 个 Base64 字符、每行 48 字符分页拉取。
5. Mac 端拼接、校验长度、Base64 解码，再返回 MCP。

完整 marker 字面不会出现在粘贴命令中，而是在远端通过字符串拼接生成，避免输入回显造成假命中。

## 安全边界

`uu_exec` 本质上拥有 **登录 UU 会话可获得的远程 PowerShell 权限**。请只操作你明确授权的设备。

项目的主要边界：

- 必须使用精确 `device_id`；不会按名称模糊选择客户机。
- 设备离线或非 Windows 时，在打开终端前拒绝执行。
- GUI 窗口必须唯一匹配目标设备，并在每次 Paste/Return 前重新证明焦点；无法证明时 fail closed。
- 不提供 OCR、截图识别或固定屏幕坐标 fallback。
- Desktop Helper 是唯一持有 macOS Accessibility 权限的进程。
- Node ↔ Helper 只通过本地 Unix Domain Socket 通信，socket 权限为 `0600`。
- 剪贴板由 Helper 在内存中完整快照并恢复；原内容不会通过 MCP 返回或写入日志。
- 默认日志不记录完整命令、完整 stdout 或剪贴板，只记录 request ID、device ID、耗时、命令长度/哈希和错误码等诊断字段。
- 只关闭当前进程明确记录为自己打开的 UU Terminal；不清理来源不明的会话。
- MVP 全局串行执行，降低 UU GUI 焦点竞争风险。
- Mac 锁屏、未登录 GUI、UU 未运行/未登录等状态不受支持；执行应失败而不是退化到不可靠自动化。

## 测试

### 自动化单元/协议测试

```bash
pnpm test
pnpm typecheck
pnpm build
swift test --package-path native/macos-helper
```

### 真实 UU → Windows smoke

真实远程测试必须显式指定一台 **授权的 Windows 测试设备**：

```bash
export UU_TEST_DEVICE_ID='<exact-authorized-windows-device-id>'
pnpm test:uu
```

如果未设置 `UU_TEST_DEVICE_ID`，脚本退出码为 `2`，并明确说明 **没有执行任何远程动作**。

Smoke matrix 包含：hostname、中文、空输出、PowerShell 错误、native exit code、特殊字符、120 行分页、240 字符长行、timeout→cleanup→recovery、10 次连续执行和剪贴板恢复。

人工负向场景见：[`tests/integration/README.md`](tests/integration/README.md)。

## 已知限制

- 当前核心执行链依赖可用且解锁的 macOS GUI Session。
- macOS Accessibility / AppKit 路径必须最终在真实 macOS 上验证；Linux CI 只能覆盖纯 Swift 协议/匹配逻辑。
- UU Remote GUI/Accessibility Tree 未来升级可能改变窗口标题或可访问节点，需要回归测试。
- MCP SDK 与 npm 依赖应在可联网环境通过正常 `pnpm install` 固化 lockfile。
- 大文件传输和交互式 PTY 不属于当前 MVP。

## 设计与实施计划

- [设计方案](docs/superpowers/specs/2026-09-12-uu-codex-mcp-design.md)
- [Implementation Plan](docs/superpowers/plans/2026-09-12-uu-codex-mcp.md)
