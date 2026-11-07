import { isPublicIp } from './network.ts';
import type { NodeRecord } from './network.ts';

export type ConnectionStatus = 'confirmed' | 'failed' | 'unverified';
export const CONNECTION_LABELS: Record<ConnectionStatus, string> = {
  confirmed: 'Handshake confirmed', failed: 'Handshake unsuccessful', unverified: 'No P2P result',
};
export function connectionStatus(node: NodeRecord): ConnectionStatus {
  const h = node.handshake;
  if (h) return h.ip === node.ip && h.port === (node.tcpPort ?? 35995) ? h.status : 'unverified';
  // Older snapshots still have real P2P hello observations, but no failed-attempt history.
  return node.evidence === 'p2p' ? 'confirmed' : 'unverified';
}

export interface UniqueIP { ip: string; nodeIds: string[]; confirmed: number }
export function groupByIP(nodes: NodeRecord[]): UniqueIP[] {
  const groups = new Map<string, UniqueIP>();
  for (const node of nodes) {
    if (!isPublicIp(node.ip)) continue;
    const ip = node.ip.includes(':') ? new URL(`http://[${node.ip}]/`).hostname.slice(1, -1) : node.ip;
    const group = groups.get(ip) ?? { ip, nodeIds: [], confirmed: 0 };
    if (group.nodeIds.includes(node.id)) continue;
    group.nodeIds.push(node.id);
    if (connectionStatus(node) === 'confirmed') group.confirmed++;
    groups.set(ip, group);
  }
  return [...groups.values()].sort((a, b) => a.ip.localeCompare(b.ip, undefined, { numeric: true }));
}

export function toIPCsv(nodes: NodeRecord[]): string {
  return ['ip,node_count,handshake_confirmed_nodes,public_keys', ...groupByIP(nodes).map(group =>
    [group.ip, group.nodeIds.length, group.confirmed, group.nodeIds.join(' | ')].map(value => `"${String(value).replaceAll('"', '""')}"`).join(','))].join('\r\n');
}
