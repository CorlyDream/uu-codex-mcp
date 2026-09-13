export type LogFields = Record<string, unknown>;

export interface Logger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const FORBIDDEN_KEYS = new Set(['command', 'stdout', 'clipboard', 'clipboardText', 'fullCommand']);

/** Remove fields that could leak remote commands, output, or local clipboard data. */
function sanitizeFields(fields: LogFields | undefined): LogFields | undefined {
  if (!fields) return undefined;
  return Object.fromEntries(Object.entries(fields).filter(([key]) => !FORBIDDEN_KEYS.has(key)));
}

/** JSON-lines stderr logger; stdout stays reserved exclusively for MCP protocol frames. */
export class StderrLogger implements Logger {
  private write(level: 'info' | 'warn' | 'error', event: string, fields?: LogFields): void {
    const record = { ts: new Date().toISOString(), level, event, ...(sanitizeFields(fields) ?? {}) };
    process.stderr.write(`${JSON.stringify(record)}\n`);
  }

  info(event: string, fields?: LogFields): void {
    this.write('info', event, fields);
  }

  warn(event: string, fields?: LogFields): void {
    this.write('warn', event, fields);
  }

  error(event: string, fields?: LogFields): void {
    this.write('error', event, fields);
  }
}
