import Foundation

/// JSON value used at the socket boundary so requests stay Codable without accepting arbitrary native objects.
enum JSONValue: Codable, Equatable {
    case string(String)
    case bool(Bool)
    case int(Int)
    case double(Double)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Int.self) { self = .int(value) }
        else if let value = try? container.decode(Double.self) { self = .double(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([String: JSONValue].self) { self = .object(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value") }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value): try container.encode(value)
        case .bool(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .null: try container.encodeNil()
        }
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }
}

/// One newline-delimited request accepted from the local Node bridge.
struct HelperRequest: Codable, Equatable {
    let id: String
    let action: String
    let args: [String: JSONValue]
}

/// Error shape intentionally excludes Swift stacks and implementation details.
struct HelperErrorPayload: Codable, Equatable {
    let code: String
    let message: String
    let retryable: Bool
}

/// One newline-delimited response sent back to the local Node bridge.
struct HelperResponse: Codable, Equatable {
    let id: String
    let ok: Bool
    let result: [String: JSONValue]?
    let error: HelperErrorPayload?

    static func success(id: String, result: [String: JSONValue] = [:]) -> HelperResponse {
        HelperResponse(id: id, ok: true, result: result, error: nil)
    }

    static func failure(id: String, code: String, message: String, retryable: Bool = false) -> HelperResponse {
        HelperResponse(id: id, ok: false, result: nil, error: HelperErrorPayload(code: code, message: message, retryable: retryable))
    }
}
