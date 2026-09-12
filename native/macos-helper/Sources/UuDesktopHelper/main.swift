import Dispatch
import Foundation
#if canImport(Darwin)
import Darwin
#else
import Glibc
#endif

final class SignalLifetime {
    var sources: [DispatchSourceSignal] = []
}

/// Parse the mandatory local socket path without accepting network listeners or implicit defaults.
private func parseSocketPath(arguments: [String]) -> String? {
    guard let index = arguments.firstIndex(of: "--socket"), arguments.indices.contains(index + 1) else { return nil }
    let value = arguments[index + 1]
    return value.isEmpty ? nil : value
}

let arguments = CommandLine.arguments

guard let socketPath = parseSocketPath(arguments: arguments) else {
    FileHandle.standardError.write(Data("usage: uu-desktop-helper --socket <path>\n".utf8))
    exit(64)
}

let service = HelperService(interactions: InteractionStore())
let server = UnixSocketServer(path: socketPath, service: service)
let signals = SignalLifetime()
for signalNumber in [SIGINT, SIGTERM] {
    signal(signalNumber, SIG_IGN)
    let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .global())
    source.setEventHandler {
        server.stop()
    }
    source.resume()
    signals.sources.append(source)
}

signal(SIGPIPE, SIG_IGN)

do {
    try server.start()
    defer { server.stop() }
    try server.run()
} catch {
    FileHandle.standardError.write(Data("uu-desktop-helper: \(error)\n".utf8))
    exit(1)
}
