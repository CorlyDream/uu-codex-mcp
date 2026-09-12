import Foundation

/// Dispatches the narrow JSON action protocol; platform-specific UI work is added behind this boundary later.
final class HelperService {
    private let interactions: InteractionStore

    init(interactions: InteractionStore) {
        self.interactions = interactions
    }

    /// Handle one validated request without exposing Swift errors or internal object identifiers.
    func handle(_ request: HelperRequest) -> HelperResponse {
        switch request.action {
        case "health":
            return .success(id: request.id, result: ["status": .string("ok")])
        case "end_interaction":
            guard let raw = request.args["interaction_id"]?.stringValue, let id = UUID(uuidString: raw) else {
                return .failure(id: request.id, code: "UU_HELPER_PROTOCOL_ERROR", message: "interaction_id is required")
            }
            guard interactions.remove(id) else {
                return .failure(id: request.id, code: "UU_HELPER_PROTOCOL_ERROR", message: "interaction_id is unknown")
            }
            return .success(id: request.id)
        default:
            return .failure(id: request.id, code: "UU_HELPER_PROTOCOL_ERROR", message: "unsupported helper action")
        }
    }
}
