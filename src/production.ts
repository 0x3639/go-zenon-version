import type { MomentumHeader } from './momentums.ts';
export interface ProductionMomentum extends MomentumHeader { intervalSeconds: number }
export interface ProductionPillar { producer: string; name: string; registered: boolean; count: number; lastHeight: number | null; lastTimestamp: number | null }
export interface ProductionSnapshot {
  schemaVersion: 1; generatedAt: string; since: string; status: 'ready' | 'backfilling' | 'stale' | 'unavailable'; source: string; error?: string;
  complete: boolean; firstHeight: number | null; last: MomentumHeader | null; frontier: MomentumHeader | null; totalMomentums: number; remaining: number;
  pillars: ProductionPillar[]; intervals: { samples: number; averageSeconds: number | null; shortestSeconds: number | null; longestSeconds: number | null; latestSeconds: number | null }; recent: ProductionMomentum[];
}
export interface ProductionPage { schemaVersion: 1; tipHeight: number; tipHash: string; data: ProductionMomentum[]; nextBeforeHeight: number | null }
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const address = (x: unknown): x is string => typeof x === 'string' && /^z1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(x);
const hash = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const stamp = (x: unknown): x is string => typeof x === 'string' && x.length <= 40 && Number.isFinite(Date.parse(x));
const header = (x: unknown): x is MomentumHeader => object(x) && integer(x.height) && x.height > 0 && integer(x.timestamp) && address(x.producer) && hash(x.hash) && hash(x.previousHash) && x.chainIdentifier === 1;
function momentumRows(x: unknown, limit: number): x is ProductionMomentum[] {
  if (!Array.isArray(x) || x.length > limit) return false;
  return x.every((m, i) => header(m) && 'intervalSeconds' in m && integer(m.intervalSeconds) && m.intervalSeconds >= 10 && m.intervalSeconds % 10 === 0 && (!i || (x[i - 1].height === m.height + 1 && x[i - 1].previousHash === m.hash && x[i - 1].timestamp - m.timestamp === x[i - 1].intervalSeconds)));
}
export function parseProduction(x: unknown): ProductionSnapshot {
  if (!object(x) || x.schemaVersion !== 1 || !stamp(x.since) || !(x.generatedAt === '' || stamp(x.generatedAt)) || !['ready', 'backfilling', 'stale', 'unavailable'].includes(String(x.status)) || typeof x.source !== 'string' || x.source.length > 2048 || typeof x.complete !== 'boolean' || !integer(x.totalMomentums) || !integer(x.remaining) || !(x.firstHeight === null || integer(x.firstHeight)) || !(x.last === null || header(x.last)) || !(x.frontier === null || header(x.frontier)) || !Array.isArray(x.pillars) || x.pillars.length > 5000 || !object(x.intervals) || !momentumRows(x.recent, 25)) throw new Error('Invalid production history.');
  if (x.error !== undefined && (typeof x.error !== 'string' || x.error.length > 1000)) throw new Error('Invalid production status.');
  const seen = new Set<string>(); let total = 0;
  for (const p of x.pillars) {
    if (!object(p) || !address(p.producer) || seen.has(p.producer) || typeof p.name !== 'string' || p.name.length > 128 || typeof p.registered !== 'boolean' || !integer(p.count) || !(p.lastHeight === null || integer(p.lastHeight)) || !(p.lastTimestamp === null || integer(p.lastTimestamp)) || (p.count === 0) !== (p.lastHeight === null && p.lastTimestamp === null) || (p.count > 0 && (p.lastHeight === null || p.lastTimestamp === null))) throw new Error('Invalid pillar production.');
    if (p.count > 0 && (!x.last || p.lastHeight! > x.last.height || p.lastTimestamp! > x.last.timestamp || p.lastTimestamp! < Date.parse(x.since) / 1000)) throw new Error('Pillar lies outside checked history.');
    seen.add(p.producer); total += p.count;
  }
  const i = x.intervals;
  if (total !== x.totalMomentums || i.samples !== total || ![i.averageSeconds, i.shortestSeconds, i.longestSeconds, i.latestSeconds].every(n => total === 0 ? n === null : typeof n === 'number' && Number.isFinite(n) && n >= 10) || (total > 0 && (Number(i.shortestSeconds) > Number(i.averageSeconds) || Number(i.averageSeconds) > Number(i.longestSeconds)))) throw new Error('Inconsistent production totals.');
  if (total > 0 && (!x.last || !x.frontier || !integer(x.firstHeight) || x.firstHeight < 1 || x.last.height - x.firstHeight + 1 !== total || x.frontier.height - x.last.height !== x.remaining || x.recent[0]?.hash !== x.last.hash || x.recent[0]?.intervalSeconds !== i.latestSeconds)) throw new Error('Incomplete production coverage.');
  if (total === 0 && (x.last !== null || x.firstHeight !== null || x.recent.length)) throw new Error('Invalid empty history.');
  if (x.complete && (x.remaining !== 0 || !x.frontier || !stamp(x.generatedAt))) throw new Error('Invalid coverage claim.');
  if (x.status === 'ready' && !x.complete) throw new Error('Partial history marked ready.');
  return x as unknown as ProductionSnapshot;
}
export function parseProductionPage(x: unknown, tip: MomentumHeader, before: number): ProductionPage {
  if (!object(x) || x.schemaVersion !== 1 || x.tipHeight !== tip.height || x.tipHash !== tip.hash || !momentumRows(x.data, 100) || !(x.nextBeforeHeight === null || integer(x.nextBeforeHeight)) || x.data.some(m => m.height >= before || m.height > tip.height) || (x.data.length && x.data[0].height !== before - 1) || (x.nextBeforeHeight !== null && (!x.data.length || x.nextBeforeHeight !== x.data.at(-1)!.height))) throw new Error('Invalid momentum history page.');
  return x as unknown as ProductionPage;
}
export function productionFresh(s: ProductionSnapshot, now: number): boolean {
  return s.status === 'ready' && s.complete && !!s.frontier && now - Date.parse(s.generatedAt) / 1000 >= -20 && now - Date.parse(s.generatedAt) / 1000 <= 90 && now - s.frontier.timestamp >= -20 && now - s.frontier.timestamp <= 90;
}
export const INACTIVITY_SECONDS = 3600;
export function pillarActivity(p: ProductionPillar, s: ProductionSnapshot, now: number): 'possible-fork' | 'recent' | 'quiet' | 'waiting' {
  if (!productionFresh(s, now)) return 'waiting';
  // Production anywhere in the checked window rules out this fork-warning label.
  // A later gap describes inactivity only, measured through the checked tip.
  if (p.count > 0) {
    if (p.lastTimestamp === null) return 'waiting';
    return s.frontier!.timestamp - p.lastTimestamp >= INACTIVITY_SECONDS ? 'quiet' : 'recent';
  }
  return s.frontier!.timestamp - Date.parse(s.since) / 1000 >= INACTIVITY_SECONDS ? 'possible-fork' : 'waiting';
}
export async function fetchProductionJSON(url: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]), cache: 'no-store' });
  if (response.status === 404) throw new Error('Production history is not available yet. The discovery service needs the new deployment.');
  if (response.status === 409) throw new Error('Chain history changed. Return to latest to start a new history view.');
  if (!response.ok || !response.body) throw new Error(`Production history could not load (HTTP ${response.status}).`);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let length = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; length += value.length; if (length > 2_000_000) throw new Error('Production response is too large.'); chunks.push(value); } }
  finally { await reader.cancel(); reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
