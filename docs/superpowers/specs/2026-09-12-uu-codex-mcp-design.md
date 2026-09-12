# UU Codex MCP 设计方案

日期：2026-09-12

## 1. 背景与目标

目标是在 **macOS 主控机** 上运行 Codex CLI，通过网易 UU 远程控制客户的 Windows 电脑，并让 Codex 能直接执行远程 PowerShell 命令、读取执行结果。

核心约束：

- 客户 Windows 机器 **只安装 UU 远程客户端**。
- 不在客户机上部署 MCP Server、Agent、SSH Server、HTTP Server 或其他常驻服务。
- MCP Server、自动化逻辑和权限控制全部运行在自己的 Mac 上。
- 当前 macOS UU 4.40.0 自带的 `uuyc-cli` 仅暴露 `term open <device-id>` / `term exit <device-id>`，没有 Windows 端已出现过的 `term --device-id ... --new-session --shell powershell` 可编程 stdin/stdout 管道。
- 因此当前版本不能依赖 `uuyc-cli` stdout 直接取得远程 PowerShell 输出。

项目最终希望达到如下使用体验：

```text
用户：
检查客户 A 的电脑，看看 vision-inspect-gui 是否运行，没运行就启动。

Codex
  ↓ MCP
uu-codex-mcp（Mac）
  ↓
UU Remote（Mac）
  ↓
客户 Windows（仅安装 UU 客户端）
  ↓
PowerShell
```

## 2. 已验证事实

### 2.1 macOS CLI 没有可编程终端管道

`song-chaoyang/uu-remote-vscode` 已针对不同 `uuyc-cli` 能力做 capability probe。其源码明确记录：

- 一类 CLI 支持：
  - `term --device-id`
  - `--new-session`
  - `--shell`
  - `--list-sessions`
  - stdin/stdout 管道交互
- macOS UURemote 4.39.x 自带的 CLI 1.0.0 只有：
  - `term open`
  - `term exit`
  - 打开 UU 主程序终端窗口
  - 不提供可编程 stdin/stdout 通道

本项目不根据 `uuyc-cli --version` 判断能力，而是根据实际 `term --help` 输出做 capability probe，因为不同平台可能都报告 CLI 1.0.0，但能力不同。

### 2.2 Accessibility 路线已有实际项目验证

`moretea-labs/forge` 的 UU Remote Rescue 已实现 macOS → UU Remote → Windows 的终端自动化：

1. `uuyc-cli term open <device-id>` 打开 UU 自带远程终端。
2. 使用 macOS Accessibility API 找到并验证目标终端窗口。
3. 使用剪贴板粘贴命令。
4. 模拟 Return 执行。
5. 从 Accessibility Tree 读取终端文本。
6. 使用 begin/end marker 提取执行结果。
7. 完成后恢复剪贴板并关闭终端会话。

因此本方案不依赖 OCR，不依赖固定坐标点击，也不要求客户机安装额外组件。

## 3. 推荐架构

```text
┌──────────────────────────────────────────────┐
│ macOS                                        │
│                                              │
│  Codex CLI                                   │
│      │                                       │
│      │ MCP stdio                             │
│      ▼                                       │
│  uu-codex-mcp                                │
│      │                                       │
│      ▼                                       │
│  Bridge Core / Session Coordinator           │
│      │                    │                  │
│      │                    ├─ UuCliAdapter    │
│      │                    │   ├ device list │
│      │                    │   ├ term open   │
│      │                    │   └ term exit   │
│      │                    │                  │
│      │                    └─ Transport       │
│      │                        ├ PipeTransport│
│      │                        └ GuiTransport │
│      │                              │        │
│      ▼                              ▼        │
│  Unix Domain Socket       Desktop Helper     │
│                           (Swift/macOS AX)   │
│                              │               │
│                              ├ Accessibility │
│                              ├ Clipboard     │
│                              └ Keyboard      │
└──────────────────────────────┼───────────────┘
                               │
                               │ UU 官方远程通道
                               ▼
┌──────────────────────────────────────────────┐
│ 客户 Windows                                 │
│                                              │
│  UU 客户端                                   │
│      ↓                                       │
│  PowerShell                                  │
│                                              │
│  不安装 uu-codex-mcp                         │
│  不安装 Server                               │
│  不安装 Agent                                │
└──────────────────────────────────────────────┘
```

