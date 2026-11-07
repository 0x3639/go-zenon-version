import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionStatus, groupByIP, toIPCsv } from '../src/reachability.ts';
import { parseSnapshot } from '../src/network.ts';
import type { NodeRecord } from '../src/network.ts';

const node = (id: string, ip = '8.8.8.8'): NodeRecord => ({
  id: id.repeat(128), ip, tcpPort: 35995, name: '', version: null, reportedVersions: [], commit: null,
  evidence: 'peer', sources: [], rpcEndpoints: [], firstSeen: '2026-11-07T00:00:00Z', lastSeen: '2026-11-07T00:00:00Z',
});

test('a referral cannot confirm reachability, and a handshake only confirms its own endpoint', () => {
  const n = node('a');
  assert.equal(connectionStatus(n), 'unverified');
  n.handshake = { status: 'confirmed', ip: n.ip, port: 35995, attemptedAt: n.lastSeen, lastSuccessAt: n.lastSeen };
  assert.equal(connectionStatus(n), 'confirmed');
  assert.equal(connectionStatus({ ...n, ip: '9.9.9.9' }), 'unverified');
  assert.equal(connectionStatus({ ...n, tcpPort: 35996 }), 'unverified');
  n.handshake.status = 'failed';
  assert.equal(connectionStatus(n), 'failed');
  assert.equal(n.handshake.lastSuccessAt, n.lastSeen);
});

test('unique-IP export retains shared-IP identities while deduplicating repeated records', () => {
  const a = node('a'), b = node('b');
  a.evidence = 'p2p';
  const groups = groupByIP([a, a, b, node('c', '127.0.0.1')]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].nodeIds, [a.id, b.id]);
  assert.equal(groups[0].confirmed, 1);
  assert.equal(toIPCsv([a, b]).split('\r\n').length, 2);
  assert.equal(groupByIP([node('d', '2001:4860:0:0::8888'), node('e', '2001:4860::8888')]).length, 1);
});

test('snapshot validation rejects malformed direct-attempt data', () => {
  const n = node('a');
  const snapshot = { schemaVersion: 1, mode: 'discovery', generatedAt: n.lastSeen, nodes: [n], sources: [], release: null };
  n.handshake = { status: 'confirmed', ip: n.ip, port: 35995, attemptedAt: n.lastSeen };
  assert.doesNotThrow(() => parseSnapshot(snapshot));
  n.handshake.attemptedAt = 'invalid date';
  assert.throws(() => parseSnapshot(snapshot), /handshake/);
});
