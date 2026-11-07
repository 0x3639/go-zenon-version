import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, isPublicIp, mergeSnapshots, parseNetworkInfo, parseSnapshot, parseVersion, scanNetwork, toCsv, validateSeed } from '../src/network.ts';
import type { Rpc } from '../src/network.ts';

const peer = (id: string, ip = '8.8.8.8', name = 'v0.0.9 znn-node') => ({ publicKey: id.repeat(128), ip, name });
const seed = 'wss://seed.example.com:35998';

test('reads advertised and direct versions without inventing unknown versions', () => {
  assert.equal(parseVersion('v0.0.9 znn-node'), 'v0.0.9');
  assert.equal(parseVersion('znnd/v0.0.10-rc.2/linux'), 'v0.0.10-rc.2');
  assert.equal(parseVersion('0.0.9'), 'v0.0.9');
  assert.equal(parseVersion('custom-node'), null);
  assert.equal(parseVersion('*self*'), null);
});
test('sorts numeric versions and prereleases correctly', () => {
  assert.ok(compareVersions('v0.0.10', 'v0.0.9') > 0);
  assert.ok(compareVersions('v0.0.9', 'v0.0.9-rc.2') > 0);
  assert.ok(compareVersions('v0.0.9-rc.10', 'v0.0.9-rc.2') > 0);
  assert.equal(compareVersions('v0.0.9+abc', 'v0.0.9+def'), 0);
});
test('automatic probes reject non-public addresses and URL-shaped input', () => {
  for (const ip of ['127.0.0.1', '10.2.3.4', '172.31.0.5', '169.254.169.254', '192.168.1.1', '100.64.0.1', '224.0.0.1', '255.255.255.255', '192.0.2.4', '198.51.100.2', '203.0.113.3', '0177.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '2001:db8::1', '8.8.8.8@localhost', 'example.com']) assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('2001:4860:4860::8888'), true);
});
test('seeds require secure public URLs without credentials', () => {
  assert.equal(validateSeed(seed + '/'), seed);
  for (const url of ['http://example.com', 'ws://example.com', 'wss://localhost:35998', 'https://10.0.0.1', 'https://user:pass@example.com']) assert.throws(() => validateSeed(url));
});
test('network parser preserves names and ignores malformed identities', () => {
  const result = parseNetworkInfo({ peers: [peer('a'), { publicKey: 'bad', name: 'v0.0.9' }], self: peer('b') });
  assert.equal(result.peers.length, 1); assert.equal(result.peers[0].name, 'v0.0.9 znn-node');
  assert.throws(() => parseNetworkInfo({ peers: null }));
});
test('recursive scan deduplicates by identity and records versions even when private RPC fails', async () => {
  const visited: string[] = [];
  const rpc: Rpc = async (endpoint, method) => {
    visited.push(endpoint);
    if (endpoint === seed) return method === 'stats.processInfo' ? { version: 'v0.0.9', commit: 'abc' } : { peers: [peer('a'), peer('a'), peer('c', '10.0.0.1')], self: peer('b') };
    if (endpoint === 'http://8.8.8.8:35997') return method === 'stats.processInfo' ? { version: 'v0.0.10' } : { peers: [peer('b', '9.9.9.9')], self: peer('a') };
    throw new Error('private RPC');
  };
  const result = await scanNetwork({ seeds: [seed], rpc, recursive: true, mode: 'collector' });
  assert.equal(result.nodes.length, 3);
  assert.equal(result.nodes.find(n => n.id === 'a'.repeat(128))?.version, 'v0.0.10');
  assert.equal(result.nodes.find(n => n.id === 'b'.repeat(128))?.evidence, 'rpc');
  assert.equal(visited.some(v => v.includes('10.0.0.1')), false);
  assert.equal(result.sources.filter(s => s.status === 'ok').length, 2);
});
test('processInfo failure does not discard a usable peer list', async () => {
  const rpc: Rpc = async (_, method) => { if (method === 'stats.processInfo') throw new Error('disabled'); return { peers: [peer('a')], self: peer('b') }; };
  const result = await scanNetwork({ seeds: [seed], rpc, mode: 'browser' });
  assert.equal(result.sources[0].status, 'ok'); assert.equal(result.nodes.length, 2);
  assert.equal(result.nodes.find(n => n.id === 'a'.repeat(128))?.version, 'v0.0.9');
});
test('endpoint budget and cancellation bound recursive work', async () => {
  const rpc: Rpc = async () => ({ peers: [peer('a'), peer('b', '9.9.9.9')], self: null });
  const result = await scanNetwork({ seeds: [seed], rpc, mode: 'browser', recursive: true, maxEndpoints: 1 });
  assert.equal(result.sources.length, 1); assert.equal(result.limited, true);
  const control = new AbortController(); control.abort();
  const cancelled = await scanNetwork({ seeds: [seed], rpc, mode: 'browser', signal: control.signal });
  assert.equal(cancelled.sources.length, 0); assert.equal(cancelled.limited, true);
});
test('unknown version observations never become manufactured version values', async () => {
  const result = await scanNetwork({ seeds: [seed], mode: 'browser', rpc: async () => ({ peers: [peer('a', '8.8.8.8', 'custom node')], self: null }) });
  assert.equal(result.nodes[0].version, null);
  assert.equal(parseSnapshot(result).nodes[0].version, null);
});
test('merging retains old timestamps for peers absent from a fresh result', async () => {
  const old = await scanNetwork({ seeds: [seed], mode: 'browser', rpc: async () => ({ peers: [peer('a')], self: null }) });
  old.nodes[0].lastSeen = '2020-01-01T00:00:00Z';
  const fresh = { ...old, nodes: [] };
  assert.equal(mergeSnapshots(old, fresh).nodes[0].lastSeen, '2020-01-01T00:00:00Z');
});
test('CSV export quotes data and neutralizes spreadsheet formulas', async () => {
  const result = await scanNetwork({ seeds: [seed], mode: 'browser', rpc: async () => ({ peers: [peer('a', '8.8.8.8', '=HYPERLINK("bad")')], self: null }) });
  const csv = toCsv(result.nodes);
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
  assert.ok(csv.includes('last_seen_utc'));
});
