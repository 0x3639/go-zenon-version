export const DEFAULT_SEEDS = [
  'wss://my.hc1node.com:35998',
  'wss://node.zenonhub.io:35998',
  'wss://node.atsocy.com:35998',
];

export interface Peer { publicKey: string; ip: string; name: string }
export interface NetworkInfo { peers: Peer[]; self: Peer | null; numPeers: number }
export interface NodeRecord {
  id: string;
  ip: string;
  name: string;
  version: string | null;
  reportedVersions: string[];
  commit: string | null;
  evidence: 'rpc' | 'peer' | 'p2p' | 'discovery';
  sources: string[];
  rpcEndpoints: string[];
  firstSeen: string;
  lastSeen: string;
  tcpPort?: number;
  udpPort?: number;
  handshake?: {
    status: 'confirmed' | 'failed';
    ip: string;
    port: number;
    attemptedAt: string;
    lastSuccessAt?: string;
    error?: string;
  };
  lastDiscoveryAt?: string;
}
export interface SourceResult {
  endpoint: string;
  status: 'ok' | 'error';
  peerCount: number;
  nodeId: string | null;
  error?: string;
  checkedAt: string;
}
export interface Release { version: string; tag: string; url: string; checkedAt: string }
export interface Snapshot {
  schemaVersion: 1;
  startedAt: string;
  generatedAt: string;
  mode: 'browser' | 'collector' | 'discovery';
  nodes: NodeRecord[];
  sources: SourceResult[];
  limited: boolean;
  release: Release | null;
  scanning?: boolean;
  pillarCount?: number | null;
  pillarCountCheckedAt?: string;
  crawl?: {
    candidates: number;
    pending: number;
    attempted: number;
    confirmed: number;
    uniqueIPs: number;
    confirmedIPs: number;
    completedPasses: number;
    capped: boolean;
  };
}
export type Rpc = (endpoint: string, method: string, signal: AbortSignal) => Promise<unknown>;
const MAX_BYTES = 2_000_000;
const KEY = /^[0-9a-f]{128}$/i;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const shortText = (v: unknown, max = 512) => typeof v === 'string' ? v.slice(0, max) : '';

export function parseVersion(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const found = value.match(/(?:^|[\s/])v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?=$|[\s/])/);
  return found ? `v${found[1]}` : null;
}

export function compareVersions(a: string, b: string): number {
  const split = (s: string) => s.replace(/^v/, '').split('+')[0].split(/-(.*)/s);
  const [ac, ap] = split(a), [bc, bp] = split(b);
  const av = ac.split('.').map(Number), bv = bc.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (av[i] !== bv[i]) return av[i] - bv[i];
  if (!ap && bp) return 1;
  if (ap && !bp) return -1;
  const ai = ap?.split('.') ?? [], bi = bp?.split('.') ?? [];
  for (let i = 0; i < Math.max(ai.length, bi.length); i++) {
    if (ai[i] === undefined) return -1;
    if (bi[i] === undefined) return 1;
    if (ai[i] === bi[i]) continue;
    const an = /^\d+$/.test(ai[i]), bn = /^\d+$/.test(bi[i]);
    if (an && bn) return Number(ai[i]) - Number(bi[i]);
    if (an !== bn) return an ? -1 : 1;
    return ai[i].localeCompare(bi[i]);
  }
  return 0;
}

/** Only literal, globally routable addresses are eligible for automatic probing. */
export function isPublicIp(ip: string): boolean {
  if (ip.includes(':')) {
    try {
      const normalized = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
      return /^[23][0-9a-f]{3}:/.test(normalized) && !normalized.startsWith('2001:db8:');
    } catch { return false; }
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const [a, b, c, d] = ip.split('.').map(Number);
  if ([a, b, c, d].some((n, i) => n > 255 || String(n) !== ip.split('.')[i])) return false;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113));
}

