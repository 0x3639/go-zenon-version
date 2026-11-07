export interface ObserverEnvelope<T> {
  schemaVersion: '1.0'; observerId: string; generatedAt: string; windowStart: string; windowEnd: string;
  methodVersion: 'collection-1'; dataQuality: Record<string, unknown>; result: T;
}
export interface ObserverPage<T> { data: T[]; nextOffset: number | null }
export interface ObserverStatus {
  captureState: string; connectedPeers: number; configuredPeers: number; captureDrops: number;
  referenceObservedAt: string | null; referenceError: string; queueDepth: number | null;
  statisticsWindowSeconds: number | null; distinctCheckedLiveMomentums: number | null;
}
export interface ObserverPeer {
  sessionId: string; bootId: string; peerId: string; ip: string; port: number | null;
  advertisedVersion: string | null; versionObservedAt: string | null; connectedAt: string;
  disconnectedAt: string | null; uncleanShutdown: boolean;
}
export interface ObserverMomentum {
  hash: string; height: number; timestamp: number; producerAddress: string | null;
  signerConflict: boolean; verificationState: string; firstObservedAt: string;
  producerSoftwareVersion: null;
}
export interface ObserverArrival {
  bootId: string; sessionId: string; peerId: string; hash: string; ip: string;
  eventKind: string; arrivedAt: string; advertisedVersion: string | null; versionObservedAt: string | null;
  eligible: boolean; exclusionReason: string; rankingEligible: false; duplicateCount: number;
  verificationState: string; producerAddress: string | null; producerSoftwareVersion: null;
}
export interface ObserverPillar {
  producerAddress: string; producerSoftwareVersion: null;
  nameSnapshots: { pillarName: string; observedAt: string; historicalAssignmentVerified: boolean }[];
  momentums: ObserverMomentum[]; nameSnapshotsNextOffset: number | null; momentumsNextOffset: number | null;
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fail = (): never => { throw new Error('The Observer response did not match the supported format.'); };
function record(x: unknown) { return object(x) ? x : fail(); }
function string(x: unknown, max = 256): string { return typeof x === 'string' && x.length <= max ? x : fail(); }
function number(x: unknown): number { return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : fail(); }
function boolean(x: unknown): boolean { return typeof x === 'boolean' ? x : fail(); }
function nullableNumber(x: unknown) { return x == null ? null : number(x); }
function nullableString(x: unknown) { return x == null ? null : string(x); }
function timestamp(x: unknown): string {
  const s = string(x, 40);
  return /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(s) && Number.isFinite(Date.parse(s)) ? s : fail();
}
function optionalTimestamp(x: unknown) { return x == null || x === '' || String(x).startsWith('0001-') ? null : timestamp(x); }
function matching(x: unknown, pattern: RegExp) { const s = string(x); return pattern.test(s) ? s : fail(); }
const hash = (x: unknown) => matching(x, /^[0-9a-f]{64}$/);
const peer = (x: unknown) => matching(x, /^[0-9a-f]{128}$/);
const address = (x: unknown) => matching(x, /^z1[023456789acdefghjklmnpqrstuvwxyz]{38}$/);
function producer(x: unknown) { return x === null ? null : address(x); }
function unknownVersion(x: unknown): null { return x === null ? null : fail(); }
function offset(x: unknown) { const n = x === null ? null : number(x); return n === null || n <= 100000 ? n : fail(); }
function rows<T>(x: unknown, parse: (value: unknown) => T, max = 500): T[] {
  if (!Array.isArray(x) || x.length > max) return fail();
  return x.map(parse);
}
function verification(x: unknown): string {
  const s = string(x);
  return ['signature_checked', 'rpc_observed', 'rpc_agreed', 'disputed'].includes(s) ? s : fail();
}
function envelope<T>(value: unknown, parse: (value: unknown) => T): ObserverEnvelope<T> {
  const x = record(value), q = record(x.dataQuality);
  if (x.schemaVersion !== '1.0' || x.methodVersion !== 'collection-1' || JSON.stringify(q).length > 16384) return fail();
  if ('producerSoftwareVersion' in q) unknownVersion(q.producerSoftwareVersion);
  for (const key of ['ready', 'rankingsAvailable', 'consensusValidated']) if (key in q) boolean(q[key]);
  for (const key of ['captureDropsInOverlappingRuns', 'clockJumpsInOverlappingRuns', 'interruptedRuns']) if (key in q) number(q[key]);
  if (q.statusUpdatedAt != null) timestamp(q.statusUpdatedAt);
  const start = timestamp(x.windowStart), end = timestamp(x.windowEnd);
  if (Date.parse(start) > Date.parse(end)) return fail();
  return { schemaVersion: '1.0', methodVersion: 'collection-1', observerId: string(x.observerId), generatedAt: timestamp(x.generatedAt), windowStart: start, windowEnd: end, dataQuality: q, result: parse(x.result) };
}
function page<T>(x: unknown, parse: (value: unknown) => T): ObserverPage<T> {
  const r = record(x); return { data: rows(r.data, parse), nextOffset: offset(r.nextOffset) };
}
function parseMomentum(value: unknown): ObserverMomentum {
  const m = record(value), conflict = m.signerConflict === undefined ? false : boolean(m.signerConflict);
  const p = producer(m.producerAddress);
  if (conflict && p !== null) return fail();
  const unix = number(m.timestamp);
  if (!Number.isFinite(new Date(unix * 1000).getTime())) return fail();
  return { hash: hash(m.hash), height: number(m.height), timestamp: unix, producerAddress: p,
    signerConflict: conflict, verificationState: verification(m.verificationState), firstObservedAt: timestamp(m.firstObservedAt), producerSoftwareVersion: unknownVersion(m.producerSoftwareVersion) };
}
export const parseObserverStatus = (value: unknown) => envelope(value, value => {
  const s = record(value);
  return { captureState: string(s.captureState), connectedPeers: number(s.connectedPeers), configuredPeers: number(s.configuredPeers), captureDrops: number(s.captureDrops),
    referenceObservedAt: optionalTimestamp(s.referenceObservedAt), referenceError: s.referenceError == null ? '' : string(s.referenceError, 1000),
    queueDepth: nullableNumber(s.queueDepth), statisticsWindowSeconds: nullableNumber(s.statisticsWindowSeconds), distinctCheckedLiveMomentums: nullableNumber(s.distinctCheckedLiveMomentums) };
});
export const parseObserverPeers = (value: unknown) => envelope(value, value => page(value, value => {
  const s = record(value);
  return { sessionId: string(s.sessionId), bootId: string(s.bootId), peerId: peer(s.peerId), ip: string(s.ip, 64), port: nullableNumber(s.port),
    advertisedVersion: nullableString(s.advertisedVersion), versionObservedAt: optionalTimestamp(s.versionObservedAt), connectedAt: timestamp(s.connectedAt),
    disconnectedAt: s.disconnectedAt === null ? null : timestamp(s.disconnectedAt), uncleanShutdown: s.uncleanShutdown === undefined ? false : boolean(s.uncleanShutdown) };
}));
export const parseObserverMomentums = (value: unknown) => envelope(value, value => page(value, parseMomentum));
export const parseObserverArrivals = (value: unknown) => envelope(value, value => page(value, value => {
  const a = record(value);
  if (a.rankingEligible !== false) return fail();
  const eventKind = string(a.eventKind);
  if (!['hash_announcement', 'full_broadcast', 'requested_response', 'historical_or_unresolved'].includes(eventKind)) return fail();
  return { bootId: string(a.bootId), sessionId: string(a.sessionId), peerId: peer(a.peerId), hash: hash(a.hash), ip: string(a.ip, 64),
    eventKind, arrivedAt: timestamp(a.arrivedAt), advertisedVersion: nullableString(a.advertisedVersion), versionObservedAt: optionalTimestamp(a.versionObservedAt),
    eligible: boolean(a.eligible), exclusionReason: string(a.exclusionReason ?? ''), rankingEligible: false as const, duplicateCount: number(a.duplicateCount),
    verificationState: string(a.verificationState) || 'unresolved', producerAddress: producer(a.producerAddress), producerSoftwareVersion: unknownVersion(a.producerSoftwareVersion) };
}));
export const parseObserverPillar = (value: unknown) => envelope(value, value => {
  const p = record(value);
  return { producerAddress: address(p.producerAddress), producerSoftwareVersion: unknownVersion(p.producerSoftwareVersion),
    nameSnapshots: rows(p.nameSnapshots, value => { const n = record(value); return { pillarName: string(n.pillarName), observedAt: timestamp(n.observedAt), historicalAssignmentVerified: boolean(n.historicalAssignmentVerified) }; }),
    momentums: rows(p.momentums, parseMomentum), nameSnapshotsNextOffset: offset(p.nameSnapshotsNextOffset), momentumsNextOffset: offset(p.momentumsNextOffset) };
});
export const parseObserverAnalysis = (value: unknown) => envelope(value, value => {
  const a = record(value);
  return { available: boolean(a.available), reason: string(a.reason ?? '') };
});

// Fresh response generation does not prove that its upstream reference is fresh.
export function observerIsStale(data: ObserverEnvelope<unknown>, now = Date.now()) {
  return [data.generatedAt, data.dataQuality.statusUpdatedAt].filter((x): x is string => typeof x === 'string').some(t => {
    const age = now - Date.parse(t); return age > 90000 || age < -30000;
  });
}
export function referenceIsFresh(time: string | null, now = Date.now()) {
  if (!time) return false;
  const age = now - Date.parse(time); return age >= -30000 && age <= 120000;
}

export class ObserverRequestError extends Error {
  retryAfterMs: number;
  constructor(message: string, retryAfterMs = 0) { super(message); this.retryAfterMs = retryAfterMs; }
}
export async function fetchObserver<T>(url: string, parse: (x: unknown) => ObserverEnvelope<T>, signal: AbortSignal, request = fetch) {
  const response = await request(url, { credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]), headers: { Accept: 'application/json' } });
  if (!response.ok) {
    const retry = response.headers.get('Retry-After');
    const retryMs = retry ? (/^\d+$/.test(retry) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : 0;
    throw new ObserverRequestError(response.status === 429 ? 'Observer is busy. Retrying with backoff.' : response.status === 413 ? 'This evidence page is too large to display.' : 'Observer is temporarily unavailable. Retrying automatically.', Number.isFinite(retryMs) ? Math.min(300000, Math.max(0, retryMs)) : 0);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ObserverRequestError('Observer returned an empty response.');
  const decoder = new TextDecoder(); let raw = '', bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.byteLength;
      if (bytes > 1048576) throw new ObserverRequestError('This evidence page is too large to display.');
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } finally { await reader.cancel(); }
  return parse(JSON.parse(raw));
}
