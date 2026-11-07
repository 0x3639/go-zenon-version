import { DEFAULT_SEEDS } from './network.ts';
import type { NodeRecord, SourceResult } from './network.ts';
import { GO_ZENON_SEEDS } from './go-zenon-seeds.ts';

export type SeedRole = 'bootstrap' | 'rpc';
export type SeedFilter = 'all' | 'seeds' | SeedRole | 'other';
export const SEED_LABELS: Record<SeedRole, string> = { bootstrap: 'go-zenon seed', rpc: 'RPC seed' };
const bootstrapIds = new Set(GO_ZENON_SEEDS.map(seed => seed.id));
const normalizeEndpoint = (endpoint: string) => endpoint.replace(/\/$/, '');

/** Match seed identities, never their neighbors or an address that might have been reassigned. */
export function classifySeeds(nodes: NodeRecord[], sources: SourceResult[], rpcSeeds = DEFAULT_SEEDS): Map<string, SeedRole[]> {
  const endpoints = new Set(rpcSeeds.map(normalizeEndpoint));
  const rpcIds = new Set(sources.filter(source => source.status === 'ok' && source.nodeId && endpoints.has(normalizeEndpoint(source.endpoint)))
    .map(source => source.nodeId!.toLowerCase()));
  return new Map(nodes.map(node => {
    const roles: SeedRole[] = [];
    if (bootstrapIds.has(node.id.toLowerCase())) roles.push('bootstrap');
    if (rpcIds.has(node.id.toLowerCase()) || node.rpcEndpoints.some(endpoint => endpoints.has(normalizeEndpoint(endpoint)))) roles.push('rpc');
    return [node.id, roles];
  }));
}

export function matchesSeedFilter(roles: SeedRole[], filter: SeedFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'seeds') return roles.length > 0;
  if (filter === 'other') return roles.length === 0;
  return roles.includes(filter);
}
