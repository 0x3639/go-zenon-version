import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, Info, RefreshCw } from 'lucide-react';
import { associationKey, associationURL, associationWindow, associationProgress, newerAssociationHours, parseAssociationPage, validProducer } from './association-query.ts';
import type { AssociationQuery } from './association-query.ts';
import { parseObserverAnalysis } from './observer.ts';
import type { AssociationEvent, AssociationMeasurement, AssociationSummary, ObserverAssociation } from './observer.ts';
import { useObserverResource } from './useObserverResource.ts';
import { FeedNotice, Metadata, time } from './ObserverFeed.tsx';
import './observer.css';

const percent = (n: number | null) => n === null ? 'Unavailable' : `${(n * 100).toFixed(1)}%`;
const delay = (n: number | null) => n === null ? 'No deliveries' : `${n.toFixed(1)} ms`;
const excess = (n: number | null) => n === null ? 'Unavailable' : `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)} pp`;
const words = (s: string) => s.replaceAll('_', ' ');
const holdoutLabels = {
  insufficient_data: 'Insufficient holdout data', persistent_positive_pattern: 'Persistent positive pattern',
  no_persistent_specific_advantage: 'No persistent specific advantage', unstable_pattern: 'Unstable pattern',
};
const eventLabels = { hash_announcement: 'Hash announcement', full_broadcast: 'Full broadcast' };
const reasonLabels: Record<string, string> = {
  no_complete_hours: 'This interval contains no complete UTC hour to analyze.',
  association_analysis_not_implemented: 'This legacy collector has no association analysis.',
  chain_continuity_unresolved: 'Chain continuity is unresolved; comparisons are withheld.',
  raw_history_expired: 'Raw observations expired before these hours could be recomputed.',
};