## 4. 组件设计

### 4.1 MCP Server

推荐使用 Node.js 20+ / TypeScript。

职责：

- 以 stdio MCP Server 方式供 Codex CLI 调用。
- 提供稳定、结构化的工具接口。
- 做参数校验、超时、错误归一化。
- 不直接操作 macOS GUI。
- 调用 Bridge Core 完成远程操作。

第一阶段只提供三个核心工具：

```text
uu_list_devices()
uu_exec(device_id, command, timeout_ms?)
uu_close_terminal(device_id)
```

后续再考虑：

```text
uu_read_file
uu_write_file
uu_pty_open
uu_pty_send
uu_pty_read
uu_pty_close
```

MVP 不提前实现完整 PTY 和大文件传输，避免扩大第一阶段复杂度。

### 4.2 UuCliAdapter

统一封装官方 `uuyc-cli`。

职责：

- 查找本机 `uuyc-cli` 路径。
- `device list` 查询设备。
- 解析不同版本 JSON 字段差异，例如 `connections` / `connected_devices`。
- 打开终端：`term open <device-id>`。
- 关闭终端：`term exit <device-id>`，若当前版本支持则附加清理参数。
- capability probe。

能力探测必须以实际帮助信息为准：

```text
uuyc-cli --help
uuyc-cli term --help
uuyc-cli term open --help
```

若未来 macOS CLI 支持：

```text
term --device-id
--new-session
--shell
```

则自动切换到 `PipeTransport`，不再使用 GUI 自动化。

### 4.3 Transport 抽象层

定义统一的远程执行接口：

```text
open(device)
exec(command)
close()
```

实现两个 Transport：

#### GuiTransport

当前 macOS 默认实现。

依赖：

- `uuyc-cli term open`
- macOS Accessibility
- 剪贴板
- 键盘事件

#### PipeTransport

未来优先实现。

当 capability probe 发现 CLI 已支持真正 stdin/stdout 管道时使用：

```text
uuyc-cli term --device-id <id> --new-session --shell powershell
```

这样将来 UU 官方补齐 macOS CLI 后，只需切换 Transport，不影响 MCP API 和上层 Codex 使用方式。

### 4.4 Desktop Helper

推荐使用 Swift 实现一个固定的 macOS 可执行程序。

原因：

- 原生调用 Accessibility API 更稳定。
- macOS TCC / Accessibility 权限绑定到固定程序身份，避免 Node 临时进程、脚本路径变化导致反复授权。
- GUI 操作和 MCP 进程解耦。

Desktop Helper 通过 Unix Domain Socket 接收有限的本地请求，例如：

```text
observe_windows
focus_terminal
clipboard_read
clipboard_write
paste
key_return
read_terminal_text
```

MCP Server 本身不持有 Accessibility 权限。

## 5. 远程执行协议

直接在终端里执行用户命令并读取屏幕不够可靠，主要问题包括：

- PowerShell 中文和特殊字符。
- 命令输出可能超过终端当前可见区域。
- 提示符、命令回显和真正 stdout 混在一起。
- UU 终端可能使用虚拟屏幕/差分渲染。
- 长输出可能在下一条命令执行前被滚出。

因此 `uu_exec` 使用“远程缓存 + marker + Base64 分页”协议。

### 5.1 执行阶段

Mac 为每次请求生成随机 request id，例如：

```text
8f04f231a94c
```

将用户 PowerShell 命令包装为远程脚本：

1. 执行原始命令。
2. 将 stdout/stderr 捕获为 UTF-8 文本。
3. 记录 PowerShell 执行状态和可用的 native exit code。
4. 组成结构化 JSON。
5. 将 JSON UTF-8 编码后转成 Base64。
6. 保存到当前远程 PowerShell 会话的全局变量。
7. 只输出结果长度和唯一 marker。

