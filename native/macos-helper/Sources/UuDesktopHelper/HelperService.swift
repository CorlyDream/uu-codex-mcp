import Foundation

/// Dispatches the narrow JSON action protocol and validates every opaque interaction before UI access.
final class HelperService {
    private let interactions: InteractionStore
    private let accessibility: AccessibilityProviding
    private let clipboard: ClipboardController
    private let input: InputControlling

    init(
        interactions: InteractionStore,
        accessibility: AccessibilityProviding = SystemAccessibilityProvider(),
        clipboard: ClipboardController = ClipboardController(provider: SystemPasteboardProvider()),
        input: InputControlling = SystemInputController()
    ) {
        self.interactions = interactions
        self.accessibility = accessibility
        self.clipboard = clipboard
        self.input = input
    }

    /// Handle one validated request without exposing native process IDs, AX references, clipboard contents, or Swift stacks.
    func handle(_ request: HelperRequest) -> HelperResponse {
        do {
            switch request.action {
            case "health":
                return .success(id: request.id, result: ["status": .string("ok"), "accessibility_trusted": .bool(accessibility.isTrusted())])
            case "begin_interaction":
                return try beginInteraction(request)
            case "clipboard_snapshot":
                let snapshotId = try clipboard.snapshot()
                return .success(id: request.id, result: ["snapshot_id": .string(snapshotId.uuidString)])
            case "clipboard_set_text":
                guard let text = request.args["text"]?.stringValue else { throw protocolError("text is required") }
                try clipboard.setText(text)
                return .success(id: request.id)
            case "clipboard_restore":
                guard let raw = request.args["snapshot_id"]?.stringValue, let snapshotId = UUID(uuidString: raw) else { throw protocolError("snapshot_id is required") }
                try clipboard.restore(snapshotId)
                return .success(id: request.id)
            case "paste":
                let record = try interactionRecord(request)
                try refocus(record)
                try input.paste()
                return .success(id: request.id)
            case "key_return":
                let record = try interactionRecord(request)
                try refocus(record)
                try input.keyReturn()
                return .success(id: request.id)
            case "read_terminal_text":
                let record = try interactionRecord(request)
                guard let windowId = record.windowHandleId else { throw protocolError("interaction has no window") }
                let strings = try accessibility.readText(windowId: windowId, maxDepth: 10, maxNodes: 2_000)
                return .success(id: request.id, result: ["strings": .array(strings.map(JSONValue.string))])
            case "end_interaction":
                let id = try interactionId(request)
                guard interactions.remove(id) else { throw protocolError("interaction_id is unknown") }
                return .success(id: request.id)
            default:
                throw protocolError("unsupported helper action")
            }
        } catch let error as HelperActionError {
            return .failure(id: request.id, code: error.code, message: error.message, retryable: error.retryable)
        } catch {
            return .failure(id: request.id, code: "UU_HELPER_PROTOCOL_ERROR", message: "helper action failed")
        }
    }

    /// Select and focus exactly one terminal window before creating a local interaction authority.
    private func beginInteraction(_ request: HelperRequest) throws -> HelperResponse {
        guard accessibility.isTrusted() else { throw HelperActionError("UU_ACCESSIBILITY_PERMISSION_DENIED", "Desktop Helper 未获得辅助功能权限。") }
        guard let appBundlePath = request.args["app_bundle_path"]?.stringValue,
              let deviceName = request.args["device_name"]?.stringValue,
              !appBundlePath.isEmpty, !deviceName.isEmpty else { throw protocolError("app_bundle_path and device_name are required") }
        let windows = try accessibility.listWindows(appBundlePath: appBundlePath)
        let selected = try WindowMatcher.match(windows: windows, deviceName: deviceName)
        try accessibility.focus(windowId: selected.handleId, appBundlePath: appBundlePath)
        let id = interactions.create(windowHandleId: selected.handleId, appBundlePath: appBundlePath)
        return .success(id: request.id, result: [
            "interaction_id": .string(id.uuidString),
            "window_title": .string(selected.title),
        ])
    }

    /// Re-prove the selected UU window has focus immediately before emitting keyboard input.
    private func refocus(_ record: InteractionRecord) throws {
        guard let windowId = record.windowHandleId,
              let appBundlePath = record.appBundlePath else {
            throw protocolError("interaction has no focusable window")
        }
        try accessibility.focus(windowId: windowId, appBundlePath: appBundlePath)
    }

    private func interactionId(_ request: HelperRequest) throws -> UUID {
        guard let raw = request.args["interaction_id"]?.stringValue, let id = UUID(uuidString: raw) else { throw protocolError("interaction_id is required") }
        return id
    }

    private func interactionRecord(_ request: HelperRequest) throws -> InteractionRecord {
        let id = try interactionId(request)
        guard let record = interactions.record(id) else { throw protocolError("interaction_id is unknown") }
        return record
    }

    private func protocolError(_ message: String) -> HelperActionError {
        HelperActionError("UU_HELPER_PROTOCOL_ERROR", message)
    }
}
