import { Info } from 'lucide-react';
import { observerIsStale } from './observer.ts';
import type { ObserverEnvelope } from './observer.ts';
import type { ObserverResource } from './useObserverResource.ts';
export const time = (s: string) => new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
export function Metadata({ data, now }: { data: ObserverEnvelope<unknown>; now: number }) {
  const q = data.dataQuality;
  const issues = ['captureDropsInOverlappingRuns', 'clockJumpsInOverlappingRuns', 'interruptedRuns'].some(k => typeof q[k] === 'number' && q[k] > 0);
  return <div className="observer-metadata">
    <div><span className={observerIsStale(data, now) ? 'observer-warning' : ''}>Generated <time dateTime={data.generatedAt} title={data.generatedAt}>{time(data.generatedAt)}</time>{observerIsStale(data, now) ? ' · Stale snapshot' : ''}</span><span>{data.observerId} · {data.methodVersion}</span></div>
    <details className={issues || q.ready === false ? 'observer-warning' : ''}><summary>Data quality{issues ? ' · capture gaps reported' : q.ready === false ? ' · needs attention' : ''}</summary><p>Window: {time(data.windowStart)} – {time(data.windowEnd)}. Run-level counters can extend beyond this window. Times are local; exact UTC values are below.</p><pre>{JSON.stringify({ generatedAt: data.generatedAt, windowStart: data.windowStart, windowEnd: data.windowEnd, dataQuality: q }, null, 2)}</pre></details>
  </div>;
}
export function FeedNotice({ resource, now, label }: { resource: ObserverResource<unknown>; now: number; label: string }) {
  if (resource.error) return <p className="observer-alert" role="status"><Info size={14} />{label}: {resource.error}{resource.data ? ' Last successful observations are retained below.' : ''}</p>;
  if (resource.data && observerIsStale(resource.data, now)) return <p className="observer-alert" role="status"><Info size={14} />{label}: this snapshot is stale. Displayed observations are historical.</p>;
  if (!resource.data) return <p className="observer-empty" role="status">{resource.loading ? `Reading ${label.toLowerCase()}…` : `No ${label.toLowerCase()} available.`}</p>;
  return null;
}
