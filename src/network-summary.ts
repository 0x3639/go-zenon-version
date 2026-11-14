import { compareVersions } from './network.ts';
import type { NodeRecord, Release } from './network.ts';

// Neighbor referrals have no software-name evidence. Keep RPC/peer/P2P reports,
// even when their version is unparseable or the latest connection attempt failed.
export const isDiscoveryOnly = (node: NodeRecord) => node.evidence === 'discovery';

export function versionSummary(nodes: NodeRecord[], release: Release | null) {
  const known = nodes.filter(n => !isDiscoveryOnly(n) && n.version !== null);
  const highest = known.map(n => n.version!).sort(compareVersions).at(-1);
  const newerObserved = !!highest && (!release || compareVersions(highest, release.version) > 0);
  const target = newerObserved ? highest : release?.version;
  const count = target ? known.filter(n => compareVersions(n.version!, target) === 0).length : 0;
  return { target, kind: release && !newerObserved ? 'published' as const : 'observed' as const,
    count, denominator: known.length, percent: known.length ? Math.round(count / known.length * 100) : null };
}