概念结果：

```json
{
  "stdout": "...",
  "success": true,
  "exitCode": 0,
  "error": null
}
```

### 5.2 分页读取

不一次性把完整 Base64 输出到 UU 终端。

Bridge 根据总长度重复发送短分页命令：

```text
__UU_PAGE_BEGIN_<request-id>__
<固定长度 Base64 chunk>
__UU_PAGE_END_<request-id>__
```

每页大小必须保守控制，确保完整内容留在 UU 终端可读取区域内。

本地按页拼接后：

```text
Base64 decode
  ↓
UTF-8 JSON
  ↓
MCP structured result
```

这样长输出不会依赖 UU GUI 是否保留完整 scrollback。

### 5.3 命令输入

命令使用剪贴板整体粘贴，不逐字符键入。

对于较长命令，MVP 先设置明确长度上限，超过上限返回结构化错误；后续需要时再增加“命令分块上传”协议。

## 6. GuiTransport 执行流程

一次 `uu_exec` 的完整流程：

```text
1. device list
2. 精确匹配 device_id
3. 验证设备在线且平台为 Windows
4. 获取该 device 的进程内互斥锁
5. term open <device-id>
6. 等待 UU Terminal 创建
7. Accessibility 枚举 UU 窗口
8. 按设备名称 + Terminal 特征精确匹配
9. 若 0 个窗口：超时失败
10. 若 >1 个候选：拒绝执行，fail closed
11. 聚焦并再次验证窗口
12. 保存 Mac 当前剪贴板
13. 写入包装后的 PowerShell 命令
14. Paste
15. Return
16. Accessibility 轮询 marker
17. 获取结果长度
18. 分页拉取 Base64 内容
19. 解码并返回 MCP 结果
20. finally 恢复剪贴板
21. term exit / clear
22. 释放设备锁
```

任何步骤失败都必须进入 `finally` 清理逻辑。

## 7. 窗口识别原则

不能依赖屏幕坐标。

必须使用 Accessibility Tree，至少验证：

- App 是 UU Remote。
- Window role 是 `AXWindow`。
- 标题或可访问属性中包含目标设备名称。
- 标题或内容符合终端窗口特征。
- 执行输入前窗口必须明确处于 focused 状态。

如果无法证明当前焦点窗口就是目标设备终端，则拒绝粘贴命令。

这是一个重要的 fail-closed 安全边界，避免把 PowerShell 命令误粘贴到微信、浏览器、IDE 或另一台客户机器的终端。

## 8. 会话与并发

第一阶段按设备串行执行。

规则：

- 同一个 `device_id` 同一时间只允许一个活动操作。
- 不同设备理论上可以并发，但 MVP 建议先全局串行，验证 UU GUI 窗口切换稳定后再开放多设备并发。
- 每次请求拥有唯一 request id 和 marker。
- 超时后主动关闭自己创建的 UU Terminal。
- 不清理无法确认归属的其他 UU 会话。

## 9. 错误模型

MCP 返回结构化错误码，不把原始 GUI 状态直接暴露给 Codex 猜测。

建议错误码：

```text
UU_CLI_NOT_FOUND
UU_APP_NOT_RUNNING
UU_DEVICE_NOT_FOUND
UU_DEVICE_OFFLINE
UU_DEVICE_PLATFORM_UNSUPPORTED
UU_TERM_OPEN_FAILED
UU_TERM_WINDOW_NOT_FOUND
UU_TERM_WINDOW_AMBIGUOUS
UU_TERM_FOCUS_UNPROVEN
UU_ACCESSIBILITY_PERMISSION_DENIED
UU_CLIPBOARD_FAILED
UU_COMMAND_TIMEOUT
UU_RESULT_MARKER_TIMEOUT
UU_RESULT_DECODE_FAILED
UU_SESSION_CLOSE_FAILED
UU_COMMAND_TOO_LONG
```

每个错误至少包含：

```json
{
  "code": "UU_DEVICE_OFFLINE",
  "message": "目标设备当前离线",
  "retryable": true
}
```

