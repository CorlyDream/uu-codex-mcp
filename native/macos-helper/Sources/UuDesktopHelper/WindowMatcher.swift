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

    /// Require exactly one AXWindow containing the exact device-name token and a terminal-identifying token.
    static func match(windows: [WindowSnapshot], deviceName: String) throws -> WindowSnapshot {
        let candidates = windows.filter { window in
            guard window.role == "AXWindow", containsExactDeviceName(window.title, deviceName: deviceName) else { return false }
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

    /// Match a device name only when adjacent characters are not Unicode letters, digits, or underscore.
    /// This deliberately rejects prefix collisions such as `PC` matching `PC2 - Terminal`.
    private static func containsExactDeviceName(_ title: String, deviceName: String) -> Bool {
        guard !deviceName.isEmpty else { return false }
        var searchStart = title.startIndex
        while searchStart <= title.endIndex,
              let range = title.range(of: deviceName, range: searchStart..<title.endIndex) {
            let leftSafe: Bool
            if range.lowerBound == title.startIndex {
                leftSafe = true
            } else {
                leftSafe = !isNameContinuation(title[title.index(before: range.lowerBound)])
            }

            let rightSafe: Bool
            if range.upperBound == title.endIndex {
                rightSafe = true
            } else {
                rightSafe = !isNameContinuation(title[range.upperBound])
            }

            if leftSafe && rightSafe { return true }
            if range.upperBound == title.endIndex { break }
            searchStart = title.index(after: range.lowerBound)
        }
        return false
    }

    private static func isNameContinuation(_ character: Character) -> Bool {
        if character == "_" { return true }
        return character.unicodeScalars.contains { CharacterSet.alphanumerics.contains($0) }
    }
}
