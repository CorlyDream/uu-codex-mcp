import Foundation
#if canImport(CoreGraphics)
import CoreGraphics
#endif

/// Keyboard events allowed by the helper; no mouse/coordinate API exists on this interface.
protocol InputControlling: AnyObject {
    func paste() throws
    func keyReturn() throws
}

#if canImport(CoreGraphics)
/// Sends only Command+V and Return through CoreGraphics after HelperService validated the active interaction.
final class SystemInputController: InputControlling {
    func paste() throws {
        try postKey(code: 9, flags: .maskCommand)
    }

    func keyReturn() throws {
        try postKey(code: 36, flags: [])
    }

    private func postKey(code: CGKeyCode, flags: CGEventFlags) throws {
        guard let source = CGEventSource(stateID: .hidSystemState),
              let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
              let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else {
            throw HelperActionError("UU_GUI_SESSION_UNAVAILABLE", "无法创建键盘事件。", retryable: true)
        }
        down.flags = flags
        up.flags = flags
        down.post(tap: .cghidEventTap)
        up.post(tap: .cghidEventTap)
    }
}
#else
/// Non-macOS placeholder used only by tests outside the production platform.
final class SystemInputController: InputControlling {
    func paste() throws { throw HelperActionError("UU_GUI_SESSION_UNAVAILABLE", "keyboard input requires macOS") }
    func keyReturn() throws { throw HelperActionError("UU_GUI_SESSION_UNAVAILABLE", "keyboard input requires macOS") }
}
#endif
