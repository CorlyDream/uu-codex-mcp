import { RESULT_PAGE_CHARS, RESULT_PAGE_LINE_CHARS } from '../config.js';
import { UuError } from '../errors.js';
import { markersFor, type RequestMarkers } from './markers.js';

export interface RemoteCommandResult {
  stdout: string;
  success: boolean;
  exitCode: number | null;
  error: string | null;
}

export interface RemoteMeta {
  length: number;
}

/** Parse the newest complete metadata marker from potentially noisy terminal text. */
export function parseMeta(text: string, markers: RequestMarkers): RemoteMeta {
  const index = text.lastIndexOf(markers.meta);
  if (index < 0) throw new UuError('UU_RESULT_MARKER_TIMEOUT', '未在 UU 终端中找到结果元数据标记。', true);
  const tail = text.slice(index + markers.meta.length);
  const match = /^:(\d+)/.exec(tail);
  if (!match) throw new UuError('UU_RESULT_DECODE_FAILED', 'UU 终端结果长度元数据无效。', true);
  const length = Number(match[1]);
  if (!Number.isSafeInteger(length) || length < 0) {
    throw new UuError('UU_RESULT_DECODE_FAILED', 'UU 终端结果长度超出有效范围。', true);
  }
  return { length };
}

/** Build one bounded page request; both marker literals are constructed remotely to avoid echo false positives. */
export function buildPageCommand(requestId: string, offset: number): string {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new UuError('UU_INVALID_ARGUMENT', '分页 offset 必须是非负整数。', false);
  const parts = [
    `$__uuStart=${offset}`,
    `$__uuTake=[Math]::Min(${RESULT_PAGE_CHARS}, [Math]::Max(0, $global:__uuResultB64.Length - $__uuStart))`,
    "$__uuChunk=if ($__uuTake -gt 0) { $global:__uuResultB64.Substring($__uuStart,$__uuTake) } else { '' }",
    `$__uuBegin='__UU_PAGE_BEGIN_' + '${requestId}' + '__'`,
    `$__uuEnd='__UU_PAGE_END_' + '${requestId}' + '__'`,
    'Clear-Host',
    'Write-Output $__uuBegin',
    `for ($i=0; $i -lt $__uuChunk.Length; $i += ${RESULT_PAGE_LINE_CHARS}) { Write-Output $__uuChunk.Substring($i,[Math]::Min(${RESULT_PAGE_LINE_CHARS},$__uuChunk.Length-$i)) }`,
    'Write-Output $__uuEnd',
  ];
  return parts.join('; ');
}

/** Extract the newest complete page pair and join only Base64 payload lines inside it. */
export function parsePage(text: string, markers: RequestMarkers): string {
  const end = text.lastIndexOf(markers.pageEnd);
  if (end < 0) throw new UuError('UU_RESULT_MARKER_TIMEOUT', '未在 UU 终端中找到分页结束标记。', true);
  const begin = text.lastIndexOf(markers.pageBegin, end);
  if (begin < 0) throw new UuError('UU_RESULT_MARKER_TIMEOUT', '未在 UU 终端中找到分页开始标记。', true);
  const payload = text.slice(begin + markers.pageBegin.length, end);
  return payload.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('');
}

function isCanonicalBase64(value: string): boolean {
  if (value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return false;
  try {
    return Buffer.from(value, 'base64').toString('base64') === value;
  } catch {
    return false;
  }
}

/** Decode and validate the exact JSON contract created by the remote PowerShell wrapper. */
export function decodeRemoteResult(base64: string): RemoteCommandResult {
  try {
    if (!isCanonicalBase64(base64)) throw new Error('invalid base64');
    const parsed: unknown = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid object');
    const value = parsed as Record<string, unknown>;
    if (typeof value.stdout !== 'string' || typeof value.success !== 'boolean') throw new Error('invalid required fields');
    if (value.exitCode !== null && typeof value.exitCode !== 'number') throw new Error('invalid exit code');
    if (value.error !== null && typeof value.error !== 'string') throw new Error('invalid error');
    return {
      stdout: value.stdout,
      success: value.success,
      exitCode: value.exitCode as number | null,
      error: value.error as string | null,
    };
  } catch (cause) {
    throw new UuError('UU_RESULT_DECODE_FAILED', '无法解码 UU 远程命令结果。', true, { reason: cause instanceof Error ? cause.message : 'unknown' });
  }
}

/** Convenience helper used by transports to bind parsing to one request id. */
export function markersForPage(requestId: string): RequestMarkers {
  return markersFor(requestId);
}
