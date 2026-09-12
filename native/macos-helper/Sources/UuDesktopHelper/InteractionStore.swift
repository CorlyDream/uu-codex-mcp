import Foundation

/// State owned by one locally-created interaction; opaque native handles are never supplied by Node.
struct InteractionRecord {
    let id: UUID
    var windowHandleId: UUID?
    var clipboardSnapshotIds: Set<UUID>
}

/// In-memory authority for interaction identifiers and the native resources associated with them.
final class InteractionStore {
    private var records: [UUID: InteractionRecord] = [:]
    private let lock = NSLock()

    /// Create a fresh interaction identifier controlled by this helper process.
    func create(windowHandleId: UUID? = nil) -> UUID {
        lock.lock(); defer { lock.unlock() }
        let id = UUID()
        records[id] = InteractionRecord(id: id, windowHandleId: windowHandleId, clipboardSnapshotIds: [])
        return id
    }

    /// Remove an interaction and forget all native ownership attached to it.
    @discardableResult
    func remove(_ id: UUID) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return records.removeValue(forKey: id) != nil
    }

    /// Return whether an identifier was created by this process and is still live.
    func contains(_ id: UUID) -> Bool {
        lock.lock(); defer { lock.unlock() }
        return records[id] != nil
    }
}
