import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSchedule, scheduleIsFresh, shownVersion, slotOutcome } from '../src/momentums.ts';
import type { MomentumSchedule, MomentumSlot } from '../src/momentums.ts';

const start = 1637755200 + 500000 * 300;
const producer = 'z1qr9dd6qmzwr8sazns24lna8zz5e8208nqq2hcx';
const other = 'z1qrjdhy65zds69a96xlhheu4sy689k34x4hpse0';
function fixture(): MomentumSchedule {
  const slot: MomentumSlot = { round: 500000, index: 2, startsAt: start + 10, pillar: 'Test pillar', producer, software: { version: null, reason: 'no-pillar-peer-link' } };
  return { schemaVersion: 1, generatedAt: new Date(start * 1000).toISOString(), status: 'ready', source: 'wss://example.com', basis: 'rpc-current-weights', genesis: 1637755200, slotSeconds: 10, checked: 120, matched: 120,
    frontier: { height: 14000000, timestamp: start, hash: '1'.repeat(64), previousHash: '0'.repeat(64), producer, chainIdentifier: 1 }, rounds: [], slots: [slot] };
}
test('schedule parsing preserves unknown versions and rejects ungrounded attribution', () => {
  const s = fixture();
  assert.equal(parseSchedule(s).slots[0].software.version, null);
  s.slots[0].software.version = 'v0.0.9';
  assert.throws(() => parseSchedule(s), /attribution/);
  s.slots[0].software = { version: 'v0.0.9', reason: 'configured-peer-link', peerId: 'a'.repeat(128), evidence: 'p2p', observedAt: s.generatedAt };
  assert.equal(parseSchedule(s).slots[0].software.version, 'v0.0.9');
  assert.equal(shownVersion(s.slots[0].software, start + 3601), null);
});
test('stale, failed, elapsed, and clock-skewed schedules cannot drive a live countdown', () => {
  const s = fixture();
  assert(scheduleIsFresh(s, start + 1));
  assert(!scheduleIsFresh(s, start + 50));
  assert(!scheduleIsFresh(s, start - 30));
  assert(!scheduleIsFresh(s, start + 11));
  s.status = 'unavailable';
  assert(!scheduleIsFresh(s, start + 1));
});
test('wall time cannot turn an unobserved slot into a missed momentum', () => {
  const s = fixture(), slot = s.slots[0];
  assert.equal(slotOutcome(slot, s, start + 30), 'awaiting');
  s.frontier!.timestamp = start + 20;
  assert.equal(slotOutcome(slot, s, start + 30), 'missed');
  slot.observed = { ...s.frontier!, timestamp: slot.startsAt, producer };
  assert.equal(slotOutcome(slot, s, start + 30), 'produced');
  slot.observed.producer = other;
  assert.equal(slotOutcome(slot, s, start + 30), 'different');
});
test('misaligned slots, duplicate times, and inconsistent replay counts are rejected', () => {
  const s = fixture();
  s.slots[0].startsAt += 1;
  assert.throws(() => parseSchedule(s), /slot/);
  const duplicate = fixture(); duplicate.slots.push({ ...duplicate.slots[0] });
  assert.throws(() => parseSchedule(duplicate), /slot/);
  const counts = fixture(); counts.matched = counts.checked + 1;
  assert.throws(() => parseSchedule(counts), /schedule/);
});
