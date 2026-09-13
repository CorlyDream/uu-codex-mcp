import XCTest
@testable import UuDesktopHelper

private enum FakePasteboardError: Error { case replaceFailed }

private final class FakePasteboard: PasteboardProviding {
    var items: [PasteboardItemSnapshot]
    var failNextReplace = false

    init(items: [PasteboardItemSnapshot]) { self.items = items }
    func readItems() throws -> [PasteboardItemSnapshot] { items }
    func replaceItems(_ items: [PasteboardItemSnapshot]) throws {
        if failNextReplace {
            failNextReplace = false
            throw FakePasteboardError.replaceFailed
        }
        self.items = items
    }
}

final class ClipboardControllerTests: XCTestCase {
    func testSnapshotRestoresMultipleItemTypes() throws {
        let original = [PasteboardItemSnapshot(representations: [
            "public.utf8-plain-text": Data("hello".utf8),
            "public.html": Data("<b>hello</b>".utf8),
        ])]
        let pasteboard = FakePasteboard(items: original)
        let clipboard = ClipboardController(provider: pasteboard)
        let snapshot = try clipboard.snapshot()
        try clipboard.setText("temporary")
        XCTAssertNotEqual(pasteboard.items, original)
        try clipboard.restore(snapshot)
        XCTAssertEqual(pasteboard.items, original)
    }

    func testFailedRestoreKeepsSnapshotForRetry() throws {
        let original = [PasteboardItemSnapshot(representations: ["public.utf8-plain-text": Data("original".utf8)])]
        let pasteboard = FakePasteboard(items: original)
        let clipboard = ClipboardController(provider: pasteboard)
        let snapshot = try clipboard.snapshot()
        try clipboard.setText("temporary")

        pasteboard.failNextReplace = true
        XCTAssertThrowsError(try clipboard.restore(snapshot)) { error in
            XCTAssertEqual((error as? HelperActionError)?.code, "UU_CLIPBOARD_FAILED")
        }

        XCTAssertNoThrow(try clipboard.restore(snapshot))
        XCTAssertEqual(pasteboard.items, original)
    }
}