export function validateSeed(input: string): string {
  const url = new URL(input.trim());
  if (!['https:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new Error('Use an HTTPS or WSS URL without credentials or a fragment.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') ||
    ((!host.includes('.') || /^[\d.]+$/.test(host) || host.includes(':')) && !isPublicIp(host)))
    throw new Error('Use a public node address.');
  return url.href.replace(/\/$/, '');
}

export function parseNetworkInfo(value: unknown): NetworkInfo {
  if (!object(value) || !Array.isArray(value.peers) || value.peers.length > 5000)
    throw new Error('The node returned an invalid peer list.');
  const parsePeer = (v: unknown): Peer | null => object(v) && typeof v.publicKey === 'string' && KEY.test(v.publicKey)
    ? { publicKey: v.publicKey.toLowerCase(), ip: shortText(v.ip, 80), name: shortText(v.name) } : null;
  return {
    peers: value.peers.map(parsePeer).filter((p): p is Peer => p !== null),
    self: parsePeer(value.self),
    numPeers: typeof value.numPeers === 'number' ? value.numPeers : value.peers.length,
  };
}

function unwrap(value: unknown, id: number): unknown {
  if (!object(value) || value.id !== id || value.jsonrpc !== '2.0') throw new Error('Invalid JSON-RPC response.');
  if (object(value.error)) throw new Error(shortText(value.error.message) || 'RPC method unavailable.');
  if (!('result' in value)) throw new Error('Missing JSON-RPC result.');
  return value.result;
}

let requestId = 0;
export const rpcRequest: Rpc = async (endpoint, method, signal) => {
  signal.throwIfAborted();
  const id = ++requestId;
  const body = JSON.stringify({ jsonrpc: '2.0', id, method, params: [] });
  if (endpoint.startsWith('wss:')) {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(endpoint);
      let settled = false;
      const finish = (error?: Error, value?: unknown) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', aborted);
        socket.close();
        if (error) reject(error); else resolve(value);
      };
      const aborted = () => finish(new Error('Request cancelled or timed out.'));
      signal.addEventListener('abort', aborted, { once: true });
      socket.onopen = () => { if (!settled) socket.send(body); };
      socket.onerror = () => finish(new Error('WebSocket unavailable. Check the address, TLS, or allowed origins.'));
      socket.onclose = () => finish(new Error('Node closed the connection.'));
      socket.onmessage = ({ data }) => {
        try {
          if (typeof data !== 'string' || data.length > MAX_BYTES) throw new Error('RPC response too large or not text.');
          const response: unknown = JSON.parse(data);
          if (object(response) && response.id !== id) return;
          finish(undefined, unwrap(response, id));
        } catch (e) { finish(e instanceof Error ? e : new Error('Invalid response.')); }
      };
      if (signal.aborted) aborted();
    });
  }
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    signal, redirect: 'error', credentials: 'omit',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty RPC response.');
  let size = 0, text = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('RPC response too large.'); }
      text += decoder.decode(value, { stream: true });
    }
  } finally { reader.releaseLock(); }
  return unwrap(JSON.parse(text + decoder.decode()), id);
};

export interface ScanOptions {
  seeds: string[];
  mode: Snapshot['mode'];
  recursive?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  budgetMs?: number;
  maxEndpoints?: number;
  maxNodes?: number;
  concurrency?: number;
  rpc?: Rpc;
  onProgress?: (snapshot: Snapshot) => void;
}

