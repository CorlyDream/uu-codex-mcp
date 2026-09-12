import type { UuDevice, UuPlatform } from '../types.js';

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : null;
}

function platformOf(value: unknown): UuPlatform {
  if (value === 1) return 'windows';
  if (typeof value !== 'string') return 'unknown';
  const normalized = value.toLowerCase();
  if (normalized === 'windows' || normalized === 'win') return 'windows';
  if (normalized === 'mac' || normalized === 'macos' || normalized === 'darwin') return 'macos';
  if (normalized === 'linux') return 'linux';
  return 'unknown';
}

function onlineOf(item: RecordValue): boolean {
  if (typeof item.isOnline === 'boolean') return item.isOnline;
  if (typeof item.online === 'boolean') return item.online;
  return typeof item.status === 'string' && item.status.toLowerCase() === 'online';
}

/** Normalize the known UU CLI response variants into one stable device shape. */
export function normalizeDeviceList(payload: unknown): UuDevice[] {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  if (!data) return [];
  const raw = [data.devices, data.connections, data.connected_devices].find(Array.isArray);
  if (!Array.isArray(raw)) return [];

  const output: UuDevice[] = [];
  for (const value of raw) {
    const item = asRecord(value);
    if (!item) continue;
    const id = item.deviceId ?? item.id ?? item.device_id;
    const name = item.deviceName ?? item.name ?? item.device_name;
    if (typeof id !== 'string' || typeof name !== 'string') continue;
    output.push({ id, name, online: onlineOf(item), platform: platformOf(item.platform) });
  }
  return output;
}
