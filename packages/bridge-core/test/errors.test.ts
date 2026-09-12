import { describe, expect, it } from 'vitest';
import { UuError } from '../src/errors.js';

describe('UuError', () => {
  it('serializes stable MCP-safe error fields', () => {
    const error = new UuError('UU_DEVICE_OFFLINE', '目标设备当前离线', true, { deviceId: 'dev-1' });
    expect(error.toJSON()).toEqual({
      code: 'UU_DEVICE_OFFLINE',
      message: '目标设备当前离线',
      retryable: true,
      details: { deviceId: 'dev-1' },
    });
  });
});
