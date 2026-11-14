import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseObserverAnalysis, parseObserverArrivals, parseObserverMomentums, parseObserverPeers, parseObserverPillar, parseObserverStatus, observerIsStale, fetchObserver } from '../src/observer.ts';
import { associationProgress, newerAssociationHours, associationKey, associationURL, associationWindow, parseAssociationPage } from '../src/association-query.ts';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/observer-1.1.json', import.meta.url), 'utf8'));
const copy = (key = 'associations') => structuredClone(fixture[key]);
const query = { from: fixture.associations.windowStart, to: fixture.associations.windowEnd, producer: '', eventKind: '' as const, limit: 10 };

test('recorded 0.3.1 responses parse with schema 1.1 / association-2 across every Observer feed', () => {
  for (const [key, parse] of Object.entries({ associations: parseObserverAnalysis, arrivals: parseObserverArrivals, momentums: parseObserverMomentums, peers: parseObserverPeers, pillar: parseObserverPillar, status: parseObserverStatus })) {
    const value = parse(fixture[key]); assert.equal(value.schemaVersion, '1.1'); assert.equal(value.methodVersion, 'association-2');
  }
  const r = parseObserverAnalysis(copy()).result;
  assert.equal(r.available, true); assert.equal(r.processedHours, 113); assert.equal(r.missingHours, 55);
  assert.equal(r.data[0].associationStatus, 'insufficient_data');
  assert.equal(parseObserverStatus(fixture.status).dataQuality.associationSummariesAvailable, true);
  const a = parseObserverArrivals(fixture.arrivals).result.data[0];
  assert.equal(a.rankingEligible, null); assert.equal(a.rankingEligibilityReason, 'determined_by_comparison_window');
});
test('zero deliveries and negative associations retain their denominators, nullable delays, and relay-only version', () => {
  const row = parseObserverAnalysis(copy()).result.data[0];
  assert.equal(row.sampleCount, 1); assert.equal(row.eligibleCount, 1); assert.equal(row.receivedCount, 0);
  assert.equal(row.deliveryCoverage, 0); assert.equal(row.medianRelativeDelayMs, null);
  assert(row.excessFirstArrivalShare! < 0); assert.equal(row.advertisedVersion, '0.0.8');
  assert.equal(row.producerSoftwareVersion, null); assert.equal(row.holdout.result, 'insufficient_data');
  assert.equal(row.holdout.earlier.baselineFirstArrivalShare, null);
  assert.notEqual(associationKey(row), associationKey(parseObserverAnalysis(copy()).result.data[1]));
});
test('threshold labels can describe negative findings and never supply a producer version', () => {
  const raw = copy(), row = raw.result.data[0];
  row.sampleCount = row.eligibleCount = 100; row.utcDayCount = 3; row.associationStatus = 'observed_relay_association';
  row.holdout.result = 'no_persistent_specific_advantage';
  assert.equal(parseObserverAnalysis(raw).result.data[0].producerSoftwareVersion, null);
  row.producerSoftwareVersion = '0.0.8'; assert.throws(() => parseObserverAnalysis(raw));
  row.producerSoftwareVersion = null; row.sampleCount = 99; assert.throws(() => parseObserverAnalysis(raw));
});
test('null pillar windows and null exclusion maps mean no complete hours, not epoch dates or an offline pillar', () => {
  const p = parseObserverPillar(copy('pillar-null')).result;
  assert.equal(p.associationWindowStart, null); assert.equal(p.associationWindowEnd, null);
  assert.equal(p.associationSummary.reason, 'no_complete_hours'); assert.equal(p.associationAnalysisAvailable, false);
  assert.deepEqual(p.associations, []); assert.deepEqual(p.associationSummary.excludedHoursByReason, {});
  assert(p.momentums.length > 0);
  const wrong = copy('pillar-null'); wrong.result.associationWindowEnd = wrong.windowEnd;
  assert.throws(() => parseObserverPillar(wrong));
  const mismatched = copy('pillar'); mismatched.result.associations[0].producerAddress = fixture.momentums.result.data[0].producerAddress;
  assert.throws(() => parseObserverPillar(mismatched));
});
test('pending/retrying summaries and distinct whole-hour exclusions remain visible even when unavailable', () => {
  const raw = copy(); Object.assign(raw.result, { available: false, data: [], nextOffset: null, pendingHours: 8, retryingHours: 3,
    computedAt: null, excludedHoursByReason: { raw_history_expired: 2 }, reason: 'chain_continuity_unresolved' });
  const s = parseObserverAnalysis(raw).result;
  assert.equal(s.pendingHours, 8); assert.equal(s.retryingHours, 3); assert.equal(s.computedAt, null);
  assert.equal(s.excludedHoursByReason.raw_history_expired, 2); assert.equal(s.excludedComparisonsByReason.unsafe_or_unknown_run, 63680);
  raw.result.retryingHours = 9; assert.throws(() => parseObserverAnalysis(raw));
});
test('unsupported schema/method pairs, fabricated attribution, and malformed current rows are rejected', () => {
  for (const [schemaVersion, methodVersion] of [['1.0', 'association-2'], ['1.1', 'collection-1'], ['1.1', 'association-1'], ['2.0', 'association-2']]) {
    assert.throws(() => parseObserverAnalysis({ ...copy(), schemaVersion, methodVersion }));
  }
  for (const field of ['producerSoftwareVersion', 'firstArrivalShare', 'eventKind', 'holdout']) {
    const raw = copy(); raw.result.data[0][field] = field === 'firstArrivalShare' ? 1.1 : 'unsupported'; assert.throws(() => parseObserverAnalysis(raw));
  }
  const a = copy('arrivals'); a.result.data[0].rankingEligible = true; assert.throws(() => parseObserverArrivals(a));
  const missing = copy(); delete missing.result.pendingHours; assert.throws(() => parseObserverAnalysis(missing));
});
test('producer and category filtering, fixed UTC dates, and offset validation bound pagination', () => {
  const w = associationWindow(7, Date.parse('2026-11-12T10:01:59Z'));
  assert.equal(w.to, '2026-11-12T09:00:00.000Z');
  const producer = fixture.associations.result.data[0].producerAddress;
  const filtered = { ...query, producer, eventKind: 'full_broadcast' as const };
  const first = new URL(associationURL('https://observer.example', filtered));
  const next = new URL(associationURL('https://observer.example', filtered, 10));
  for (const key of ['producer', 'eventKind', 'from', 'to', 'limit']) assert.equal(first.searchParams.get(key), next.searchParams.get(key));
  assert.equal(next.searchParams.get('producer'), producer); assert.equal(next.searchParams.get('offset'), '10');
  for (const bad of [{ ...query, producer: 'AlienApeZ' }, { ...query, limit: 500 }, { ...query, from: '2026-11-05T10:01:00Z' }]) assert.throws(() => associationURL('https://observer.example', bad));
  assert.throws(() => associationURL('https://observer.example', query, 100001));
  assert.throws(() => parseAssociationPage(copy(), { ...query, producer: fixture.momentums.result.data[0].producerAddress }, 0));
  assert.throws(() => parseAssociationPage(copy(), filtered, 0));
  assert.throws(() => parseAssociationPage(copy(), { ...query, ...w }, 0));
  assert.throws(() => parseAssociationPage(copy(), query, 2));
});
test('paging deduplicates durable row identity without pooling different cohorts, peers, or event categories', () => {
  const raw = copy(), first = raw.result.data[0];
  raw.result.data.push(structuredClone(first), { ...first, cohortId: 'new-cohort' }, { ...first, peerId: 'f'.repeat(128) });
  const parsed = parseAssociationPage(raw, query, 0);
  assert.equal(parsed.result.data.length, 4); assert.equal(parsed.result.nextOffset, 2);
  assert.equal(parseAssociationPage({ ...raw, result: { ...raw.result, data: [], nextOffset: null } }, query, 0).result.nextOffset, null);
});
test('fresh transport does not refresh historical computation, stale snapshots, or failed queries', async () => {
  const raw = copy(), parsed = parseObserverAnalysis(raw), now = Date.parse(parsed.generatedAt);
  assert.equal(observerIsStale(parsed, now), false); assert.equal(observerIsStale(parsed, now + 91000), true);
  assert.equal(parsed.result.computedAt, raw.result.computedAt);
  const signal = new AbortController().signal;
  await assert.rejects(fetchObserver('https://observer.example', parseObserverAnalysis, signal, async () => new Response('{}', { status: 503 })));
  assert.equal(parsed.generatedAt, raw.generatedAt); assert.equal(parsed.result.data.length, 2);
});

