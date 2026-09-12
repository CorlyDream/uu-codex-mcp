import { UuError } from '@uu-codex/bridge-core';

export interface TextToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Serialize tool payloads as compact JSON text so Codex receives stable machine-readable output. */
export function jsonResult(value: unknown): TextToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

/** Convert expected bridge failures and unexpected exceptions to safe MCP tool errors. */
export function toolError(error: unknown): TextToolResult {
  const safe = error instanceof UuError
    ? error
    : new UuError('UU_HELPER_PROTOCOL_ERROR', 'UU MCP 内部执行失败。', true);
  return { isError: true, content: [{ type: 'text', text: JSON.stringify(safe.toJSON()) }] };
}
