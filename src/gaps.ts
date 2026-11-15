import type { MomentumHeader } from './momentums.ts';
export interface GapCounts { scheduled: number; produced: number; missed: number }
export interface GapPillar extends GapCounts { producer: string; name: string; baselineCount: number; group: 'no-baseline-production' | 'prior-production' }
export interface GapRound { start: number; end: number; proofHeight: number | null; proofHash: string | null; produced: number; matched: number; missed: number; included: boolean; reason: 'missing-proof' | 'producer-mismatch' | 'too-few-produced-slots' | 'replay-matched' }
export interface GapStudy {
  schemaVersion: 1; method: 'baseline-holdout-current-weights-v1'; generatedAt: string; source: string; status: 'waiting' | 'ready' | 'stale' | 'unavailable'; error?: string;
  baselineStart: number; baselineEnd: number; baselineComplete: boolean; baselineMomentums: number; windowStart: number | null; windowEnd: number | null; frontier: MomentumHeader | null; minimumReplay: 5;
  all: GapCounts; comparable: GapCounts; noBaselineProduction: GapCounts; priorProduction: GapCounts; rounds: GapRound[]; pillars: GapPillar[];
}
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const address = (x: unknown): x is string => typeof x === 'string' && /^z1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(x);
const hash = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const text = (x: unknown, max: number): x is string => typeof x === 'string' && x.length <= max;
const counts = (x: unknown): x is GapCounts => object(x) && integer(x.scheduled) && x.scheduled <= 360 && integer(x.produced) && integer(x.missed) && x.scheduled === x.produced + x.missed;
const sum = (rows: GapCounts[], field: keyof GapCounts) => rows.reduce((n, r) => n + r[field], 0);
const equalsSum = (c: GapCounts, rows: GapCounts[]) => (['scheduled', 'produced', 'missed'] as const).every(k => c[k] === sum(rows, k));
export function parseGapStudy(x: unknown): GapStudy {
  const invalid = () => { throw new Error('Invalid missed-slot study. Saved results remain historical.'); };
  if (!object(x) || x.schemaVersion !== 1 || x.method !== 'baseline-holdout-current-weights-v1' || !text(x.generatedAt, 40) || (x.generatedAt !== '' && !Number.isFinite(Date.parse(x.generatedAt))) || !text(x.source, 2048) || !['waiting', 'ready', 'stale', 'unavailable'].includes(String(x.status)) || (x.error !== undefined && !text(x.error, 1000)) || !integer(x.baselineStart) || !integer(x.baselineEnd) || x.baselineEnd - x.baselineStart !== 3600 || typeof x.baselineComplete !== 'boolean' || !integer(x.baselineMomentums) || x.baselineMomentums > 360 || x.minimumReplay !== 5 || ![x.all, x.comparable, x.noBaselineProduction, x.priorProduction].every(counts) || !Array.isArray(x.rounds) || x.rounds.length > 12 || !Array.isArray(x.pillars) || x.pillars.length > 360) return invalid();
  const f = x.frontier;
  if (!(f === null || object(f) && integer(f.height) && f.height > 0 && integer(f.timestamp) && f.timestamp % 10 === 0 && hash(f.hash) && hash(f.previousHash) && address(f.producer) && f.chainIdentifier === 1)) return invalid();
  if (x.windowStart === null || x.windowEnd === null) {
    if (x.windowStart !== null || x.windowEnd !== null || x.rounds.length || x.pillars.length || x.status === 'ready') return invalid();
  } else if (!integer(x.windowStart) || !integer(x.windowEnd) || x.windowStart % 300 !== 0 || x.windowEnd % 300 !== 0 || x.windowStart < x.baselineEnd || x.windowEnd <= x.windowStart || x.windowEnd - x.windowStart > 3600 || !x.baselineComplete || !f || x.windowEnd > Number(f.timestamp) || x.rounds.length !== (x.windowEnd - x.windowStart) / 300) return invalid();
  if (x.baselineComplete && (!f || Number(f.timestamp) < x.baselineEnd)) return invalid();
  for (const [i, r] of x.rounds.entries()) {
    if (!object(r) || r.start !== Number(x.windowStart) + i * 300 || r.end !== Number(r.start) + 300 || !integer(r.produced) || !integer(r.missed) || r.produced + r.missed !== 30 || !integer(r.matched) || r.matched > r.produced || typeof r.included !== 'boolean' || !['missing-proof', 'producer-mismatch', 'too-few-produced-slots', 'replay-matched'].includes(String(r.reason))) return invalid();
    if (r.reason === 'missing-proof') { if (r.proofHeight !== null || r.proofHash !== null || r.matched !== 0 || r.included) return invalid(); }
    else if (!integer(r.proofHeight) || r.proofHeight < 1 || !hash(r.proofHash) || !f || r.proofHeight >= Number(f.height)) return invalid();
    if (r.included !== (r.reason === 'replay-matched') || (r.included && (r.matched !== r.produced || r.produced < 5)) || (r.reason === 'producer-mismatch' && r.matched === r.produced) || (r.reason === 'too-few-produced-slots' && (r.matched !== r.produced || r.produced >= 5))) return invalid();
  }
  const seen = new Set<string>();
  for (const p of x.pillars) {
    if (!counts(p) || !('producer' in p) || !address(p.producer) || seen.has(p.producer) || !('name' in p) || !text(p.name, 128) || !('baselineCount' in p) || !integer(p.baselineCount) || p.baselineCount > x.baselineMomentums || !('group' in p) || p.group !== (p.baselineCount ? 'prior-production' : 'no-baseline-production') || p.scheduled === 0) return invalid();
    seen.add(p.producer);
  }
  const s = x as unknown as GapStudy;
  if (!equalsSum(s.all, s.rounds.map(r => ({ scheduled: 30, produced: r.produced, missed: r.missed }))) || !equalsSum(s.comparable, s.rounds.filter(r => r.included).map(r => ({ scheduled: 30, produced: r.produced, missed: r.missed }))) || !equalsSum(s.comparable, s.pillars) || !equalsSum(s.noBaselineProduction, s.pillars.filter(p => p.group === 'no-baseline-production')) || !equalsSum(s.priorProduction, s.pillars.filter(p => p.group === 'prior-production'))) return invalid();
  if (s.status === 'ready' && (!s.generatedAt || !s.frontier)) return invalid();
  return s;
}
export const missRate = (c: GapCounts): number | null => c.scheduled ? c.missed / c.scheduled * 100 : null;
export function gapFresh(s: GapStudy, now: number): boolean {
  const age = now - Date.parse(s.generatedAt) / 1000, tipAge = s.frontier ? now - s.frontier.timestamp : Infinity;
  return s.status === 'ready' && age >= -20 && age <= 90 && tipAge >= -20 && tipAge <= 90;
}
export function gapFinding(s: GapStudy): 'insufficient' | 'higher' | 'not-higher' {
  if (s.rounds.filter(r => r.included).length < 6 || s.noBaselineProduction.scheduled < 20 || s.priorProduction.scheduled < 20) return 'insufficient';
  return missRate(s.noBaselineProduction)! > missRate(s.priorProduction)! ? 'higher' : 'not-higher';
}
