import XCTest
@testable import UuDesktopHelper

private final class FakePasteboard: PasteboardProviding {
    var items: [PasteboardItemSnapshot]
    init(items: [PasteboardItemSnapshot]) { self.items = items }
    func readItems() throws -> [PasteboardItemSnapshot] { items }
    func replaceItems(_ items: [PasteboardItemSnapshot]) throws { self.items = items }
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
}
