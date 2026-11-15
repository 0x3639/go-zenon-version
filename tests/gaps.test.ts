import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gapFinding, gapFresh, missRate, parseGapStudy } from '../src/gaps.ts';
const fixture = JSON.parse(readFileSync(new URL('./fixtures/gaps.json', import.meta.url), 'utf8'));
test('current study preserves zero-baseline producers that later produced', () => {
  const s = parseGapStudy(fixture);
  assert.equal(s.noBaselineProduction.produced, 60);
  assert.equal(s.pillars[1].baselineCount, 0);
  assert.equal(s.pillars[1].produced, 60);
  assert.equal(missRate(s.noBaselineProduction), 50);
  assert.equal(gapFinding(s), 'higher');
  assert.equal('softwareVersion' in s.pillars[0], false);
});
test('descriptive readout needs enough assignments and can contradict the theory', () => {
  const s = structuredClone(fixture);
  s.rounds = s.rounds.slice(0, 5); assert.equal(gapFinding(s), 'insufficient');
  s.rounds = fixture.rounds; s.noBaselineProduction = { scheduled: 120, produced: 120, missed: 0 };
  assert.equal(gapFinding(s), 'not-higher');
  s.noBaselineProduction.scheduled = 19; assert.equal(gapFinding(s), 'insufficient');
  assert.equal(missRate({ scheduled: 0, produced: 0, missed: 0 }), null);
});
test('null windows are valid only before a test exists', () => {
  const s = structuredClone(fixture); s.status = 'waiting'; s.windowStart = s.windowEnd = null;
  s.rounds = []; s.pillars = [];
  for (const k of ['all', 'comparable', 'noBaselineProduction', 'priorProduction']) s[k] = { scheduled: 0, produced: 0, missed: 0 };
  assert.equal(parseGapStudy(s).windowStart, null);
  s.status = 'ready'; assert.throws(() => parseGapStudy(s));
});
test('rejects unsupported, inconsistent, unclosed and falsely attributed responses', () => {
  for (const mutate of [
    (s: any) => { s.schemaVersion = 2; }, (s: any) => { s.method = 'guess'; },
    (s: any) => { s.all.missed++; }, (s: any) => { s.windowEnd = null; },
    (s: any) => { s.frontier.timestamp = s.windowEnd - 10; },
    (s: any) => { s.rounds[0].matched--; }, (s: any) => { s.rounds[0].reason = 'producer-mismatch'; },
    (s: any) => { s.pillars[1].group = 'prior-production'; },
    (s: any) => { s.pillars[1].producer = s.pillars[0].producer; },
    (s: any) => { s.windowEnd += 300; }, (s: any) => { s.baselineComplete = false; },
  ]) { const s = structuredClone(fixture); mutate(s); assert.throws(() => parseGapStudy(s)); }
});
test('excluded rounds retain measured gaps but have no pillar attribution', () => {
  const s = structuredClone(fixture); s.rounds[0].matched = 19; s.rounds[0].reason = 'producer-mismatch'; s.rounds[0].included = false;
  for (const k of ['comparable', 'noBaselineProduction', 'priorProduction']) for (const c of ['scheduled', 'produced', 'missed']) s[k][c] = s[k][c] / 6 * 5;
  for (const p of s.pillars) for (const c of ['scheduled', 'produced', 'missed']) p[c] = p[c] / 6 * 5;
  const parsed = parseGapStudy(s); assert.equal(parsed.all.missed - parsed.comparable.missed, 10); assert.equal(gapFinding(parsed), 'insufficient');
});
test('freshness requires both current generation and frontier; outages keep original times', () => {
  const s = parseGapStudy(fixture), now = Date.parse(s.generatedAt) / 1000;
  assert.equal(gapFresh(s, now), true); assert.equal(gapFresh(s, now + 91), false); assert.equal(gapFresh(s, now - 21), false);
  for (const status of ['stale', 'unavailable', 'waiting'] as const) { const saved = parseGapStudy({ ...s, status }); assert.equal(saved.generatedAt, s.generatedAt); assert.equal(gapFresh(saved, now), false); }
  assert.equal(gapFresh({ ...s, frontier: { ...s.frontier!, timestamp: now - 100 } }, now), false);
});
test('captured live response matches its measured group and replay totals', () => {
  const s = parseGapStudy(JSON.parse(readFileSync(new URL('./fixtures/gaps-live.json', import.meta.url), 'utf8')));
  assert.equal(s.generatedAt, '2026-11-15T17:49:06Z');
  assert.deepEqual(s.all, { scheduled: 330, produced: 195, missed: 135 });
  assert.equal(s.noBaselineProduction.missed, 132); assert.equal(s.noBaselineProduction.produced, 1);
  assert.equal(s.rounds.reduce((n, r) => n + r.matched, 0), 195);
  assert.equal(s.rounds.every(r => r.included), true);
});
