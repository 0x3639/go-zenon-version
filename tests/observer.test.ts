import test from 'node:test';
import assert from 'node:assert/strict';
import { observerConfiguration, DEFAULT_OBSERVER_API } from '../src/observer-config.ts';
import { fetchObserver, observerIsStale, ObserverRequestError, parseObserverAnalysis, parseObserverArrivals, parseObserverMomentums, parseObserverPeers, parseObserverPillar, parseObserverStatus, referenceIsFresh } from '../src/observer.ts';

const at = '2026-11-07T17:19:09.570987589Z';
const address = 'z1qpza2k4fldpwsjrw0ae27ywnfnsc352sfed2e0';
const hash = 'a'.repeat(64), peer = 'b'.repeat(128);
function envelope(result: unknown) {
  return { schemaVersion: '1.0', observerId: 'test-observer', generatedAt: at, windowStart: '2026-11-06T17:19:00Z', windowEnd: '2026-11-07T17:19:00Z', methodVersion: 'collection-1',
    dataQuality: { ready: true, captureDropsInOverlappingRuns: 0, statusUpdatedAt: at, producerSoftwareVersion: null, rankingsAvailable: false }, result };
}
function momentum() { return { hash, height: 14608739, timestamp: 1794071930, producerAddress: address, signerConflict: false, verificationState: 'rpc_observed', firstObservedAt: at, producerSoftwareVersion: null }; }
function arrival() { return { hash, bootId: 'boot', sessionId: 'session', peerId: peer, ip: '192.0.2.1', eventKind: 'full_broadcast', arrivedAt: '2026-11-07T17:18:50.081314988Z', advertisedVersion: '0.0.9', versionObservedAt: at, eligible: true, exclusionReason: '', rankingEligible: false, duplicateCount: 0, verificationState: 'rpc_agreed', producerAddress: address, producerSoftwareVersion: null }; }

