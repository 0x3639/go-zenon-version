import { parseObserverAnalysis } from './observer.ts';
import type { AssociationEvent, ObserverAssociation } from './observer.ts';

export interface AssociationQuery { from: string; to: string; producer: string; eventKind: AssociationEvent | ''; limit: number }
export const validProducer = (value: string) => /^z1[023456789acdefghjklmnpqrstuvwxyz]{38}$/.test(value);
export function associationWindow(days = 7, now = Date.now()) {
  const end = Math.floor((now - 120000) / 3600000) * 3600000;
  return { from: new Date(end - days * 86400000).toISOString(), to: new Date(end).toISOString() };
}
export function associationKey(row: ObserverAssociation) {
  return JSON.stringify([row.producerAddress, row.bootId, row.cohortId, row.eventKind, row.peerId]);
}
export function associationURL(api: string, query: AssociationQuery, offset = 0) {
  const start = Date.parse(query.from), end = Date.parse(query.to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start % 3600000 || end % 3600000 || start >= end || end - start > 90 * 86400000 ||
    (query.producer && !validProducer(query.producer)) || !['', 'full_broadcast', 'hash_announcement'].includes(query.eventKind) ||
    ![5, 10, 25].includes(query.limit) || !Number.isInteger(offset) || offset < 0 || offset > 100000) throw new Error('Invalid relay evidence query.');
  const url = new URL('/api/v1/associations', api);
  url.search = new URLSearchParams({ from: query.from, to: query.to, limit: String(query.limit), offset: String(offset) }).toString();
  if (query.producer) url.searchParams.set('producer', query.producer);
  if (query.eventKind) url.searchParams.set('eventKind', query.eventKind);
  return url.href;
}
export function parseAssociationPage(value: unknown, query: AssociationQuery, offset: number) {
  const data = parseObserverAnalysis(value);
  if (Date.parse(data.windowStart) !== Date.parse(query.from) || Date.parse(data.windowEnd) !== Date.parse(query.to) ||
    (data.result.nextOffset !== null && data.result.nextOffset <= offset) || data.result.data.length > query.limit ||
    data.result.data.some(row => (query.producer && row.producerAddress !== query.producer) || (query.eventKind && row.eventKind !== query.eventKind))) {
    throw new Error('The Observer evidence does not match the requested producer, window, or page.');
  }
  // Offset queries are not snapshots. Deduplicate the displayed page without pooling cohorts or categories.
  data.result.data = [...new Map(data.result.data.map(row => [associationKey(row), row])).values()];
  return data;
}