export async function scanNetwork(options: ScanOptions): Promise<Snapshot> {
  const {
    mode, recursive = false, timeoutMs = 4500, budgetMs = 60000,
    maxEndpoints = 128, maxNodes = 5000, concurrency = 4, rpc = rpcRequest,
  } = options;
  const nodes = new Map<string, NodeRecord>();
  const sources: SourceResult[] = [];
  const queue = [...new Set(options.seeds.map(validateSeed))];
  if (!queue.length || queue.length > 8) throw new Error('Choose between 1 and 8 seed nodes.');
  const queued = new Set(queue);
  const startedAt = new Date().toISOString();
  const deadline = AbortSignal.timeout(budgetMs);
  const signal = options.signal ? AbortSignal.any([deadline, options.signal]) : deadline;
  let attempted = 0, limited = false;
  const snapshot = (): Snapshot => ({ schemaVersion: 1, startedAt, generatedAt: new Date().toISOString(), mode,
    nodes: Array.from(nodes.values()).map(n => ({ ...n, sources: [...n.sources], rpcEndpoints: [...n.rpcEndpoints], reportedVersions: [...n.reportedVersions] })),
    sources: [...sources], limited, release: null });
  const observe = (peer: Peer, source: string, process?: Record<string, unknown>) => {
    const direct = process !== undefined;
    const version = parseVersion(direct ? process.version : peer.name);
    const now = new Date().toISOString();
    const old = nodes.get(peer.publicKey);
    if (!old && nodes.size >= maxNodes) { limited = true; return; }
    const record: NodeRecord = old ? { ...old } : {
      id: peer.publicKey, ip: peer.ip, name: peer.name, version, reportedVersions: [], commit: null,
      evidence: 'peer', sources: [], rpcEndpoints: [], firstSeen: now, lastSeen: now,
    };
    record.lastSeen = now;
    record.sources = [...new Set([...record.sources, source])];
    record.reportedVersions = [...new Set([...record.reportedVersions, ...(version ? [version] : [])])];
    if (peer.name !== '*self*') record.name = peer.name;
    if (isPublicIp(peer.ip) || !old) record.ip = peer.ip;
    if (direct) {
      record.rpcEndpoints = [...new Set([...record.rpcEndpoints, source])];
      if (version) { record.version = version; record.evidence = 'rpc'; }
      if (typeof process.commit === 'string') record.commit = process.commit.slice(0, 128);
    } else if (record.evidence !== 'rpc' && version) record.version = version;
    nodes.set(peer.publicKey, record);
  };
  const visit = async (endpoint: string) => {
    const callSignal = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    try {
      const network = parseNetworkInfo(await rpc(endpoint, 'stats.networkInfo', callSignal));
      if (network.self) {
        const host = new URL(endpoint).hostname.replace(/^\[|\]$/g, '');
        const self = { ...network.self, ip: host };
        observe(self, endpoint);
        try {
          const process = await rpc(endpoint, 'stats.processInfo', callSignal);
          if (object(process)) observe(self, endpoint, process);
        } catch { /* Peer discovery remains useful when processInfo is disabled. */ }
      }
      for (const peer of network.peers) {
        observe(peer, endpoint);
        if (!recursive || !isPublicIp(peer.ip)) continue;
        const host = peer.ip.includes(':') ? `[${peer.ip}]` : peer.ip;
        const next = `${mode === 'browser' ? 'https' : 'http'}://${host}:35997`;
        if (!queued.has(next)) {
          if (queued.size >= maxEndpoints) { limited = true; continue; }
          queued.add(next); queue.push(next);
        }
      }
      sources.push({ endpoint, status: 'ok', peerCount: network.peers.length,
        nodeId: network.self?.publicKey ?? null, checkedAt: new Date().toISOString() });
    } catch (error) {
      sources.push({ endpoint, status: 'error', peerCount: 0, nodeId: null,
        error: error instanceof Error ? error.message : 'Request failed.', checkedAt: new Date().toISOString() });
    }
    options.onProgress?.(snapshot());
  };
  while (queue.length && !signal.aborted && attempted < maxEndpoints) {
    const batch = queue.splice(0, Math.min(Math.max(1, concurrency), maxEndpoints - attempted));
    attempted += batch.length;
    await Promise.all(batch.map(visit));
  }
  if (queue.length || signal.aborted) limited = true;
  return snapshot();
}

export function mergeSnapshots(saved: Snapshot | null, fresh: Snapshot): Snapshot {
  if (!saved) return fresh;
  const nodes = new Map(saved.nodes.map(n => [n.id, n]));
  for (const node of fresh.nodes) {
    const old = nodes.get(node.id);
    nodes.set(node.id, old ? { ...node,
      // Keep direct evidence only when it belongs to this observation; never relabel a stale version as fresh.
      firstSeen: old.firstSeen < node.firstSeen ? old.firstSeen : node.firstSeen,
    } : node);
  }
  const sources = new Map(saved.sources.map(s => [s.endpoint, s]));
  fresh.sources.forEach(s => sources.set(s.endpoint, s));
  return { ...fresh, nodes: [...nodes.values()], sources: [...sources.values()], release: fresh.release ?? saved.release };
}

