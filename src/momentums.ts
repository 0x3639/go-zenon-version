import { parseVersion } from './network.ts';

export interface MomentumHeader { height: number; hash: string; previousHash: string; timestamp: number; producer: string; chainIdentifier: number }
export interface PillarSoftware { version: string | null; peerId?: string; evidence?: string; observedAt?: string; reportedVersions?: string[]; reason: string }
export interface MomentumSlot { round: number; index: number; startsAt: number; pillar: string; producer: string; software: PillarSoftware; observed?: MomentumHeader }
export interface MomentumSchedule {
  schemaVersion: 1; generatedAt: string; status: 'ready' | 'stale' | 'unavailable'; source: string; basis: 'rpc-current-weights'; error?: string;
  genesis: number; slotSeconds: 10; frontier: MomentumHeader | null; checked: number; matched: number;
  rounds: { round: number; proofHeight: number; proofHash: string; proofCutoff: number; checked: number; matched: number }[];
  slots: MomentumSlot[];
}
const obj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const integer = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x) && x >= 0;
const address = (x: unknown): x is string => typeof x === 'string' && /^z1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(x);
const hash = (x: unknown): x is string => typeof x === 'string' && /^[0-9a-f]{64}$/.test(x);
const stamp = (x: unknown): x is string => typeof x === 'string' && Number.isFinite(Date.parse(x));
function header(x: unknown): x is MomentumHeader {
  return obj(x) && integer(x.height) && hash(x.hash) && hash(x.previousHash) && integer(x.timestamp) && address(x.producer) && x.chainIdentifier === 1;
}
export function parseSchedule(input: unknown): MomentumSchedule {
  if (!obj(input) || input.schemaVersion !== 1 || !['ready', 'stale', 'unavailable'].includes(String(input.status)) || input.basis !== 'rpc-current-weights' || input.genesis !== 1637755200 || input.slotSeconds !== 10 || !integer(input.checked) || !integer(input.matched) || input.matched > input.checked || typeof input.source !== 'string' || input.source.length > 2048 || !Array.isArray(input.slots) || input.slots.length > 90 || !Array.isArray(input.rounds) || input.rounds.length > 12) throw new Error('Invalid momentum schedule.');
  if (typeof input.generatedAt !== 'string' || input.generatedAt.length > 40 || (input.generatedAt !== '' && !stamp(input.generatedAt))) throw new Error('Invalid schedule observation time.');
  if (input.status !== 'unavailable' && (!stamp(input.generatedAt) || !header(input.frontier))) throw new Error('Missing momentum observation.');
  if (input.frontier !== null && !header(input.frontier)) throw new Error('Invalid momentum frontier.');
  const seen = new Set<number>();
  for (const slot of input.slots) {
    if (!obj(slot) || !integer(slot.round) || !integer(slot.index) || slot.index < 1 || slot.index > 30 || !integer(slot.startsAt) || slot.startsAt !== input.genesis + slot.round * 300 + (slot.index - 1) * 10 || seen.has(slot.startsAt) || typeof slot.pillar !== 'string' || !slot.pillar || slot.pillar.length > 128 || !address(slot.producer) || !obj(slot.software)) throw new Error('Invalid momentum slot.');
    seen.add(slot.startsAt);
    const offset = slot.startsAt - Date.parse(input.generatedAt as string) / 1000;
    if (!Number.isFinite(offset) || offset < -610 || offset > 610) throw new Error('Slot lies outside the schedule horizon.');
    const s = slot.software;
    if (typeof s.reason !== 'string' || s.reason.length > 100 || (s.version !== null && (typeof s.version !== 'string' || s.version.length > 100 || parseVersion(s.version) !== s.version))) throw new Error('Invalid pillar version.');
    if (s.peerId !== undefined && (typeof s.peerId !== 'string' || !/^[0-9a-f]{128}$/.test(s.peerId))) throw new Error('Invalid pillar peer link.');
    if (s.version !== null && (s.reason !== 'configured-peer-link' || !s.peerId || !stamp(s.observedAt) || !['p2p', 'rpc', 'peer'].includes(String(s.evidence)))) throw new Error('Pillar version lacks attribution.');
    if (s.observedAt !== undefined && !stamp(s.observedAt)) throw new Error('Invalid version observation time.');
    if (s.reportedVersions !== undefined && (!Array.isArray(s.reportedVersions) || s.reportedVersions.length > 100 || !s.reportedVersions.every(v => typeof v === 'string' && v.length <= 100))) throw new Error('Invalid version reports.');
    if (slot.observed !== undefined && (!header(slot.observed) || slot.observed.timestamp !== slot.startsAt)) throw new Error('Invalid observed slot.');
  }
  for (const r of input.rounds) if (!obj(r) || !integer(r.round) || !integer(r.proofHeight) || !hash(r.proofHash) || !integer(r.proofCutoff) || !integer(r.checked) || !integer(r.matched) || r.matched > r.checked) throw new Error('Invalid replay result.');
  return input as unknown as MomentumSchedule;
}
export function scheduleIsFresh(s: MomentumSchedule, now: number): boolean {
  const age = now - Date.parse(s.generatedAt) / 1000;
  return s.status === 'ready' && age >= -20 && age < 45 && !!s.frontier && now - s.frontier.timestamp >= -20 && now - s.frontier.timestamp < 90 && s.slots.some(slot => slot.startsAt > now);
}
export function slotOutcome(slot: MomentumSlot, s: MomentumSchedule, now: number): 'produced' | 'different' | 'missed' | 'awaiting' | 'scheduled' {
  if (slot.observed) return slot.observed.producer === slot.producer ? 'produced' : 'different';
  // Only a later observed momentum establishes an empty slot. Wall time alone cannot.
  if (s.frontier && s.frontier.timestamp > slot.startsAt) return 'missed';
  return slot.startsAt <= now ? 'awaiting' : 'scheduled';
}
export function shownVersion(s: PillarSoftware, now: number): string | null {
  const age = now - Date.parse(s.observedAt ?? '') / 1000;
  return s.reason === 'configured-peer-link' && s.peerId && s.version && age >= -60 && age <= 3600 ? s.version : null;
}
