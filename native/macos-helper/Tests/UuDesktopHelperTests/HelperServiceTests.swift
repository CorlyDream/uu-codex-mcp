import XCTest
@testable import UuDesktopHelper

private final class ServiceFakeAccessibility: AccessibilityProviding {
    var trusted = true
    var windows: [WindowSnapshot] = []
    var focusCount = 0
    var strings: [String] = []
    func isTrusted() -> Bool { trusted }
    func listWindows(appBundlePath: String) throws -> [WindowSnapshot] { windows }
    func focus(windowId: UUID, appBundlePath: String) throws { focusCount += 1 }
    func readText(windowId: UUID, maxDepth: Int, maxNodes: Int) throws -> [String] { strings }
}

private final class ServiceFakeInput: InputControlling {
    var pasteCount = 0
    var returnCount = 0
    func paste() throws { pasteCount += 1 }
    func keyReturn() throws { returnCount += 1 }
}

private final class ServiceFakePasteboard: PasteboardProviding {
    var items: [PasteboardItemSnapshot] = []
    func readItems() throws -> [PasteboardItemSnapshot] { items }
    func replaceItems(_ items: [PasteboardItemSnapshot]) throws { self.items = items }
}

final class HelperServiceTests: XCTestCase {
    func testHealthResponseKeepsRequestId() throws {
        let service = HelperService(interactions: InteractionStore())
        let request = HelperRequest(id: "r1", action: "health", args: [:])
        let response = service.handle(request)
        XCTAssertEqual(response.id, "r1")
        XCTAssertTrue(response.ok)
        XCTAssertEqual(response.result?["status"], .string("ok"))
    }

    func testUnknownActionReturnsProtocolError() throws {
        let service = HelperService(interactions: InteractionStore())
        let response = service.handle(HelperRequest(id: "r2", action: "unknown", args: [:]))
        XCTAssertFalse(response.ok)
        XCTAssertEqual(response.error?.code, "UU_HELPER_PROTOCOL_ERROR")
    }

    func testStopDoesNotRemovePathItNeverBound() throws {
        let path = FileManager.default.temporaryDirectory.appendingPathComponent("uu-helper-unowned-\(UUID().uuidString)").path
        try Data("keep".utf8).write(to: URL(fileURLWithPath: path))
        defer { try? FileManager.default.removeItem(atPath: path) }
        let server = UnixSocketServer(path: path, service: HelperService(interactions: InteractionStore()))
        server.stop()
        XCTAssertTrue(FileManager.default.fileExists(atPath: path))
    }

    func testPasteRefocusesOwnedInteractionBeforeKeyboardInput() throws {
        let window = WindowSnapshot(handleId: UUID(), title: "客户A - Terminal", role: "AXWindow", focused: false)
        let accessibility = ServiceFakeAccessibility()
        accessibility.windows = [window]
        let input = ServiceFakeInput()
        let service = HelperService(
            interactions: InteractionStore(),
            accessibility: accessibility,
            clipboard: ClipboardController(provider: ServiceFakePasteboard()),
            input: input
        )
        let begin = service.handle(HelperRequest(id: "b1", action: "begin_interaction", args: [
            "app_bundle_path": .string("/Applications/UURemote.app"),
            "device_name": .string("客户A"),
        ]))
        let interactionId = begin.result?["interaction_id"]?.stringValue ?? ""
        XCTAssertTrue(begin.ok)
        XCTAssertEqual(accessibility.focusCount, 1)

        let paste = service.handle(HelperRequest(id: "p1", action: "paste", args: ["interaction_id": .string(interactionId)]))
        XCTAssertTrue(paste.ok)
        XCTAssertEqual(accessibility.focusCount, 2)
        XCTAssertEqual(input.pasteCount, 1)
    }
}
