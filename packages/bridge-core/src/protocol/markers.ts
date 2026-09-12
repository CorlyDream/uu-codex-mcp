import { randomBytes } from 'node:crypto';

export interface RequestMarkers {
  meta: string;
  pageBegin: string;
  pageEnd: string;
}

/** Generate an unpredictable request id used to correlate one GUI terminal exchange. */
export function createRequestId(): string {
  return randomBytes(12).toString('hex');
}

/** Return the marker literals expected in rendered terminal output. */
export function markersFor(requestId: string): RequestMarkers {
  return {
    meta: `__UU_META_${requestId}__`,
    pageBegin: `__UU_PAGE_BEGIN_${requestId}__`,
    pageEnd: `__UU_PAGE_END_${requestId}__`,
  };
}
