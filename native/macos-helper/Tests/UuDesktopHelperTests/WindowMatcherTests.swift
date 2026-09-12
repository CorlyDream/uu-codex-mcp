import XCTest
@testable import UuDesktopHelper

final class WindowMatcherTests: XCTestCase {
    func testNoCandidateReturnsNotFound() {
        XCTAssertThrowsError(try WindowMatcher.match(windows: [], deviceName: "客户A")) { error in
            XCTAssertEqual((error as? HelperActionError)?.code, "UU_TERM_WINDOW_NOT_FOUND")
        }
    }

    func testUniqueDeviceTerminalMatches() throws {
        let expected = WindowSnapshot(handleId: UUID(), title: "客户A - PowerShell 终端", role: "AXWindow", focused: false)
        let other = WindowSnapshot(handleId: UUID(), title: "客户B - Terminal", role: "AXWindow", focused: false)
        XCTAssertEqual(try WindowMatcher.match(windows: [other, expected], deviceName: "客户A"), expected)
    }

    func testMultipleCandidatesReturnAmbiguous() {
        let windows = [
            WindowSnapshot(handleId: UUID(), title: "客户A - terminal", role: "AXWindow", focused: false),
            WindowSnapshot(handleId: UUID(), title: "客户A - cmd", role: "AXWindow", focused: true),
        ]
        XCTAssertThrowsError(try WindowMatcher.match(windows: windows, deviceName: "客户A")) { error in
            XCTAssertEqual((error as? HelperActionError)?.code, "UU_TERM_WINDOW_AMBIGUOUS")
        }
    }

    func testWrongDeviceNameDoesNotMatch() {
        let windows = [WindowSnapshot(handleId: UUID(), title: "客户B - 终端", role: "AXWindow", focused: false)]
        XCTAssertThrowsError(try WindowMatcher.match(windows: windows, deviceName: "客户A"))
    }
}
