import XCTest
@testable import UuDesktopHelper

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

}
