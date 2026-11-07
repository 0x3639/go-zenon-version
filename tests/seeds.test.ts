import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySeeds, matchesSeedFilter, SEED_LABELS } from '../src/seeds.ts';
import { GO_ZENON_SEEDS } from '../src/go-zenon-seeds.ts';
import { DEFAULT_SEEDS, toCsv } from '../src/network.ts';
import type { NodeRecord, SourceResult } from '../src/network.ts';

const node = (id: string, ip = '8.8.8.8'): NodeRecord => ({
  id, ip, name: 'v0.0.9 znn-node', version: 'v0.0.9', reportedVersions: ['v0.0.9'], commit: null,
  evidence: 'peer', sources: [DEFAULT_SEEDS[0]], rpcEndpoints: [], firstSeen: '2026-11-07T00:00:00Z', lastSeen: '2026-11-07T00:00:00Z',
});
const source = (id: string, endpoint = DEFAULT_SEEDS[0]): SourceResult => ({
  endpoint, nodeId: id, peerCount: 1, status: 'ok', checkedAt: '2026-11-07T00:00:00Z',
});

test('bootstrap identity survives address changes without labeling a different key on its old IP', () => {
  const seed = GO_ZENON_SEEDS[0];
  const moved = node(seed.id, '9.9.9.9');
  const replacement = node('a'.repeat(128), seed.address.split(':')[0]);
  const roles = classifySeeds([moved, replacement], []);
  assert.deepEqual(roles.get(moved.id), ['bootstrap']);
  assert.deepEqual(roles.get(replacement.id), []);
  assert.equal(GO_ZENON_SEEDS.length, new Set(GO_ZENON_SEEDS.map(s => s.id)).size);
});

test('RPC seed labels apply to the source identity, not every peer it reports', () => {
  const self = node('b'.repeat(128));
  const neighbor = node('c'.repeat(128));
  const roles = classifySeeds([self, neighbor], [source(self.id)]);
  assert.deepEqual(roles.get(self.id), ['rpc']);
  assert.deepEqual(roles.get(neighbor.id), []);
  assert.deepEqual(classifySeeds([self], [source(self.id, 'wss://unconfigured.example.com')]).get(self.id), []);
});

test('configured RPC endpoints preserve a seed label across snapshots and allow both roles', () => {
  const self = node(GO_ZENON_SEEDS[0].id);
  self.rpcEndpoints = ['wss://custom.example.com/'];
  const roles = classifySeeds([self], [], ['wss://custom.example.com']).get(self.id)!;
  assert.deepEqual(roles, ['bootstrap', 'rpc']);
  for (const filter of ['all', 'seeds', 'bootstrap', 'rpc'] as const) assert.equal(matchesSeedFilter(roles, filter), true);
  assert.equal(matchesSeedFilter(roles, 'other'), false);
  assert.equal(matchesSeedFilter([], 'other'), true);
  assert.equal(matchesSeedFilter([], 'seeds'), false);
  assert.equal(matchesSeedFilter(['rpc'], 'bootstrap'), false);
  assert.equal(matchesSeedFilter(['bootstrap'], 'rpc'), false);
  const csv = toCsv([self], new Map([[self.id, roles.map(role => SEED_LABELS[role])]]));
  assert.ok(csv.includes('"seed_roles"'));
  assert.ok(csv.includes('"go-zenon seed | RPC seed"'));
});
