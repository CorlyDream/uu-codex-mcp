import { UuError, type UuErrorCode } from '../errors.js';

export type HelperArgs = Record<string, unknown>;
export type HelperResult = Record<string, unknown>;

interface HelperFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export interface HelperResponse {
  id: string;
  ok: boolean;
  result?: HelperResult;
  error?: HelperFailure;
}

const KNOWN_ERROR_CODES = new Set<UuErrorCode>([
  'UU_CLI_NOT_FOUND', 'UU_APP_NOT_RUNNING', 'UU_DEVICE_NOT_FOUND', 'UU_DEVICE_OFFLINE',
  'UU_DEVICE_PLATFORM_UNSUPPORTED', 'UU_TERM_OPEN_FAILED', 'UU_TERM_NOT_OWNED',
  'UU_TERM_WINDOW_NOT_FOUND', 'UU_TERM_WINDOW_AMBIGUOUS', 'UU_TERM_FOCUS_UNPROVEN',
  'UU_ACCESSIBILITY_PERMISSION_DENIED', 'UU_GUI_SESSION_UNAVAILABLE', 'UU_HELPER_UNAVAILABLE',
  'UU_HELPER_PROTOCOL_ERROR', 'UU_CLIPBOARD_FAILED', 'UU_COMMAND_TIMEOUT',
  'UU_RESULT_MARKER_TIMEOUT', 'UU_RESULT_DECODE_FAILED', 'UU_SESSION_CLOSE_FAILED',
  'UU_COMMAND_TOO_LONG', 'UU_INVALID_ARGUMENT',
]);

/** Convert a helper-supplied code to the stable bridge error union without trusting arbitrary strings. */
export function helperErrorCode(code: unknown): UuErrorCode {
  return typeof code === 'string' && KNOWN_ERROR_CODES.has(code as UuErrorCode)
    ? code as UuErrorCode
    : 'UU_HELPER_PROTOCOL_ERROR';
}

/** Validate the minimum response envelope before typed convenience methods inspect its result. */
export function validateHelperResponse(value: unknown, requestId: string): HelperResponse {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper 返回了无效响应。', true);
  }
  const response = value as Record<string, unknown>;
  if (response.id !== requestId || typeof response.ok !== 'boolean') {
    throw new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper 响应 ID 或状态无效。', true);
  }
  if (response.ok) {
    if (response.result !== undefined && (!response.result || typeof response.result !== 'object' || Array.isArray(response.result))) {
      throw new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper result 格式无效。', true);
    }
    return { id: requestId, ok: true, result: (response.result ?? {}) as HelperResult };
  }
  const error = response.error;
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    throw new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper error 格式无效。', true);
  }
  const failure = error as Record<string, unknown>;
  if (typeof failure.message !== 'string' || typeof failure.retryable !== 'boolean') {
    throw new UuError('UU_HELPER_PROTOCOL_ERROR', 'Desktop Helper error 字段无效。', true);
  }
  return {
    id: requestId,
    ok: false,
    error: {
      code: typeof failure.code === 'string' ? failure.code : 'UU_HELPER_PROTOCOL_ERROR',
      message: failure.message,
      retryable: failure.retryable,
    },
  };
}
