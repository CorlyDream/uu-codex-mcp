export type UuPlatform = 'windows' | 'macos' | 'linux' | 'unknown';

export interface UuDevice {
  id: string;
  name: string;
  platform: UuPlatform;
  online: boolean;
}

export interface ExecRequest {
  deviceId: string;
  command: string;
  timeoutMs: number;
}

export interface ExecResult {
  requestId: string;
  deviceId: string;
  stdout: string;
  success: boolean;
  exitCode: number | null;
  error: string | null;
  durationMs: number;
  transport: 'gui';
}
