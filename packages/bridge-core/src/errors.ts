export type UuErrorCode =
  | 'UU_CLI_NOT_FOUND'
  | 'UU_APP_NOT_RUNNING'
  | 'UU_DEVICE_NOT_FOUND'
  | 'UU_DEVICE_OFFLINE'
  | 'UU_DEVICE_PLATFORM_UNSUPPORTED'
  | 'UU_TERM_OPEN_FAILED'
  | 'UU_TERM_NOT_OWNED'
  | 'UU_TERM_WINDOW_NOT_FOUND'
  | 'UU_TERM_WINDOW_AMBIGUOUS'
  | 'UU_TERM_FOCUS_UNPROVEN'
  | 'UU_ACCESSIBILITY_PERMISSION_DENIED'
  | 'UU_GUI_SESSION_UNAVAILABLE'
  | 'UU_HELPER_UNAVAILABLE'
  | 'UU_HELPER_PROTOCOL_ERROR'
  | 'UU_CLIPBOARD_FAILED'
  | 'UU_COMMAND_TIMEOUT'
  | 'UU_RESULT_MARKER_TIMEOUT'
  | 'UU_RESULT_DECODE_FAILED'
  | 'UU_SESSION_CLOSE_FAILED'
  | 'UU_COMMAND_TOO_LONG'
  | 'UU_INVALID_ARGUMENT';

/** Error type exposed across the bridge/MCP boundary with stable machine-readable codes. */
export class UuError extends Error {
  constructor(
    public readonly code: UuErrorCode,
    message: string,
    public readonly retryable: boolean,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'UuError';
  }

  /** Convert the error to a JSON-safe shape without stack traces or secrets. */
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}