export function AssociationCoverage({ summary }: { summary: AssociationSummary }) {
  const excluded = Object.values(summary.excludedHoursByReason).reduce((a, b) => a + b, 0);
  const partial = summary.pendingHours > 0 || summary.missingHours > 0 || excluded > 0;
  return <div className="association-coverage">
    <div className="association-hours"><span><b>{summary.processedHours}</b> processed hours</span><span><b>{summary.pendingHours}</b> pending <small>({summary.retryingHours} retrying)</small></span><span><b>{summary.missingHours}</b> missing hours</span><span><b>{excluded}</b> excluded hours</span></div>
    {partial && <p className="observer-warning">Incomplete coverage. Pending and retrying hours are withheld; missing hours are unknown coverage. These gaps do not mean peers or pillars were offline.</p>}
    {summary.reason && <p>{reasonLabels[summary.reason] ?? words(summary.reason)}</p>}
    {(Object.keys(summary.excludedComparisonsByReason).length > 0 || excluded > 0) && <details><summary>Excluded evidence</summary>
      <p>Whole-hour exclusions: {Object.entries(summary.excludedHoursByReason).map(([reason, count]) => `${words(reason)}: ${count}`).join(' · ') || 'None reported'}.</p>
      <p>Comparison exclusions (legacy combined counts may also include the hours above): {Object.entries(summary.excludedComparisonsByReason).map(([reason, count]) => `${words(reason)}: ${count}`).join(' · ') || 'None reported'}.</p>
    </details>}
  </div>;
}
function MeasurementCells({ measurement: m }: { measurement: AssociationMeasurement }) {
  return <><td>{m.receivedCount} / {m.eligibleCount}<small>{percent(m.deliveryCoverage)} delivery</small></td><td>{percent(m.firstArrivalShare)}<small>{m.tieCount} ties · {percent(m.tieShare)}</small></td><td>{percent(m.baselineFirstArrivalShare)}<small>{m.baselineMatchedEligibleCount} matched · {m.otherProducers.eligibleCount} other-producer samples</small></td><td>{excess(m.excessFirstArrivalShare)}</td></>;
}
function AssociationCard({ row: r }: { row: ObserverAssociation }) {
  const progress = associationProgress(r);
  const sufficient = r.associationStatus === 'observed_relay_association';
  return <article className="association-card">
    <div className="association-card-heading"><div><b>{r.pillarName || 'Unnamed producing address'}</b><span className="association-event">{eventLabels[r.eventKind]}</span></div><span className={`association-status ${sufficient ? 'threshold-met' : ''}`}>{sufficient ? 'Sample/day threshold met' : 'Insufficient data'}</span></div>
    <code className="association-address">{r.producerAddress}</code>
    <div className="association-relay"><div><small>Relay advertised version</small><strong>{r.advertisedVersion ?? 'Unknown'}</strong></div><div><small>Observed relay IP</small><b>{r.ip}</b></div><div><small>Comparable samples</small><b>{r.sampleCount.toLocaleString()} <span>across {r.utcDayCount} UTC {r.utcDayCount === 1 ? 'day' : 'days'}</span></b></div></div>
    <code className="association-peer" title="Full relay peer ID">Peer {r.peerId}</code>
    <p className="association-window">Observed {time(r.firstObservedAt)} – {time(r.lastObservedAt)} · version observed {time(r.versionObservedAt)}</p>
    {!sufficient && <p className="association-caution">{progress.samplesNeeded} more comparable samples and {progress.daysNeeded} more UTC {progress.daysNeeded === 1 ? 'day' : 'days'} needed to meet the 100-sample / three-day threshold in this comparison group. Reconnects, upgrades, and observer restarts create separate groups; their samples cannot be added together.</p>}
    {sufficient && <p className="association-caution">Observed relay association: the sample/day threshold is met, including for negative findings. This is not ownership or software attribution.</p>}
    <div className="association-metrics">
      <div><span>Delivery coverage</span><b>{percent(r.deliveryCoverage)}</b><small>{r.receivedCount} / {r.eligibleCount} comparisons</small></div>
      <div><span>Strict first-arrival share</span><b>{percent(r.firstArrivalShare)}</b><small>{r.firstArrivalCount} first · {r.tieCount} ties ({percent(r.tieShare)})</small></div>
      <div><span>Relative delay · median / p95</span><b>{r.receivedCount ? delay(r.medianRelativeDelayMs) : 'No deliveries'}</b><small>p95: {r.p95RelativeDelayMs === null ? 'Unavailable' : delay(r.p95RelativeDelayMs)}</small></div>
      <div><span>Matched baseline · first share</span><b>{percent(r.baselineFirstArrivalShare)}</b><small>{excess(r.excessFirstArrivalShare)} excess on {r.baselineMatchedEligibleCount} / {r.eligibleCount} matched samples</small></div>
    </div>
    <div className="association-holdout"><span>Chronological holdout</span><b>{holdoutLabels[r.holdout.result]}</b></div>
    {r.holdout.result === 'insufficient_data' && progress.emptyHalf && <p className="association-caution">No eligible samples in the {progress.emptyHalf} half of this fixed window. Holdout needs evidence in both halves; a healthy collector alone cannot satisfy it.</p>}
    <details className="association-detail"><summary>Comparison context, holdout & daily evidence <ChevronDown size={13} /></summary>
      <dl><dt>Cohort</dt><dd><code>{r.cohortId}</code></dd><dt>Boot</dt><dd><code>{r.bootId}</code></dd><dt>Other eligible peers</dt><dd>{r.activeCompetitorCount}</dd><dt>Cohort session IDs</dt><dd>{r.cohortSessionIds.map(id => <code key={id}>{id}<br /></code>)}</dd><dt>Cohort anchor duration</dt><dd>{r.connectedDurationSeconds.toFixed(1)} seconds (not lifetime uptime)</dd><dt>Dated pillar name</dt><dd>{r.pillarNameObservedAt ? `Observed ${time(r.pillarNameObservedAt)}; historical assignment not established` : 'No dated name available'}</dd><dt>Raw evidence retained</dt><dd>{r.rawEvidenceAvailable ? 'Yes' : 'Partial: some original observations expired; exact historical recomputation is unavailable'}</dd><dt>Producer software version</dt><dd>Unknown</dd></dl>
      <p>Window split: {time(r.holdout.splitAt)}. Holdout needs the overall sample/day threshold, at least 20 eligible and 20 other-producer samples per half, and 80% baseline coverage in each half. A positive pattern requires more than +5 percentage points in both halves. These are descriptive checks, not statistical confidence or ownership probability.</p>
      <div className="observer-table-scroll"><table><thead><tr><th>Half</th><th>Delivered / eligible</th><th>Strict first share</th><th>Matched baseline</th><th>Excess share</th></tr></thead><tbody>{(['earlier', 'later'] as const).map(half => <tr key={half}><td>{half === 'earlier' ? 'Earlier' : 'Later'}</td><MeasurementCells measurement={r.holdout[half]} /></tr>)}</tbody></table></div>
      <div className="observer-table-scroll"><table><thead><tr><th>UTC day</th><th>Delivered / eligible</th><th>Strict first share</th><th>Matched baseline</th><th>Excess share</th></tr></thead><tbody>{r.perDay.map(day => <tr key={day.utcDay}><td>{day.utcDay}</td><MeasurementCells measurement={day} /></tr>)}</tbody></table></div>
    </details>
    <div className="association-cohort"><span title={r.cohortId}>Cohort {r.cohortId}</span><span>{r.activeCompetitorCount} other eligible peers · {eventLabels[r.eventKind]}</span></div>
  </article>;
}
function EvidencePage({ api, query, now, revision }: { api: string; query: AssociationQuery; now: number; revision: number }) {
  const [offsets, setOffsets] = useState([0]);
  const offset = offsets.at(-1)!;
  const parse = useMemo(() => (value: unknown) => parseAssociationPage(value, query, offset), [query, offset]);
  const resource = useObserverResource(associationURL(api, query, offset), parse, revision);
  const result = resource.data?.result;
  return <>
    <FeedNotice resource={resource} now={now} label="Relay association evidence" />
    {resource.error && <p className="observer-help">For a query or response limit, select fewer rows or a shorter window. Other panels continue independently.</p>}
    {resource.data && result && <>
      <div className="association-availability"><b>{result.available ? 'Comparison summaries available' : 'Association summaries unavailable'}</b><span>{result.computedAt ? `Computed ${time(result.computedAt)}` : 'No computed summary time'}</span></div>
      <p className="association-caption">Summary availability does not mean any row meets the sample/day threshold. Baselines compare this relay with its own deliveries for other producers in matched hours.</p>
      <AssociationCoverage summary={result} />
      {result.available && result.data.length > 0 && <div className="association-progress-summary"><b>{result.data.filter(r => r.associationStatus === 'observed_relay_association').length} of {result.data.length} rows on this page meet the sample/day threshold.</b><p>Each row measures one relay in one comparison group and event category. This page is not a ranking or a network-wide verdict. Use a pillar’s View relay evidence action or its full producing address to inspect that pillar.</p></div>}
      {result.available && result.data.map(row => <AssociationCard key={associationKey(row)} row={row} />)}
      {!result.data.length && <p className="observer-empty">No relay comparisons returned for this filter and window. Missing evidence does not establish an offline pillar or relay.</p>}

      <p className="association-caption">Only this page is displayed. Dates stay fixed during paging and polling. Late evidence can move rows between pages; cohorts and event categories are never combined.</p>
      <Metadata data={resource.data} now={now} />
    </>}
    <div className="association-pagination"><span>Page {offsets.length}{result ? ` · ${result.data.length} rows` : ''}{offset > 0 || result?.nextOffset != null ? ' · Partial results' : ''}</span><div><button disabled={offsets.length < 2} onClick={() => setOffsets(v => v.slice(0, -1))}>Previous</button><button disabled={result?.nextOffset == null || !!resource.error || resource.loading} onClick={() => { if (result?.nextOffset != null) setOffsets(v => [...v, result.nextOffset!]); }}>Next page</button></div></div>
  </>;
}
export default function AssociationEvidence({ api, producer = '', now, revision = 0, embedded = false }: { api: string; producer?: string; now: number; revision?: number; embedded?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const [filter, setFilter] = useState('');
  const [filterError, setFilterError] = useState('');
  const [eventKind, setEventKind] = useState<AssociationEvent | ''>('');
  const [days, setDays] = useState(7);
  const [limit, setLimit] = useState(10);
  const [window, setWindow] = useState<ReturnType<typeof associationWindow> | null>(null);
  // A bounded first page discovers the server's default window and supports legacy collectors.
  // It is producer-filtered in selected details; no requests are issued per scheduled slot.
  const initialURL = new URL('/api/v1/associations', api);
  initialURL.searchParams.set('limit', '1');
  if (producer) initialURL.searchParams.set('producer', producer);
  const initialParse = useMemo(() => (value: unknown) => {
    const data = parseObserverAnalysis(value);
    if (producer && data.result.data.some(row => row.producerAddress !== producer)) throw new Error('Mismatched producing address.');
    return data;
  }, [producer]);
  const initial = useObserverResource(window ? null : initialURL.href, initialParse, revision);
  useEffect(() => {
    if (initial.data?.methodVersion === 'association-2') setWindow({ from: initial.data.windowStart, to: initial.data.windowEnd });
  }, [initial.data]);
  const [refresh, setRefresh] = useState(0);
  const query = useMemo(() => (window ? { ...window, producer: producer || filter, eventKind, limit } : null), [window, producer, filter, eventKind, limit]);
  if (!window || !query) return <div className="association-evidence"><h3>Observed relay versions</h3><FeedNotice resource={initial} now={now} label="Association availability" />{initial.data?.methodVersion === 'collection-1' && <><p className="association-caption">Association analysis pending. This legacy collector provides arrival evidence only. Producer software version: Unknown.</p><Metadata data={initial.data} now={now} /></>}</div>;
  return <div className="association-evidence">
    <div className="association-title"><div>{!embedded && <h3>Observed relay versions</h3>}<p>Evidence from an independent observer’s network location.</p></div><button className="association-refresh" onClick={() => { setWindow(associationWindow(days)); setRefresh(v => v + 1); }}><RefreshCw size={12} /> Update window</button></div>
    {producer && <code className="association-address">Producing address: {producer}</code>}
    <p className="association-meaning"><Info size={14} /><span>These versions belong to relays. <b>Producer software version: Unknown.</b> Neither arrival order nor a strong association proves pillar ownership. A pillar’s software needs a separate configured peer link.</span></p>
    {!producer && <form className="association-producer-filter" onSubmit={e => { e.preventDefault(); const value = draft.trim(); if (value && !validProducer(value)) { setFilterError('Enter the full z1 producing address; names and IPs cannot be used to match a pillar.'); return; } setFilter(value); setFilterError(''); }}><label htmlFor={`${id}-producer`}>Filter by full producing address</label><div><input id={`${id}-producer`} value={draft} onChange={e => setDraft(e.target.value)} placeholder="z1…" spellCheck={false} aria-invalid={!!filterError} aria-describedby={filterError ? `${id}-error` : undefined} /><button type="submit">Apply filter</button>{filter && <button type="button" onClick={() => { setDraft(''); setFilter(''); setFilterError(''); }}>Clear</button>}</div>{filterError && <p id={`${id}-error`} role="alert">{filterError}</p>}{filter && <code className="association-address">Active producing address: {filter}</code>}</form>}
    {producer ? <details className="association-filter-details"><summary>Window and event filters</summary><div className="association-controls"><label>Event category<select value={eventKind} onChange={e => setEventKind(e.target.value as AssociationEvent | '')}><option value="">Both · separate rows</option><option value="hash_announcement">Hash announcements</option><option value="full_broadcast">Full broadcasts</option></select></label><label>Window<select value={days} onChange={e => { const n = Number(e.target.value); setDays(n); setWindow(associationWindow(n)); }}><option value={1}>24 hours</option><option value={7}>7 days</option><option value={30}>30 days</option></select></label><label>Rows per page<select value={limit} onChange={e => setLimit(Number(e.target.value))}><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option></select></label></div></details> : <div className="association-controls"><label>Event category<select value={eventKind} onChange={e => setEventKind(e.target.value as AssociationEvent | '')}><option value="">Both · separate rows</option><option value="hash_announcement">Hash announcements</option><option value="full_broadcast">Full broadcasts</option></select></label><label>Window<select value={days} onChange={e => { const n = Number(e.target.value); setDays(n); setWindow(associationWindow(n)); }}><option value={1}>24 hours</option><option value={7}>7 days</option><option value={30}>30 days</option></select></label><label>Rows per page<select value={limit} onChange={e => setLimit(Number(e.target.value))}><option value={5}>5</option><option value={10}>10</option><option value={25}>25</option></select></label></div>}
    <p className="association-fixed-window">Fixed UTC window: <time>{window.from.replace('.000Z', 'Z')}</time> → <time>{window.to.replace('.000Z', 'Z')}</time></p>
    {newerAssociationHours(window.to, now) > 0 && <p className="association-window-notice" role="status">{newerAssociationHours(window.to, now)} newer complete UTC {newerAssociationHours(window.to, now) === 1 ? 'hour can' : 'hours can'} be requested. This window stays fixed while polling and paging. Choose <b>Update window</b> to include newer hours; they may still be pending analysis.</p>}
    <EvidencePage key={`${JSON.stringify(query)}:${refresh}`} api={api} query={query} now={now} revision={revision} />
    <p className="association-caption">Comparable samples include missed deliveries. Strict first arrivals exclude ties; delays describe deliveries only. A faster route to this observer can affect every measurement. <a href="https://github.com/0x3639/go-zenon-pillar-version/blob/main/docs/association-analysis.md" target="_blank" rel="noreferrer">Read the interpretation rules ↗</a></p>
  </div>;
}
