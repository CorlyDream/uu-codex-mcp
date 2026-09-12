import { describe, expect, it } from 'vitest';
import { normalizeDeviceList } from '../src/cli/devices.js';

describe('normalizeDeviceList', () => {
  it('normalizes all known UU device containers', () => {
    const fixtures = [
      { data: { devices: [{ deviceId: 'a', deviceName: 'A', isOnline: true, platform: 'windows' }] } },
      { data: { connections: [{ id: 'b', name: 'B', online: true, platform: 1 }] } },
      { data: { connected_devices: [{ device_id: 'c', device_name: 'C', status: 'online', platform: 'windows' }] } },
    ];
    expect(fixtures.flatMap(normalizeDeviceList)).toEqual([
      { id: 'a', name: 'A', online: true, platform: 'windows' },
      { id: 'b', name: 'B', online: true, platform: 'windows' },
      { id: 'c', name: 'C', online: true, platform: 'windows' },
    ]);
  });

  it('maps unknown numeric platforms to unknown', () => {
    expect(normalizeDeviceList({ data: { devices: [{ deviceId: 'x', deviceName: 'X', isOnline: false, platform: 99 }] } })[0]?.platform).toBe('unknown');
  });
});
