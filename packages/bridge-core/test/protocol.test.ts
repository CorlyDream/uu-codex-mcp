import { describe, expect, it } from 'vitest';
import { UuError } from '../src/errors.js';
import { createRequestId, markersFor } from '../src/protocol/markers.js';
import { buildExecutionCommand } from '../src/protocol/powershell.js';
import { buildPageCommand, decodeRemoteResult, parseMeta, parsePage } from '../src/protocol/result-pages.js';

describe('remote result protocol', () => {
  it('creates 24 lowercase hex request ids', () => {
    const id = createRequestId();
    expect(id).toMatch(/^[0-9a-f]{24}$/);
    expect(id).toHaveLength(24);
  });

  it('does not embed the complete output marker literal in the command text', () => {
    const requestId = '0123456789abcdef01234567';
    const markers = markersFor(requestId);
    const script = buildExecutionCommand('Write-Output "hello"', requestId);
    expect(script).not.toContain(markers.meta);
    expect(script).toContain("'__UU_META_' +");
  });

  it('base64-encodes the user command rather than interpolating raw powershell', () => {
    const script = buildExecutionCommand('Write-Output "secret raw text"', '0123456789abcdef01234567');
    expect(script).not.toContain('secret raw text');
    expect(script).toContain('FromBase64String');
  });

  it('parses the last meta marker from noisy terminal text', () => {
    const markers = markersFor('0123456789abcdef01234567');
    const text = `${markers.meta}:11\nold\nnoise\n${markers.meta}:932\nPS C:\\>`;
    expect(parseMeta(text, markers)).toEqual({ length: 932 });
  });

  it('extracts only the last complete page and joins base64 lines', () => {
    const markers = markersFor('0123456789abcdef01234567');
    const text = `noise\n${markers.pageBegin}\nAAAA\nBBBB\n${markers.pageEnd}\nmore\n${markers.pageBegin}\nCCCC\n DDDD \n${markers.pageEnd}\nprompt`;
    expect(parsePage(text, markers)).toBe('CCCCDDDD');
  });

  it('decodes utf8 Chinese, empty output and error strings', () => {
    const payload = { stdout: '你好\n', success: false, exitCode: 1, error: '错误信息' };
    const base64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64');
    expect(decodeRemoteResult(base64)).toEqual(payload);
    const empty = { stdout: '', success: true, exitCode: 0, error: null };
    expect(decodeRemoteResult(Buffer.from(JSON.stringify(empty)).toString('base64'))).toEqual(empty);
  });

  it('rejects corrupt base64 with UU_RESULT_DECODE_FAILED', () => {
    let caught: unknown;
    try { decodeRemoteResult('%%%not-base64%%%'); } catch (error) { caught = error; }
    expect(caught instanceof UuError ? caught.code : null).toBe('UU_RESULT_DECODE_FAILED');
  });

  it('builds a bounded page command without full marker literals', () => {
    const requestId = '0123456789abcdef01234567';
    const markers = markersFor(requestId);
    const script = buildPageCommand(requestId, 384);
    expect(script).toContain('[Math]::Min(384');
    expect(script).toContain('$i += 48');
    expect(script).not.toContain(markers.pageBegin);
    expect(script).not.toContain(markers.pageEnd);
  });
});
