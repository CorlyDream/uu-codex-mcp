export const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
export const MIN_COMMAND_TIMEOUT_MS = 1_000;
export const MAX_COMMAND_TIMEOUT_MS = 300_000;
export const MAX_COMMAND_BYTES = 16 * 1024;
export const RESULT_PAGE_CHARS = 384;
export const RESULT_PAGE_LINE_CHARS = 48;
export const HELPER_SOCKET_PATH = `/tmp/uu-codex-mcp-${process.getuid?.() ?? process.pid}.sock`;

export interface BridgeConfig {
  cliPath?: string;
  helperSocketPath: string;
  commandTimeoutMs: number;
}

/** Build bridge defaults while allowing callers/tests to override only explicit values. */
export function createBridgeConfig(overrides: Partial<BridgeConfig> = {}): BridgeConfig {
  return {
    helperSocketPath: HELPER_SOCKET_PATH,
    commandTimeoutMs: DEFAULT_COMMAND_TIMEOUT_MS,
    ...overrides,
  };
}
