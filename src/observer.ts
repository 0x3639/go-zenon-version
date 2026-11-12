export type ObserverMethod = 'collection-1' | 'association-2';
export interface ObserverQuality extends Record<string, unknown> {
  associationSummariesAvailable?: boolean; associationAnalysisImplemented?: boolean;
  analysisState?: string; analysisProcessedHours?: number; analysisPendingHours?: number; analysisRetryingHours?: number;
}
export interface ObserverEnvelope<T> {
  schemaVersion: '1.0' | '1.1'; observerId: string; generatedAt: string; windowStart: string; windowEnd: string;
  methodVersion: ObserverMethod; dataQuality: ObserverQuality; result: T;
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
  eligible: boolean; exclusionReason: string; rankingEligible: false | null; rankingEligibilityReason: string; duplicateCount: number;
  verificationState: string; producerAddress: string | null; producerSoftwareVersion: null;
}
export interface ObserverPillar {
  producerAddress: string; producerSoftwareVersion: null;
  associations: ObserverAssociation[]; associationsNextOffset: number | null;
  associationAnalysisAvailable: boolean; associationSummary: AssociationSummary;
  associationWindowStart: string | null; associationWindowEnd: string | null;
  nameSnapshots: { pillarName: string; observedAt: string; historicalAssignmentVerified: boolean }[];
  momentums: ObserverMomentum[]; nameSnapshotsNextOffset: number | null; momentumsNextOffset: number | null;
}
export interface AssociationCounts {
  eligibleCount: number; receivedCount: number; firstArrivalCount: number; tieCount: number;
}
export interface AssociationMeasurement extends AssociationCounts {
  firstArrivalShare: number; deliveryCoverage: number; tieShare: number;
  medianRelativeDelayMs: number | null; p95RelativeDelayMs: number | null;
  otherProducers: AssociationCounts; baselineMatchedEligibleCount: number;
  baselineFirstArrivalShare: number | null; excessFirstArrivalShare: number | null;
}
export type AssociationEvent = 'hash_announcement' | 'full_broadcast';
export type HoldoutResult = 'insufficient_data' | 'persistent_positive_pattern' | 'no_persistent_specific_advantage' | 'unstable_pattern';
export interface ObserverAssociation extends AssociationMeasurement {
  producerAddress: string; producerSoftwareVersion: null; pillarName: string | null; pillarNameObservedAt: string | null;
  peerId: string; ip: string; advertisedVersion: string | null; versionObservedAt: string;
  cohortId: string; bootId: string; cohortSessionIds: string[]; activeCompetitorCount: number;
  eventKind: AssociationEvent; sampleCount: number; utcDayCount: number; connectedDurationSeconds: number;
  firstObservedAt: string; lastObservedAt: string; rawEvidenceAvailable: boolean;
  associationStatus: 'insufficient_data' | 'observed_relay_association';
  perDay: (AssociationMeasurement & { utcDay: string })[];
  holdout: { splitAt: string; earlier: AssociationMeasurement; later: AssociationMeasurement; result: HoldoutResult };
}
export interface AssociationSummary {
  processedHours: number; pendingHours: number; retryingHours: number; missingHours: number;
  excludedComparisonsByReason: Record<string, number>; excludedHoursByReason: Record<string, number>; reason: string;
}
export interface ObserverAssociations extends ObserverPage<ObserverAssociation>, AssociationSummary {
  available: boolean; computedAt: string | null; producerSoftwareVersion: null;
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fail = (): never => { throw new Error('The Observer response did not match the supported format.'); };
function record(x: unknown) { return object(x) ? x : fail(); }
function string(x: unknown, max = 256): string { return typeof x === 'string' && x.length <= max ? x : fail(); }
function number(x: unknown): number { return typeof x === 'number' && Number.isSafeInteger(x) && x >= 0 ? x : fail(); }
function decimal(x: unknown, min = 0, max = Infinity): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= min && x <= max ? x : fail();
}
function nullableDecimal(x: unknown, min = 0, max = Infinity) { return x === null ? null : decimal(x, min, max); }
function choice<T extends string>(x: unknown, choices: readonly T[]): T { return choices.includes(x as T) ? x as T : fail(); }
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
function envelope<T>(value: unknown, parse: (value: unknown, method: ObserverMethod) => T): ObserverEnvelope<T> {
  const x = record(value), q = record(x.dataQuality);
  if (!((x.schemaVersion === '1.0' && x.methodVersion === 'collection-1') || (x.schemaVersion === '1.1' && x.methodVersion === 'association-2')) || JSON.stringify(q).length > 16384) return fail();
  if ('producerSoftwareVersion' in q) unknownVersion(q.producerSoftwareVersion);
  for (const key of ['ready', 'rankingsAvailable', 'consensusValidated', 'associationSummariesAvailable', 'associationAnalysisImplemented']) if (key in q) boolean(q[key]);
  for (const key of ['captureDropsInOverlappingRuns', 'clockJumpsInOverlappingRuns', 'interruptedRuns', 'analysisProcessedHours', 'analysisPendingHours', 'analysisRetryingHours']) if (key in q) number(q[key]);
  if ('analysisState' in q) string(q.analysisState);
  if (q.statusUpdatedAt != null) timestamp(q.statusUpdatedAt);
  const start = timestamp(x.windowStart), end = timestamp(x.windowEnd);
  if (Date.parse(start) > Date.parse(end)) return fail();
  return { schemaVersion: x.schemaVersion as '1.0' | '1.1', methodVersion: x.methodVersion as ObserverMethod, observerId: string(x.observerId), generatedAt: timestamp(x.generatedAt), windowStart: start, windowEnd: end, dataQuality: q, result: parse(x.result, x.methodVersion as ObserverMethod) };
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
export const parseObserverArrivals = (value: unknown) => envelope(value, (value, method) => page(value, value => {
  const a = record(value);
  if (method === 'collection-1' ? a.rankingEligible !== false : a.rankingEligible !== null || a.rankingEligibilityReason !== 'determined_by_comparison_window') return fail();
  const eventKind = string(a.eventKind);
  if (!['hash_announcement', 'full_broadcast', 'requested_response', 'historical_or_unresolved'].includes(eventKind)) return fail();
  return { bootId: string(a.bootId), sessionId: string(a.sessionId), peerId: peer(a.peerId), hash: hash(a.hash), ip: string(a.ip, 64),
    eventKind, arrivedAt: timestamp(a.arrivedAt), advertisedVersion: nullableString(a.advertisedVersion), versionObservedAt: optionalTimestamp(a.versionObservedAt),
    eligible: boolean(a.eligible), exclusionReason: string(a.exclusionReason ?? ''), rankingEligible: a.rankingEligible as false | null, rankingEligibilityReason: string(a.rankingEligibilityReason ?? 'collection_only'), duplicateCount: number(a.duplicateCount),
    verificationState: string(a.verificationState) || 'unresolved', producerAddress: producer(a.producerAddress), producerSoftwareVersion: unknownVersion(a.producerSoftwareVersion) };
}));
function counts(value: unknown): AssociationCounts {
  const x = record(value), c = { eligibleCount: number(x.eligibleCount), receivedCount: number(x.receivedCount), firstArrivalCount: number(x.firstArrivalCount), tieCount: number(x.tieCount) };
  if (c.receivedCount > c.eligibleCount || c.firstArrivalCount + c.tieCount > c.receivedCount) return fail();
  return c;
}
function measurement(value: unknown): AssociationMeasurement {
  const x = record(value), c = counts(x), matched = number(x.baselineMatchedEligibleCount);
  if (matched > c.eligibleCount) return fail();
  return { ...c, firstArrivalShare: decimal(x.firstArrivalShare, 0, 1), deliveryCoverage: decimal(x.deliveryCoverage, 0, 1), tieShare: decimal(x.tieShare, 0, 1),
    medianRelativeDelayMs: nullableDecimal(x.medianRelativeDelayMs), p95RelativeDelayMs: nullableDecimal(x.p95RelativeDelayMs),
    otherProducers: counts(x.otherProducers), baselineMatchedEligibleCount: matched,
    baselineFirstArrivalShare: nullableDecimal(x.baselineFirstArrivalShare, 0, 1), excessFirstArrivalShare: nullableDecimal(x.excessFirstArrivalShare, -1, 1) };
}
function countMap(value: unknown): Record<string, number> {
  if (value === null) return {};
  const entries = Object.entries(record(value));
  if (entries.length > 100) return fail();
  return Object.fromEntries(entries.map(([k, v]) => [string(k, 128), number(v)]));
}
function summary(value: unknown): AssociationSummary {
  const x = record(value), pending = number(x.pendingHours), retrying = number(x.retryingHours);
  if (retrying > pending) return fail();
  return { processedHours: number(x.processedHours), pendingHours: pending, retryingHours: retrying, missingHours: number(x.missingHours),
    excludedComparisonsByReason: countMap(x.excludedComparisonsByReason), excludedHoursByReason: countMap(x.excludedHoursByReason), reason: string(x.reason ?? '') };
}
const emptySummary = (): AssociationSummary => ({ processedHours: 0, pendingHours: 0, retryingHours: 0, missingHours: 0, excludedComparisonsByReason: {}, excludedHoursByReason: {}, reason: 'association_analysis_not_implemented' });
function parseAssociation(value: unknown): ObserverAssociation {
  const a = record(value), m = measurement(a), h = record(a.holdout);
  const sampleCount = number(a.sampleCount), utcDayCount = number(a.utcDayCount);
  const status = choice(a.associationStatus, ['insufficient_data', 'observed_relay_association'] as const);
  if (sampleCount !== m.eligibleCount || (status === 'observed_relay_association') !== (sampleCount >= 100 && utcDayCount >= 3)) return fail();
  const first = timestamp(a.firstObservedAt), last = timestamp(a.lastObservedAt);
  if (Date.parse(first) > Date.parse(last)) return fail();
  return { ...m, producerAddress: address(a.producerAddress), producerSoftwareVersion: unknownVersion(a.producerSoftwareVersion),
    pillarName: nullableString(a.pillarName), pillarNameObservedAt: optionalTimestamp(a.pillarNameObservedAt), peerId: peer(a.peerId), ip: string(a.ip, 64),
    advertisedVersion: nullableString(a.advertisedVersion), versionObservedAt: timestamp(a.versionObservedAt),
    cohortId: string(a.cohortId), bootId: string(a.bootId), cohortSessionIds: rows(a.cohortSessionIds, x => string(x), 2048), activeCompetitorCount: number(a.activeCompetitorCount),
    eventKind: choice(a.eventKind, ['hash_announcement', 'full_broadcast'] as const), sampleCount, utcDayCount, connectedDurationSeconds: decimal(a.connectedDurationSeconds),
    firstObservedAt: first, lastObservedAt: last, rawEvidenceAvailable: boolean(a.rawEvidenceAvailable), associationStatus: status,
    perDay: rows(a.perDay, x => { const d = record(x); return { ...measurement(d), utcDay: matching(d.utcDay, /^\d{4}-\d\d-\d\d$/) }; }, 90),
    holdout: { splitAt: timestamp(h.splitAt), earlier: measurement(h.earlier), later: measurement(h.later), result: choice(h.result, ['insufficient_data', 'persistent_positive_pattern', 'no_persistent_specific_advantage', 'unstable_pattern'] as const) } };
}
export const parseObserverPillar = (value: unknown): ObserverEnvelope<ObserverPillar> => envelope(value, (value, method) => {
  const p = record(value), current = method === 'association-2';
  const start = current && p.associationWindowStart !== null ? timestamp(p.associationWindowStart) : null;
  const end = current && p.associationWindowEnd !== null ? timestamp(p.associationWindowEnd) : null;
  if ((start === null) !== (end === null) || (start && end && Date.parse(start) >= Date.parse(end))) return fail();
  const associations = current ? rows(p.associations, parseAssociation) : [];
  const producerAddress = address(p.producerAddress), available = current ? boolean(p.associationAnalysisAvailable) : false;
  const associationSummary = current ? summary(p.associationSummary) : emptySummary();
  if (associations.some(a => a.producerAddress !== producerAddress) || (current && start === null && (available || associations.length || associationSummary.reason !== 'no_complete_hours'))) return fail();
  return { producerAddress, producerSoftwareVersion: unknownVersion(p.producerSoftwareVersion), associations,
    associationsNextOffset: current ? offset(p.associationsNextOffset) : null, associationAnalysisAvailable: available, associationSummary,
    associationWindowStart: start, associationWindowEnd: end,
    nameSnapshots: rows(p.nameSnapshots, value => { const n = record(value); return { pillarName: string(n.pillarName), observedAt: timestamp(n.observedAt), historicalAssignmentVerified: boolean(n.historicalAssignmentVerified) }; }),
    momentums: rows(p.momentums, parseMomentum), nameSnapshotsNextOffset: offset(p.nameSnapshotsNextOffset), momentumsNextOffset: offset(p.momentumsNextOffset) };
});
export const parseObserverAnalysis = (value: unknown): ObserverEnvelope<ObserverAssociations> => envelope(value, (value, method) => {
  const a = record(value);
  if (method === 'collection-1') {
    if (a.available !== false || (a.data !== undefined && rows(a.data, () => fail()).length)) return fail();
    if ('producerSoftwareVersion' in a) unknownVersion(a.producerSoftwareVersion);
    return { ...emptySummary(), data: [], nextOffset: null, available: false, computedAt: null, producerSoftwareVersion: null, reason: string(a.reason ?? 'association_analysis_not_implemented') };
  }
  if (a.methodVersion !== 'association-2') return fail();
  return { ...page(a, parseAssociation), ...summary(a), available: boolean(a.available), computedAt: a.computedAt === null ? null : timestamp(a.computedAt), producerSoftwareVersion: unknownVersion(a.producerSoftwareVersion) };
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