## 10. 安全设计

### 10.1 客户机零额外部署

客户机只保留 UU 被控端，不开放新的监听端口，也不额外安装：

- SSH Server
- MCP Server
- Agent
- HTTP/WebSocket 服务

### 10.2 本地权限最小化

只有 Desktop Helper 获取 macOS Accessibility 权限。

MCP Server 通过本地 Unix Domain Socket 调用 Helper。

Socket 文件应限制为当前用户访问，例如 mode `0600`。

### 10.3 剪贴板保护

每次命令执行：

1. 在内存中保存原剪贴板文本。
2. 写入临时命令。
3. Paste。
4. 在 `finally` 中恢复原值。

默认不把原剪贴板内容写入日志。

### 10.4 命令权限

`uu_exec` 本质上提供远程 Shell 能力，因此必须假定调用者拥有等同 PowerShell 的权限。

第一版不额外做命令 allowlist，但必须：

- 精确指定目标 device id。
- 执行前确认设备身份和在线状态。
- 日志记录目标设备、时间、request id 和命令摘要。
- 默认不记录可能包含敏感信息的完整 stdout。

## 11. macOS 状态限制

GuiTransport 需要可用的 GUI Session。

以下状态不保证工作：

- Mac 锁屏。
- 用户未登录图形桌面。
- UU Remote 没有运行或没有登录。
- Desktop Helper 未获得 Accessibility 权限。

如果检测到这些状态，应明确返回错误，不使用 OCR、屏幕坐标或其他不可靠 fallback。

## 12. MCP API 草案

### `uu_list_devices`

返回：

```json
{
  "devices": [
    {
      "id": "...",
      "name": "客户A",
      "platform": "windows",
      "online": true
    }
  ]
}
```

### `uu_exec`

输入：

```json
{
  "device_id": "...",
  "command": "Get-Process",
  "timeout_ms": 30000
}
```

返回：

```json
{
  "request_id": "...",
  "device_id": "...",
  "stdout": "...",
  "success": true,
  "exit_code": 0,
  "duration_ms": 4200,
  "transport": "gui"
}
```

### `uu_close_terminal`

用于异常情况下显式清理目标设备的当前终端，但只允许关闭本项目能够确认归属的会话/窗口。

## 13. 项目目录建议

```text
uu-codex-mcp/
├── docs/
│   └── superpowers/
│       └── specs/
├── packages/
│   ├── mcp-server/
│   │   └── src/
│   ├── bridge-core/
│   │   └── src/
│   └── desktop-helper/
│       └── Sources/
├── tests/
│   ├── unit/
│   └── integration/
├── package.json
└── README.md
```

如果后续发现 Swift Helper 规模很小，也可以不使用 monorepo package，而将其放在：

```text
native/macos-helper/
```

具体目录在实现计划阶段再最终确定。

## 14. 测试策略

### 14.1 单元测试

不依赖真实 UU：

- CLI JSON 解析。
- capability probe。
- device 匹配。
- marker 生成与解析。
- Base64 分页拼接。
- PowerShell wrapper 生成。
- timeout/error 映射。
- session lock。

### 14.2 Desktop Helper 测试

通过可注入的 Accessibility Adapter 测试：

- 0 个匹配窗口。
- 唯一匹配窗口。
- 多个匹配窗口。
- 窗口无法聚焦。
- 剪贴板保存/恢复。
- GUI Session 不可用。

### 14.3 真实集成测试

测试环境：

```text
Mac 主控
  ↓ UU
测试 Windows
```

至少覆盖：

1. `hostname` 单行输出。
2. 中文输出。
3. 空输出。
4. PowerShell 错误。
5. Native exe 非 0 exit code。
6. 特殊字符：`$ | ; " ' \``。
7. 100+ 行输出分页。
8. 超长单行。
9. 命令超时。
10. 连续执行 10 次。
11. 中途关闭 UU Terminal 后恢复。
12. 设备离线。
13. 两个同名/相似窗口时 fail closed。
14. 执行后剪贴板正确恢复。
15. 执行后无本项目遗留会话。

