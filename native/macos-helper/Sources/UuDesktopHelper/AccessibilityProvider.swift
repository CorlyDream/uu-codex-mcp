import Foundation

/// Injectable Accessibility boundary; Node receives only locally-generated UUID window handles.
protocol AccessibilityProviding: AnyObject {
    func isTrusted() -> Bool
    func listWindows(appBundlePath: String) throws -> [WindowSnapshot]
    func focus(windowId: UUID, appBundlePath: String) throws
    func readText(windowId: UUID, maxDepth: Int, maxNodes: Int) throws -> [String]
}

#if canImport(AppKit) && canImport(ApplicationServices)
import AppKit
import ApplicationServices

/// macOS Accessibility implementation scoped to the exact UU application bundle path.
final class SystemAccessibilityProvider: AccessibilityProviding {
    private var windows: [UUID: AXUIElement] = [:]
    private let lock = NSLock()

    func isTrusted() -> Bool { AXIsProcessTrusted() }

    /// Enumerate only windows owned by the running app whose canonical bundle URL equals the configured UU app path.
    func listWindows(appBundlePath: String) throws -> [WindowSnapshot] {
        guard isTrusted() else { throw HelperActionError("UU_ACCESSIBILITY_PERMISSION_DENIED", "Desktop Helper 未获得辅助功能权限。") }
        let app = try runningApplication(appBundlePath: appBundlePath)
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        guard let nativeWindows = copyAttribute(appElement, kAXWindowsAttribute as CFString) as? [AXUIElement] else { return [] }
        lock.lock(); windows.removeAll(); lock.unlock()
        return nativeWindows.map { window in
            let id = UUID()
            lock.lock(); windows[id] = window; lock.unlock()
            return WindowSnapshot(
                handleId: id,
                title: (copyAttribute(window, kAXTitleAttribute as CFString) as? String) ?? "",
                role: (copyAttribute(window, kAXRoleAttribute as CFString) as? String) ?? "",
                focused: (copyAttribute(window, kAXFocusedAttribute as CFString) as? Bool) ?? false
            )
        }
    }

    /// Activate, raise and focus the exact cached window, then verify Accessibility reports it focused.
    func focus(windowId: UUID, appBundlePath: String) throws {
        guard isTrusted() else { throw HelperActionError("UU_ACCESSIBILITY_PERMISSION_DENIED", "Desktop Helper 未获得辅助功能权限。") }
        let app = try runningApplication(appBundlePath: appBundlePath)
        guard let window = cachedWindow(windowId) else { throw HelperActionError("UU_TERM_WINDOW_NOT_FOUND", "终端窗口句柄已失效。", retryable: true) }
        _ = app.activate(options: [.activateIgnoringOtherApps])
        AXUIElementPerformAction(window, kAXRaiseAction as CFString)
        AXUIElementSetAttributeValue(window, kAXFocusedAttribute as CFString, kCFBooleanTrue)
        guard (copyAttribute(window, kAXFocusedAttribute as CFString) as? Bool) == true else {
            throw HelperActionError("UU_TERM_FOCUS_UNPROVEN", "无法证明目标 UU 终端已获得焦点。", retryable: true)
        }
    }

    /// Read bounded text attributes from only the cached selected window and its descendants.
    func readText(windowId: UUID, maxDepth: Int, maxNodes: Int) throws -> [String] {
        guard isTrusted() else { throw HelperActionError("UU_ACCESSIBILITY_PERMISSION_DENIED", "Desktop Helper 未获得辅助功能权限。") }
        guard let window = cachedWindow(windowId) else { throw HelperActionError("UU_TERM_WINDOW_NOT_FOUND", "终端窗口句柄已失效。", retryable: true) }
        var output: [String] = []
        var visited = 0
        collectText(window, depth: 0, maxDepth: min(maxDepth, 10), maxNodes: min(maxNodes, 2_000), visited: &visited, output: &output)
        return output
    }

    private func runningApplication(appBundlePath: String) throws -> NSRunningApplication {
        let expected = URL(fileURLWithPath: appBundlePath).resolvingSymlinksInPath().standardizedFileURL
        guard let app = NSWorkspace.shared.runningApplications.first(where: { candidate in
            candidate.bundleURL?.resolvingSymlinksInPath().standardizedFileURL == expected
        }) else { throw HelperActionError("UU_APP_NOT_RUNNING", "指定路径的 UU Remote 主程序未运行。", retryable: true) }
        return app
    }

    private func cachedWindow(_ id: UUID) -> AXUIElement? {
        lock.lock(); defer { lock.unlock() }
        return windows[id]
    }

    private func copyAttribute(_ element: AXUIElement, _ attribute: CFString) -> CFTypeRef? {
        var value: CFTypeRef?
        return AXUIElementCopyAttributeValue(element, attribute, &value) == .success ? value : nil
    }

    private func collectText(_ element: AXUIElement, depth: Int, maxDepth: Int, maxNodes: Int, visited: inout Int, output: inout [String]) {
        guard depth <= maxDepth, visited < maxNodes else { return }
        visited += 1
        for attribute in [kAXTitleAttribute, kAXValueAttribute, kAXDescriptionAttribute] {
            if let value = copyAttribute(element, attribute as CFString) as? String, !value.isEmpty { output.append(value) }
        }
        guard depth < maxDepth, let children = copyAttribute(element, kAXChildrenAttribute as CFString) as? [AXUIElement] else { return }
        for child in children where visited < maxNodes {
            collectText(child, depth: depth + 1, maxDepth: maxDepth, maxNodes: maxNodes, visited: &visited, output: &output)
        }
    }
}
#else
/// Non-macOS placeholder used only so pure unit tests can execute in CI environments without AppKit.
final class SystemAccessibilityProvider: AccessibilityProviding {
    func isTrusted() -> Bool { false }
    func listWindows(appBundlePath: String) throws -> [WindowSnapshot] { throw HelperActionError("UU_ACCESSIBILITY_PERMISSION_DENIED", "Accessibility requires macOS") }
    func focus(windowId: UUID, appBundlePath: String) throws { throw HelperActionError("UU_ACCESSIBILITY_PERMISSION_DENIED", "Accessibility requires macOS") }
    func readText(windowId: UUID, maxDepth: Int, maxNodes: Int) throws -> [String] { throw HelperActionError("UU_ACCESSIBILITY_PERMISSION_DENIED", "Accessibility requires macOS") }
}
#endif
