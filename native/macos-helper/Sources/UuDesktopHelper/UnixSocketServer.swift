import Dispatch
import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

private let maximumRequestBytes = 256 * 1024

private enum SocketServerError: Error, CustomStringConvertible {
    case invalidPath
    case unsafeExistingPath
    case alreadyRunning
    case system(String, Int32)

    var description: String {
        switch self {
        case .invalidPath: return "invalid unix socket path"
        case .unsafeExistingPath: return "refusing to replace a socket path not owned by the current user"
        case .alreadyRunning: return "a helper is already accepting connections on this socket"
        case .system(let operation, let code): return "\(operation) failed (errno=\(code))"
        }
    }
}

/// Sequential newline-delimited JSON server bound to a user-only filesystem Unix socket.
final class UnixSocketServer {
    private let path: String
    private let service: HelperService
    private var listenFD: Int32 = -1
    private var stopping = false
    private var ownsSocketPath = false
    private let stateLock = NSLock()

    init(path: String, service: HelperService) {
        self.path = path
        self.service = service
    }

    deinit { stop() }

    /// Bind the socket after safely removing only a stale, same-user Unix socket.
    func start() throws {
        try preparePath()
        #if canImport(Darwin)
        let streamType = SOCK_STREAM
        #else
        let streamType = Int32(SOCK_STREAM.rawValue)
        #endif
        let fd = socket(AF_UNIX, streamType, 0)
        guard fd >= 0 else { throw SocketServerError.system("socket", errno) }
        do {
            var address = try makeAddress(path)
            let result = withUnsafePointer(to: &address) { pointer in
                pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                }
            }
            guard result == 0 else { throw SocketServerError.system("bind", errno) }
            stateLock.lock(); ownsSocketPath = true; stateLock.unlock()
            guard chmod(path, mode_t(0o600)) == 0 else { throw SocketServerError.system("chmod", errno) }
            guard listen(fd, 8) == 0 else { throw SocketServerError.system("listen", errno) }
            stateLock.lock(); listenFD = fd; stateLock.unlock()
        } catch {
            close(fd)
            stateLock.lock()
            let shouldUnlink = ownsSocketPath
            ownsSocketPath = false
            stateLock.unlock()
            if shouldUnlink { unlink(path) }
            throw error
        }
    }

    /// Accept and serve one client at a time so GUI operations cannot overlap in MVP mode.
    func run() throws {
        while !isStopping {
            let client = accept(listenFD, nil, nil)
            if client < 0 {
                if isStopping { return }
                if errno == EINTR { continue }
                throw SocketServerError.system("accept", errno)
            }
            serve(client)
            close(client)
        }
    }

    /// Close the listening descriptor and unlink only this server's configured socket path.
    func stop() {
        stateLock.lock()
        if stopping { stateLock.unlock(); return }
        stopping = true
        let fd = listenFD
        let shouldUnlink = ownsSocketPath
        listenFD = -1
        ownsSocketPath = false
        stateLock.unlock()
        if fd >= 0 { _ = shutdown(fd, Int32(SHUT_RDWR)); close(fd) }
        if shouldUnlink { unlink(path) }
    }

    private var isStopping: Bool {
        stateLock.lock(); defer { stateLock.unlock() }
        return stopping
    }

    private func serve(_ fd: Int32) {
        var pending = Data()
        var buffer = [UInt8](repeating: 0, count: 8192)
        while true {
            let count = buffer.withUnsafeMutableBytes { raw -> Int in
                guard let base = raw.baseAddress else { return -1 }
                return read(fd, base, raw.count)
            }
            if count <= 0 { return }
            pending.append(buffer, count: count)
            if pending.count > maximumRequestBytes && !pending.contains(0x0a) { return }
            while let newline = pending.firstIndex(of: 0x0a) {
                let line = pending.prefix(upTo: newline)
                pending.removeSubrange(...newline)
                if line.count > maximumRequestBytes { return }
                let response = decodeAndHandle(Data(line))
                guard let encoded = try? JSONEncoder().encode(response) else { return }
                var framed = encoded
                framed.append(0x0a)
                if !writeAll(fd, framed) { return }
            }
        }
    }

    private func decodeAndHandle(_ data: Data) -> HelperResponse {
        do {
            let request = try JSONDecoder().decode(HelperRequest.self, from: data)
            return service.handle(request)
        } catch {
            return .failure(id: "", code: "UU_HELPER_PROTOCOL_ERROR", message: "invalid helper request")
        }
    }

    private func writeAll(_ fd: Int32, _ data: Data) -> Bool {
        data.withUnsafeBytes { raw -> Bool in
            guard let base = raw.baseAddress else { return true }
            var offset = 0
            while offset < raw.count {
                let written = write(fd, base.advanced(by: offset), raw.count - offset)
                if written <= 0 { return false }
                offset += written
            }
            return true
        }
    }

    private func preparePath() throws {
        guard !path.isEmpty, path.utf8.count < unixPathCapacity else { throw SocketServerError.invalidPath }
        var info = stat()
        if lstat(path, &info) != 0 {
            if errno == ENOENT { return }
            throw SocketServerError.system("lstat", errno)
        }
        let kind = info.st_mode & mode_t(S_IFMT)
        guard kind == mode_t(S_IFSOCK), info.st_uid == getuid() else { throw SocketServerError.unsafeExistingPath }
        if try canConnect(path) { throw SocketServerError.alreadyRunning }
        guard unlink(path) == 0 || errno == ENOENT else { throw SocketServerError.system("unlink", errno) }
    }

    private func canConnect(_ path: String) throws -> Bool {
        #if canImport(Darwin)
        let streamType = SOCK_STREAM
        #else
        let streamType = Int32(SOCK_STREAM.rawValue)
        #endif
        let fd = socket(AF_UNIX, streamType, 0)
        guard fd >= 0 else { throw SocketServerError.system("socket", errno) }
        defer { close(fd) }
        var address = try makeAddress(path)
        let result = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        if result == 0 { return true }
        if errno == ECONNREFUSED || errno == ENOENT { return false }
        throw SocketServerError.system("connect", errno)
    }
}

private var unixPathCapacity: Int { MemoryLayout.size(ofValue: sockaddr_un().sun_path) }

private func makeAddress(_ path: String) throws -> sockaddr_un {
    let bytes = Array(path.utf8CString)
    guard bytes.count <= unixPathCapacity else { throw SocketServerError.invalidPath }
    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    #if canImport(Darwin)
    address.sun_len = UInt8(MemoryLayout<sockaddr_un>.size)
    #endif
    withUnsafeMutablePointer(to: &address.sun_path) { pointer in
        pointer.withMemoryRebound(to: CChar.self, capacity: unixPathCapacity) { chars in
            for index in 0..<bytes.count { chars[index] = bytes[index] }
        }
    }
    return address
}