test('Observer requires an exact build opt-in and validates its independent API origin', () => {
  for (const flag of [undefined, '', 'false', '1', true, 'TRUE']) assert.equal(observerConfiguration(flag).enabled, false);
  assert.equal(observerConfiguration('true').api, DEFAULT_OBSERVER_API);
  assert.equal(observerConfiguration('true', 'https://observer.example/').api, 'https://observer.example');
  for (const url of ['http://observer.example', 'https://user:secret@observer.example', 'https://observer.example/api', 'https://observer.example/?key=secret', 'https://observer.example/#on']) assert(observerConfiguration('true', url).error);
  assert(observerConfiguration('true', 'http://localhost:3000').error);
  assert.equal(observerConfiguration('true', 'http://localhost:3000', true).api, 'http://localhost:3000');
});
test('Observer reads result.data, preserves empty pages and timestamps, and rejects unsupported envelopes', () => {
  const raw = envelope({ data: [momentum()], nextOffset: 25 });
  const parsed = parseObserverMomentums(raw);
  assert.equal(parsed.generatedAt, at);
  assert.equal(parsed.result.data[0].producerSoftwareVersion, null);
  assert.equal(parsed.result.nextOffset, 25);
  assert.deepEqual(parseObserverMomentums(envelope({ data: [], nextOffset: null })).result.data, []);
  assert.throws(() => parseObserverMomentums({ ...raw, result: [momentum()] }));
  assert.throws(() => parseObserverMomentums({ ...raw, schemaVersion: '2.0' }));
  assert.throws(() => parseObserverMomentums(envelope({ data: Array(501).fill(momentum()), nextOffset: null })));
  assert.throws(() => parseObserverMomentums(envelope({ data: [{ ...momentum(), timestamp: Number.MAX_SAFE_INTEGER }], nextOffset: null })));
});
test('relay versions never become producer versions, even after a momentum is produced', () => {
  const a = parseObserverArrivals(envelope({ data: [arrival()], nextOffset: null })).result.data[0];
  assert.equal(a.advertisedVersion, '0.0.9'); assert.equal(a.producerSoftwareVersion, null);
  assert.equal(a.arrivedAt, '2026-11-07T17:18:50.081314988Z');
  assert.equal(parseObserverArrivals(envelope({ data: [{ ...arrival(), verificationState: 'unresolved', producerAddress: null }], nextOffset: null })).result.data[0].producerAddress, null);
  assert.throws(() => parseObserverArrivals(envelope({ data: [{ ...arrival(), producerSoftwareVersion: '0.0.9' }], nextOffset: null })));
  assert.throws(() => parseObserverMomentums(envelope({ data: [{ ...momentum(), producerSoftwareVersion: '0.0.9' }], nextOffset: null })));
  const pending = parseObserverAnalysis(envelope({ available: false, data: [], reason: 'association_analysis_not_implemented' }));
  assert.equal(pending.result.available, false);
});
test('conflicting signers remain unknown; dated pillar names do not become identity assertions', () => {
  const m = parseObserverMomentums(envelope({ data: [{ ...momentum(), producerAddress: null, signerConflict: true }], nextOffset: null }));
  assert.equal(m.result.data[0].producerAddress, null);
  assert.throws(() => parseObserverMomentums(envelope({ data: [{ ...momentum(), signerConflict: true }], nextOffset: null })));
  const p = parseObserverPillar(envelope({ producerAddress: address, producerSoftwareVersion: null, nameSnapshots: [{ pillarName: 'Example', observedAt: at, historicalAssignmentVerified: false }], momentums: [momentum()], momentumsNextOffset: null, nameSnapshotsNextOffset: null }));
  assert.equal(p.result.nameSnapshots[0].historicalAssignmentVerified, false);
});
test('fresh response generation cannot mask stale operational or reference observations', () => {
  const now = Date.parse(at);
  const s = parseObserverStatus(envelope({ captureState: 'observing', connectedPeers: 4, configuredPeers: 4, captureDrops: 0, referenceObservedAt: '2026-11-07T17:10:00Z' }));
  assert.equal(observerIsStale(s, now), false);
  assert.equal(referenceIsFresh(s.result.referenceObservedAt, now), false);
  assert.equal(referenceIsFresh(null, now), false);
  assert.equal(observerIsStale(s, now + 91000), true);
  assert.equal(observerIsStale(s, now - 31000), true);
  s.dataQuality.statusUpdatedAt = '2026-11-07T17:10:00Z';
  assert.equal(observerIsStale(s, now), true);
});
test('peer reconnects preserve session, version, and uncertain disconnect history', () => {
  const base = { bootId: 'boot', peerId: peer, ip: '192.0.2.1', advertisedVersion: null, connectedAt: at, disconnectedAt: null };
  const p = parseObserverPeers(envelope({ data: [{ ...base, sessionId: 'a', disconnectedAt: at, uncleanShutdown: true }, { ...base, sessionId: 'b', ip: '192.0.2.2', advertisedVersion: '0.0.9' }], nextOffset: null }));
  assert.equal(p.result.data.length, 2); assert.equal(p.result.data[0].uncleanShutdown, true);
  assert.equal(p.result.data[0].advertisedVersion, null); assert.notEqual(p.result.data[0].ip, p.result.data[1].ip);
});
test('Observer requests omit credentials, honor cancellation and preserve HTTP backoff', async () => {
  const control = new AbortController(); let options: RequestInit | undefined;
  const result = await fetchObserver('https://observer.example/api/v1/momentums', parseObserverMomentums, control.signal, async (_url, init) => { options = init; return new Response(JSON.stringify(envelope({ data: [momentum()], nextOffset: null }))); });
  assert.equal(options?.credentials, 'omit'); assert(options?.signal); assert.equal(result.result.data.length, 1);
  await assert.rejects(fetchObserver('https://observer.example', parseObserverMomentums, control.signal, async () => new Response('', { status: 429, headers: { 'Retry-After': '60' } })), e => e instanceof ObserverRequestError && e.retryAfterMs === 60000);
  control.abort();
  await assert.rejects(fetchObserver('https://observer.example', parseObserverMomentums, control.signal, async (_url, init) => { init?.signal?.throwIfAborted(); return new Response('{}'); }), { name: 'AbortError' });
});
test('oversized, malformed, and failed responses never turn into empty successful observations', async () => {
  const signal = new AbortController().signal;
  for (const response of [new Response('x'.repeat(1048577)), new Response('{bad'), new Response('', { status: 503 }), new Response(JSON.stringify({ result: { data: [] } }))]) {
    await assert.rejects(fetchObserver('https://observer.example', parseObserverMomentums, signal, async () => response));
  }
});
