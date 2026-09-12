import Foundation
#if canImport(AppKit)
import AppKit
#endif

/// Opaque copy of all representations belonging to one pasteboard item.
struct PasteboardItemSnapshot: Equatable {
    let representations: [String: Data]
}

/// Small injectable surface that makes clipboard preservation independently testable.
protocol PasteboardProviding: AnyObject {
    func readItems() throws -> [PasteboardItemSnapshot]
    func replaceItems(_ items: [PasteboardItemSnapshot]) throws
}

/// Stores complete clipboard snapshots in memory and exposes only random snapshot IDs to callers.
final class ClipboardController {
    private let provider: PasteboardProviding
    private var snapshots: [UUID: [PasteboardItemSnapshot]] = [:]
    private let lock = NSLock()

    init(provider: PasteboardProviding) {
        self.provider = provider
    }

    /// Capture every available pasteboard representation without exposing its contents over the socket.
    func snapshot() throws -> UUID {
        do {
            let items = try provider.readItems()
            let id = UUID()
            lock.lock(); snapshots[id] = items; lock.unlock()
            return id
        } catch {
            throw HelperActionError("UU_CLIPBOARD_FAILED", "无法保存当前剪贴板。", retryable: true)
        }
    }

    /// Replace the pasteboard with plain UTF-8 text for one temporary terminal paste operation.
    func setText(_ text: String) throws {
        guard let data = text.data(using: .utf8) else {
            throw HelperActionError("UU_CLIPBOARD_FAILED", "无法编码剪贴板文本。")
        }
        do {
            try provider.replaceItems([PasteboardItemSnapshot(representations: ["public.utf8-plain-text": data])])
        } catch {
            throw HelperActionError("UU_CLIPBOARD_FAILED", "无法写入剪贴板。", retryable: true)
        }
    }

    /// Restore a locally-created snapshot exactly once and then forget the sensitive in-memory copy.
    func restore(_ snapshotId: UUID) throws {
        lock.lock()
        let items = snapshots.removeValue(forKey: snapshotId)
        lock.unlock()
        guard let items else { throw HelperActionError("UU_CLIPBOARD_FAILED", "剪贴板 snapshot 不存在。") }
        do {
            try provider.replaceItems(items)
        } catch {
            throw HelperActionError("UU_CLIPBOARD_FAILED", "无法恢复剪贴板。", retryable: true)
        }
    }
}

#if canImport(AppKit)
/// Production NSPasteboard adapter that preserves every readable representation for every item.
final class SystemPasteboardProvider: PasteboardProviding {
    private let pasteboard: NSPasteboard
    init(pasteboard: NSPasteboard = .general) { self.pasteboard = pasteboard }

    func readItems() throws -> [PasteboardItemSnapshot] {
        (pasteboard.pasteboardItems ?? []).map { item in
            var representations: [String: Data] = [:]
            for type in item.types {
                if let data = item.data(forType: type) { representations[type.rawValue] = data }
            }
            return PasteboardItemSnapshot(representations: representations)
        }
    }

    func replaceItems(_ items: [PasteboardItemSnapshot]) throws {
        pasteboard.clearContents()
        let nativeItems = items.map { snapshot -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (rawType, data) in snapshot.representations {
                item.setData(data, forType: NSPasteboard.PasteboardType(rawType))
            }
            return item
        }
        guard pasteboard.writeObjects(nativeItems) || nativeItems.isEmpty else {
            throw HelperActionError("UU_CLIPBOARD_FAILED", "NSPasteboard 拒绝写入。")
        }
    }
}
#else
/// Non-macOS placeholder used only so protocol/unit tests compile outside the production platform.
final class SystemPasteboardProvider: PasteboardProviding {
    func readItems() throws -> [PasteboardItemSnapshot] { throw HelperActionError("UU_CLIPBOARD_FAILED", "clipboard requires macOS") }
    func replaceItems(_ items: [PasteboardItemSnapshot]) throws { throw HelperActionError("UU_CLIPBOARD_FAILED", "clipboard requires macOS") }
}
#endif
