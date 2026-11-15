import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseProduction, parseProductionPage, pillarActivity, productionFresh } from '../src/production.ts';
const fixture = () => JSON.parse(readFileSync(new URL('fixtures/production.json', import.meta.url), 'utf8'));
const now = Date.parse('2026-11-15T17:50:01Z') / 1000;
test('chain counts and intervals parse without inferring software or identities', () => {
  const s = parseProduction(fixture()); assert.equal(s.totalMomentums, 3); assert.equal(s.intervals.averageSeconds, 20); assert.equal(s.pillars[2].count, 0);
  assert.equal('software' in s.pillars[0], false); assert.equal(productionFresh(s, now), true);
});
test('inactivity threshold is one hour and requires complete fresh coverage', () => {
  const s = parseProduction(fixture()); assert.equal(pillarActivity(s.pillars[0], s, now), 'recent'); assert.equal(pillarActivity(s.pillars[2], s, now), 'possible-fork');
  assert.equal(pillarActivity({ ...s.pillars[0], lastTimestamp: s.frontier!.timestamp - 3600 }, s, now), 'quiet');
  const never = s.pillars[2];
  for (const elapsed of [3599, 3600]) {
    const value = { ...s, since: new Date((s.frontier!.timestamp - elapsed) * 1000).toISOString() };
    assert.equal(pillarActivity(never, value, now), elapsed === 3600 ? 'possible-fork' : 'waiting');
  }
  for (const status of ['stale', 'unavailable', 'backfilling'] as const) assert.equal(pillarActivity(never, { ...s, status }, now), 'waiting');
  assert.equal(pillarActivity(never, { ...s, complete: false }, now), 'waiting'); assert.equal(pillarActivity(never, s, now + 100), 'waiting');
  assert.equal(productionFresh(s, now - 300), false);
});
test('a positive production count never becomes a fork warning after a later gap', () => {
  const s = parseProduction(fixture());
  for (const count of [1, 2, 100]) for (const elapsed of [3599, 3600, 3601, 7200]) {
    const p = { ...s.pillars[0], count, lastTimestamp: s.frontier!.timestamp - elapsed };
    assert.equal(pillarActivity(p, s, now), elapsed < 3600 ? 'recent' : 'quiet');
    for (const status of ['stale', 'unavailable', 'backfilling'] as const) assert.equal(pillarActivity(p, { ...s, status }, now), 'waiting');
    assert.equal(pillarActivity(p, { ...s, complete: false }, now), 'waiting');
    assert.equal(pillarActivity(p, s, now + 100), 'waiting');
  }
  assert.equal(pillarActivity({ ...s.pillars[0], lastTimestamp: null }, s, now), 'waiting');
  const previouslyFlagged = s.pillars[2];
  assert.equal(pillarActivity(previouslyFlagged, s, now), 'possible-fork');
  assert.equal(pillarActivity({ ...previouslyFlagged, count: 1, lastTimestamp: s.frontier!.timestamp }, s, now), 'recent');
  assert.equal(pillarActivity({ ...previouslyFlagged, count: 1, lastTimestamp: s.frontier!.timestamp - 3600 }, s, now), 'quiet');
});
test('partial, unavailable and empty history remain explicit', () => {
  const s = fixture(); s.complete = false; s.remaining = 20; s.frontier.height += 20; s.status = 'backfilling'; assert.equal(parseProduction(s).complete, false);
  s.status = 'unavailable'; assert.equal(parseProduction(s).generatedAt, s.generatedAt);
  const empty = { ...s, generatedAt: '', complete: false, remaining: 0, firstHeight: null, last: null, frontier: null, totalMomentums: 0, pillars: [], recent: [], intervals: { samples: 0, averageSeconds: null, shortestSeconds: null, longestSeconds: null, latestSeconds: null } };
  assert.equal(parseProduction(empty).intervals.averageSeconds, null);
});
test('reject unsupported or internally inconsistent production payloads', () => {
  for (const change of [ (s: any) => s.schemaVersion = 2, (s: any) => s.totalMomentums++, (s: any) => s.pillars[0].producer = s.pillars[1].producer, (s: any) => s.pillars[2].lastTimestamp = 1, (s: any) => s.recent[0].intervalSeconds = 0, (s: any) => s.recent[1].previousHash = 'f'.repeat(64), (s: any) => s.remaining++, (s: any) => s.complete = false, (s: any) => s.since = 'bad', (s: any) => s.intervals.averageSeconds = Infinity ]) { const s = fixture(); change(s); assert.throws(() => parseProduction(s)); }
});
test('history paging validates fixed tip, descending continuity and next cursor', () => {
  const s = parseProduction(fixture()), page = { schemaVersion: 1, tipHeight: s.last!.height, tipHash: s.last!.hash, data: s.recent.slice(1), nextBeforeHeight: null };
  assert.equal(parseProductionPage(page, s.last!, 103).data[0].height, 102);
  assert.throws(() => parseProductionPage({ ...page, tipHash: '0'.repeat(64) }, s.last!, 103));
  assert.throws(() => parseProductionPage({ ...page, nextBeforeHeight: 102 }, s.last!, 103));
  assert.throws(() => parseProductionPage(page, s.last!, 102));
});
