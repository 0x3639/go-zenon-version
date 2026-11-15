import test from 'node:test';
import assert from 'node:assert/strict';
import { isDiscoveryOnly, versionSummary, scopePeersByVersion, MIN_PEER_VERSION } from '../src/network-summary.ts';
import type { NodeRecord, Release } from '../src/network.ts';
const node = (version: string | null, evidence: NodeRecord['evidence'] = 'peer'): NodeRecord => ({
  id: 'a'.repeat(128), ip: '8.8.8.8', name: 'custom node', version, evidence,
  firstSeen: '2026-11-14T10:00:00Z', lastSeen: '2026-11-14T10:00:00Z',
  reportedVersions: version ? [version] : [], sources: [], rpcEndpoints: [], commit: null,
});
const release: Release = { version: 'v0.0.9', tag: 'v0.0.9-alphanet', url: 'https://github.com/zenon-network/go-zenon/releases/tag/v0.0.9-alphanet', checkedAt: '2026-11-14T10:00:00Z' };

test('referral growth does not inflate reported peers or dilute known-version adoption', () => {
  const nodes = [...Array.from({ length: 47 }, () => node('v0.0.10', 'p2p')),
    ...Array.from({ length: 12 }, () => node('v0.0.8')), ...Array.from({ length: 4 }, () => node('v0.0.9')),
    node('v0.0.1'), ...Array.from({ length: 102 }, () => node(null, 'discovery'))];
  assert.equal(nodes.length, 166); assert.equal(nodes.filter(n => !isDiscoveryOnly(n)).length, 64);
  assert.deepEqual(versionSummary(nodes, release), { target: 'v0.0.10', kind: 'observed', count: 47, denominator: 64, percent: 73 });
  assert.equal(release.version, 'v0.0.9');
});
test('unknown software reports and failed inbound checks remain reported peers', () => {
  for (const evidence of ['p2p', 'rpc', 'peer'] as const) {
    const n = node(null, evidence);
    n.handshake = { status: 'failed', ip: n.ip, port: 35995, attemptedAt: n.lastSeen };
    assert.equal(isDiscoveryOnly(n), false);
    assert.equal(versionSummary([n], release).percent, null);
  }
});
test('published release, no release, and empty observations have distinct truthful targets', () => {
  assert.deepEqual(versionSummary([node('v0.0.9'), node('v0.0.8'), node(null)], release),
    { target: 'v0.0.9', kind: 'published', count: 1, denominator: 2, percent: 50 });
  assert.equal(versionSummary([node('v0.0.8')], null).kind, 'observed');
  assert.equal(versionSummary([], null).target, undefined);
  assert.equal(versionSummary([], null).percent, null);
  assert.equal(versionSummary([node('v0.0.10-rc.2')], { ...release, version: 'v0.0.10' }).target, 'v0.0.10');
  assert.equal(versionSummary([node('v0.0.10+abc')], { ...release, version: 'v0.0.10' }).count, 1);
});

test('post-spork peer scope hides older software across evidence types and preserves unknowns', () => {
  const inputs = [node('v0.0.8', 'p2p'), node('v0.0.8-libznn', 'rpc'), node('v0.0.1'), node('v0.0.9-rc.1'),
    node('v0.0.9'), node('v0.0.9+build.1'), node('v0.0.10'), node('v0.1.0'), node('v1.0.0'), node(null, 'p2p'), node(null, 'discovery')];
  const scope = scopePeersByVersion(inputs);
  assert.equal(MIN_PEER_VERSION, 'v0.0.9');
  assert.deepEqual(scope.hidden.map(n => n.version), ['v0.0.8', 'v0.0.8-libznn', 'v0.0.1', 'v0.0.9-rc.1']);
  assert.deepEqual(scope.visible.map(n => n.version), ['v0.0.9', 'v0.0.9+build.1', 'v0.0.10', 'v0.1.0', 'v1.0.0', null, null]);
  assert.equal(inputs.length, 11); assert.equal(inputs[0].version, 'v0.0.8');
  assert.equal(versionSummary(scope.visible, { ...release, version: 'v0.0.10' }).denominator, 5);
});
test('the version scope follows the current advertised version and handles no retained peers', () => {
  const upgraded = { ...node('v0.0.10'), reportedVersions: ['v0.0.8', 'v0.0.10'] };
  assert.deepEqual(scopePeersByVersion([upgraded]).visible, [upgraded]);
  assert.deepEqual(scopePeersByVersion([node('v0.0.8')]).visible, []);
  assert.deepEqual(scopePeersByVersion([]), { visible: [], hidden: [] });
});