export function parseSnapshot(value: unknown): Snapshot {
  if (!object(value) || value.schemaVersion !== 1 || !Array.isArray(value.nodes) || !Array.isArray(value.sources) ||
    value.nodes.length > 5000 || value.sources.length > 2050 || !['browser', 'collector', 'discovery'].includes(String(value.mode)) ||
    typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt))) throw new Error('Invalid saved snapshot.');
  for (const node of value.nodes) {
    if (!object(node) || typeof node.id !== 'string' || !KEY.test(node.id) || typeof node.ip !== 'string' || typeof node.name !== 'string' ||
      (node.version !== null && (typeof node.version !== 'string' || !parseVersion(node.version))) ||
      !['peer', 'rpc', 'p2p', 'discovery'].includes(String(node.evidence)) ||
      !['sources', 'rpcEndpoints', 'reportedVersions'].every(k => Array.isArray(node[k]) && (node[k] as unknown[]).every(v => typeof v === 'string')) ||
      typeof node.lastSeen !== 'string' || !Number.isFinite(Date.parse(node.lastSeen))) throw new Error('Invalid saved peer.');
    if (node.handshake !== undefined) {
      const h = node.handshake;
      if (!object(h) || !['confirmed', 'failed'].includes(String(h.status)) || typeof h.ip !== 'string' ||
        !Number.isInteger(h.port) || Number(h.port) < 1024 || Number(h.port) > 65535 ||
        typeof h.attemptedAt !== 'string' || !Number.isFinite(Date.parse(h.attemptedAt)) ||
        (h.lastSuccessAt !== undefined && (typeof h.lastSuccessAt !== 'string' || !Number.isFinite(Date.parse(h.lastSuccessAt)))) ||
        (h.error !== undefined && typeof h.error !== 'string')) throw new Error('Invalid handshake record.');
    }
  }
  for (const source of value.sources) if (!object(source) || typeof source.endpoint !== 'string' || !['ok', 'error'].includes(String(source.status)))
    throw new Error('Invalid saved source.');
  if (value.release !== null && value.release !== undefined && (!object(value.release) || !parseVersion(value.release.version))) throw new Error('Invalid release.');
  if (value.crawl !== undefined && (!object(value.crawl) ||
    !['candidates', 'pending', 'attempted', 'confirmed', 'uniqueIPs', 'confirmedIPs', 'completedPasses'].every(k => Number.isInteger((value.crawl as Record<string, unknown>)[k]) && Number((value.crawl as Record<string, unknown>)[k]) >= 0) ||
    typeof value.crawl.capped !== 'boolean')) throw new Error('Invalid crawl progress.');
  return value as unknown as Snapshot;
}

export function toCsv(nodes: NodeRecord[], roles: ReadonlyMap<string, string[]> = new Map()): string {
  const quote = (v: string) => `"${(/^[=+@\-\t\r]/.test(v) ? "'" : '') + v.replaceAll('"', '""')}"`;
  const rows = nodes.map(n => [n.id, n.ip, n.version ?? 'unknown', n.name, n.evidence, n.sources.join(' | '), n.lastSeen, n.commit ?? '', (roles.get(n.id) ?? []).join(' | '), n.handshake?.status ?? '', n.handshake?.ip ?? '', String(n.handshake?.port ?? ''), n.handshake?.attemptedAt ?? '', n.handshake?.lastSuccessAt ?? '', n.handshake?.error ?? '']);
  return [['public_key', 'address', 'version', 'name', 'evidence', 'sources', 'last_seen_utc', 'commit', 'seed_roles', 'handshake_status', 'handshake_ip', 'handshake_port', 'last_attempt_utc', 'last_success_utc', 'handshake_error'], ...rows]
    .map(row => row.map(quote).join(',')).join('\r\n');
}
