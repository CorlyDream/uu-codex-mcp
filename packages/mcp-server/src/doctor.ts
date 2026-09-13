import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DesktopHelperClient,
  UuCliAdapter,
  UuError,
  desktopHelperBinaryPath,
  discoverUuInstallation,
  ensureDesktopHelper,
  type CliCapabilities,
  type UuDevice,
} from '@uu-codex/bridge-core';

export interface DoctorHealth { status: string; accessibilityTrusted: boolean }
export interface DoctorCapabilities { termOpen: boolean; termPipe: boolean }
export interface DoctorError { code: string; message: string }

export interface DoctorReport {
  cli_found: boolean;
  app_bundle_found: boolean;
  device_list_ok: boolean;
  term_open_supported: boolean;
  term_pipe_supported: boolean;
  helper_binary_found: boolean;
  helper_reachable: boolean;
  accessibility_trusted: boolean;
  errors: DoctorError[];
}

export interface DoctorDependencies {
  discover(): Promise<{ cliPath: string; appBundlePath: string }>;
  listDevices(cliPath: string): Promise<UuDevice[]>;
  capabilities(cliPath: string): Promise<DoctorCapabilities>;
  helperBinaryPath(): string;
  pathExists(path: string): Promise<boolean>;
  helperHealth(): Promise<DoctorHealth>;
  startHelperAndHealth(): Promise<{ health: DoctorHealth; stop?: () => void }>;
}

function safeDoctorError(error: unknown): DoctorError {
  if (error instanceof UuError) return { code: error.code, message: error.message };
  return { code: 'UU_HELPER_PROTOCOL_ERROR', message: '诊断检查失败。' };
}

/** Run independent, read-only checks. This function never opens or mutates a remote UU terminal. */
export async function runDoctor(deps: DoctorDependencies): Promise<DoctorReport> {
  const report: DoctorReport = {
    cli_found: false,
    app_bundle_found: false,
    device_list_ok: false,
    term_open_supported: false,
    term_pipe_supported: false,
    helper_binary_found: false,
    helper_reachable: false,
    accessibility_trusted: false,
    errors: [],
  };

  let installation: { cliPath: string; appBundlePath: string } | undefined;
  try {
    installation = await deps.discover();
    report.cli_found = true;
    report.app_bundle_found = true;
  } catch (error) {
    report.errors.push(safeDoctorError(error));
  }

  if (installation) {
    try {
      await deps.listDevices(installation.cliPath);
      report.device_list_ok = true;
    } catch (error) {
      report.errors.push(safeDoctorError(error));
    }
    try {
      const capabilities = await deps.capabilities(installation.cliPath);
      report.term_open_supported = capabilities.termOpen;
      report.term_pipe_supported = capabilities.termPipe;
    } catch (error) {
      report.errors.push(safeDoctorError(error));
    }
  }

  const helperPath = deps.helperBinaryPath();
  try {
    report.helper_binary_found = await deps.pathExists(helperPath);
  } catch (error) {
    report.errors.push(safeDoctorError(error));
  }

  try {
    const health = await deps.helperHealth();
    report.helper_reachable = health.status === 'ok';
    report.accessibility_trusted = health.accessibilityTrusted;
  } catch (firstError) {
    if (report.helper_binary_found) {
      try {
        const started = await deps.startHelperAndHealth();
        try {
          report.helper_reachable = started.health.status === 'ok';
          report.accessibility_trusted = started.health.accessibilityTrusted;
        } finally {
          started.stop?.();
        }
      } catch (error) {
        report.errors.push(safeDoctorError(error));
      }
    } else {
      report.errors.push(safeDoctorError(firstError));
    }
  }

  return report;
}

/** Production dependency set: device/capability probes and local helper health only, never term open. */
export function createDoctorDependencies(): DoctorDependencies {
  const helper = new DesktopHelperClient();
  return {
    discover: () => discoverUuInstallation(),
    listDevices: (cliPath) => new UuCliAdapter(cliPath).listDevices(),
    capabilities: async (cliPath) => {
      const value: CliCapabilities = await new UuCliAdapter(cliPath).capabilities();
      return { termOpen: value.termOpen, termPipe: value.termPipe };
    },
    helperBinaryPath: desktopHelperBinaryPath,
    pathExists: async (path) => {
      try { await access(path); return true; }
      catch { return false; }
    },
    helperHealth: () => helper.health(),
    startHelperAndHealth: async () => {
      const child = await ensureDesktopHelper(helper);
      const health = await helper.health();
      return { health, ...(child ? { stop: () => { child.kill(); } } : {}) };
    },
  };
}

/** Print exactly one JSON document; unlike MCP stdio, doctor intentionally owns stdout. */
export async function doctorMain(): Promise<void> {
  const report = await runDoctor(createDoctorDependencies());
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (process.argv?.[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await doctorMain();
}