## 15. 实施阶段划分

### Phase 1：CLI 与 MCP 骨架

- MCP stdio Server。
- `uu_list_devices`。
- CLI 路径发现。
- capability probe。
- 统一错误模型。

验收：Codex 能稳定查询 UU 设备。

### Phase 2：macOS Desktop Helper

- Accessibility 权限检测。
- UU 窗口枚举。
- 精确窗口匹配。
- 聚焦。
- 剪贴板保存/写入/恢复。
- Paste + Return。
- Accessibility Tree 文本读取。

验收：Mac 本地脚本可以对指定 UU Terminal 发送一条固定命令并读回 marker。

### Phase 3：`uu_exec`

- PowerShell wrapper。
- request marker。
- Base64 结果协议。
- 分页。
- timeout。
- session cleanup。

验收：Codex 能执行任意常用 PowerShell 命令并可靠拿回短/长输出。

### Phase 4：可靠性强化

- 连续调用压测。
- UU 限流/终端创建慢的退避。
- GUI 焦点异常恢复。
- UU 升级后的 capability 回归测试。
- 日志和诊断命令。

### Phase 5：可选能力

按实际需求再增加：

- 小文件读写。
- 交互 PTY。
- 多设备并发。
- 更长命令分块。

不在 MVP 中提前实现。

## 16. 不采用的方案

### 客户 Windows 部署 MCP/Server

不采用。违反客户机只安装 UU 客户端的核心约束。

### 逆向 UU XPC / 私有网络协议

暂不采用。版本脆弱、维护成本高，UU 更新后容易失效。

### OCR / 固定坐标点击

不采用。Accessibility Tree 已能提供更可靠、可验证的窗口和文本访问。

### 强制使用旧版 macOS UU

不作为主方案。旧版兼容性和安全性不可控。

## 17. 关键设计决策

1. **客户机零额外部署** 是最高优先级约束。
2. 当前 macOS 走 **Accessibility GuiTransport**。
3. MCP API 与具体 UU Transport 解耦。
4. 自动 capability probe，未来可无缝切换到官方 pipe channel。
5. 不把终端 UI 当普通 stdout；使用 marker + Base64 + 分页协议。
6. GUI 操作必须验证目标窗口并 fail closed。
7. Desktop Helper 独立进程持有 macOS Accessibility 权限。
8. MVP 只做 `list + exec + cleanup`，文件传输和 PTY 后置。

## 18. 参考实现与资料

- 网易 UU 远程 CLI：<https://uuyc.163.com/help/cli.html>
- 网易 UU 远程 CLI 介绍：<https://uuyc.163.com/blog/20260625-cli.html>
- `song-chaoyang/uu-remote-vscode`：<https://github.com/song-chaoyang/uu-remote-vscode>
- `youki258/uu-remote-bridge`：<https://github.com/youki258/uu-remote-bridge>
- `yinren112/uu-remote-ops`：<https://github.com/yinren112/uu-remote-ops>
- `moretea-labs/forge` UU Remote Rescue：<https://github.com/moretea-labs/forge/blob/main/docs/operations/uu-remote-rescue.md>

其中：

- `uu-remote-vscode` 可参考 CLI capability probe 和完整 pipe channel 的 TermBridge。
- `uu-remote-bridge` 可参考 marker、VT/虚拟屏幕、分页和长输出可靠性处理。
- `uu-remote-ops` 可参考远程终端的会话卫生和实际运维注意事项。
- `forge` 可重点参考 macOS `term open` + Accessibility + Clipboard + marker 的实现路径。

## 19. 成功标准

第一版完成后，应满足：

```text
Mac 上运行 Codex CLI
  ↓
用户用自然语言指定客户设备和任务
  ↓
Codex 调用 uu_exec
  ↓
Mac 自动打开正确的 UU Remote Terminal
  ↓
远程 Windows 执行 PowerShell
  ↓
输出可靠返回 Codex
  ↓
恢复本地剪贴板并清理终端
```

客户 Windows 全程不需要安装除 UU Remote 之外的任何新组件。
