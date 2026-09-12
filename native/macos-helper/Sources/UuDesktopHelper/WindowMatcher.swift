import Foundation

/// Stable, testable view of one window; handle IDs are generated locally by the Accessibility provider.
struct WindowSnapshot: Equatable {
    let handleId: UUID
    let title: String
    let role: String
    let focused: Bool
}

/// Pure matching policy used before any command may be pasted into a UU terminal.
enum WindowMatcher {
    private static let terminalTokens = ["终端", "terminal", "powershell", "cmd"]

    /// Require exactly one AXWindow containing the exact device name and a terminal-identifying token.
    static func match(windows: [WindowSnapshot], deviceName: String) throws -> WindowSnapshot {
        let candidates = windows.filter { window in
            guard window.role == "AXWindow", window.title.contains(deviceName) else { return false }
            let lower = window.title.lowercased()
            return terminalTokens.contains { lower.contains($0) }
        }
        guard !candidates.isEmpty else {
            throw HelperActionError("UU_TERM_WINDOW_NOT_FOUND", "未找到目标设备的 UU 终端窗口。", retryable: true)
        }
        guard candidates.count == 1, let candidate = candidates.first else {
            throw HelperActionError("UU_TERM_WINDOW_AMBIGUOUS", "找到多个目标设备终端窗口，拒绝自动输入。")
        }
        return candidate
    }
}