test('association progress explains missing samples/days and an empty holdout half without pooling rows', () => {
  const row = parseObserverAnalysis(copy()).result.data[0];
  assert.deepEqual(associationProgress(row), { samplesNeeded: 99, daysNeeded: 2, emptyHalf: 'earlier' });
  const enough = { ...row, sampleCount: 120, utcDayCount: 4 };
  assert.equal(associationProgress(enough).samplesNeeded, 0); assert.equal(associationProgress(enough).daysNeeded, 0);
  assert.equal(associationProgress({ ...row, holdout: { ...row.holdout, earlier: row.holdout.later, later: row.holdout.earlier } }).emptyHalf, 'later');
});
test('new complete hours are advertised after the grace period without changing the selected window', () => {
  const end = '2026-11-14T10:00:00Z';
  assert.equal(newerAssociationHours(end, Date.parse('2026-11-14T11:01:59Z')), 0);
  assert.equal(newerAssociationHours(end, Date.parse('2026-11-14T11:02:00Z')), 1);
  assert.equal(newerAssociationHours(end, Date.parse('2026-11-14T13:02:00Z')), 3);
  assert.equal(newerAssociationHours(end, Date.parse('2026-11-14T09:00:00Z')), 0);
  assert.equal(end, '2026-11-14T10:00:00Z');
});
