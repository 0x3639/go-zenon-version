import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowDown, ArrowUpRight, ChevronLeft, ChevronRight, Clock3, Search, Radio } from 'lucide-react';
import { fetchProductionJSON, parseProduction, parseProductionPage, pillarActivity, productionFresh } from './production.ts';
import type { ProductionMomentum, ProductionSnapshot } from './production.ts';
import type { MomentumHeader } from './momentums.ts';
import './production.css';
import GapStudy from './GapStudy.tsx';
const fmt = (n: number) => n.toLocaleString();
const seconds = (n: number | null | undefined) => n == null ? '—' : `${Number(n.toFixed(1))}s`;
const date = (n: number) => new Date(n * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
const shortAddress = (s: string) => `${s.slice(0, 9)}…${s.slice(-6)}`;
function IntervalChart({ rows }: { rows: ProductionMomentum[] }) {
  const values = [...rows].reverse(), max = Math.max(20, ...values.map(m => m.intervalSeconds));
  return <div className="interval-chart"><svg viewBox="0 0 800 110" role="img" aria-label={`Last ${values.length} completed momentum intervals. Expected interval: 10 seconds.`} preserveAspectRatio="none">
    <line x1="0" x2="800" y1={100 - 10 / max * 90} y2={100 - 10 / max * 90} className="interval-target" />
    {values.map((m, i) => <rect key={m.hash} x={i * 800 / values.length + 3} y={100 - m.intervalSeconds / max * 90} width={Math.max(1, 800 / values.length - 6)} height={m.intervalSeconds / max * 90} rx="3" className={m.intervalSeconds > 10 ? 'late' : ''}><title>#{fmt(m.height)}: {m.intervalSeconds} seconds</title></rect>)}
  </svg><div><span>Older</span><span>Dashed line · expected 10s</span><span>Latest</span></div></div>;
}
export default function PillarProduction({ api }: { api: string }) {
  const [data, setData] = useState<ProductionSnapshot | null>(null), [error, setError] = useState(''), [now, setNow] = useState(Date.now() / 1000);
  const [tab, setTab] = useState<'pillars' | 'timing' | 'gaps'>('pillars'), [search, setSearch] = useState(''), [filter, setFilter] = useState('all'), [sort, setSort] = useState('count'), [page, setPage] = useState(0);
  const [history, setHistory] = useState<{ tip: MomentumHeader; rows: ProductionMomentum[]; next: number | null } | null>(null), [historyError, setHistoryError] = useState(''), [paging, setPaging] = useState(false);
  const historyController = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, failures = 0;
    async function poll() {
      if (document.visibilityState === 'visible' && api) {
        try { const result = parseProduction(await fetchProductionJSON(`${api.replace(/\/$/, '')}/api/v1/production`, controller.signal)); if (!controller.signal.aborted) { setData(result); setError(''); failures = 0; } }
        catch (err) { if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : 'Production history is unavailable.'); failures++; } }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, Math.min(120000, 30000 * 2 ** Math.min(failures, 2)));
    }
    void poll(); const clock = setInterval(() => setNow(Date.now() / 1000), 5000);
    return () => { controller.abort(); historyController.current?.abort(); clearTimeout(timer); clearInterval(clock); };
  }, [api]);
  const fresh = !!data && !error && productionFresh(data, now);
  const activity = (p: ProductionSnapshot['pillars'][number]) => data && !error ? pillarActivity(p, data, now) : 'waiting';
  const rows = useMemo(() => (data?.pillars ?? []).filter(p => `${p.name} ${p.producer}`.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || (filter === 'produced' ? p.count > 0 : filter === 'none' ? p.count === 0 : !error && pillarActivity(p, data!, now) === 'possible-fork'))).sort((a, b) => sort === 'name' ? (a.name || a.producer).localeCompare(b.name || b.producer) : sort === 'latest' ? (b.lastTimestamp ?? 0) - (a.lastTimestamp ?? 0) : b.count - a.count || (a.name || a.producer).localeCompare(b.name || b.producer)), [data, search, filter, sort, now, error]);
  const pages = Math.max(1, Math.ceil(rows.length / 15)), current = Math.min(page, pages - 1), visible = rows.slice(current * 15, current * 15 + 15);
  const timing = history?.rows ?? data?.recent.slice(0, 10) ?? [];
  const canPage = history ? history.next !== null : !!data?.firstHeight && !!timing.length && timing.at(-1)!.height > data.firstHeight;
  const names = new Map(data?.pillars.map(p => [p.producer, p.name || shortAddress(p.producer)]));
  async function older() {
    const tip = history?.tip ?? data?.last, before = history ? history.next : timing.at(-1)?.height;
    if (!tip || !before || paging) return;
    // Freeze the tip and current page before requesting. Polling cannot shift it.
    if (!history) setHistory({ tip, rows: timing, next: before });
    historyController.current?.abort(); const controller = new AbortController(); historyController.current = controller;
    setPaging(true); setHistoryError('');
    try {
      const query = new URLSearchParams({ tipHeight: String(tip.height), tipHash: tip.hash, beforeHeight: String(before), limit: '10' });
      const result = parseProductionPage(await fetchProductionJSON(`${api.replace(/\/$/, '')}/api/v1/production/momentums?${query}`, controller.signal), tip, before);
      if (!controller.signal.aborted) setHistory({ tip, rows: result.data, next: result.nextBeforeHeight });
    } catch (err) { if (!controller.signal.aborted) setHistoryError(err instanceof Error ? err.message : 'History could not load.'); }
    finally { if (!controller.signal.aborted) setPaging(false); }
  }
  const sinceLabel = data ? new Date(data.since).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : 'Nov 15, 2026, 9:49 AM CST';
  return <section className="panel production-panel" id="pillars" aria-labelledby="production-title">
    <div className="panel-heading"><div><h2 id="production-title"><Activity size={18} /> Pillar production</h2><p>Actual momentums since reporting cutoff · {sinceLabel}</p></div><span className={`production-state ${fresh ? 'live' : ''}`}><i className="dot" />{fresh ? 'History up to date' : data?.status === 'backfilling' && !error ? 'Loading history' : 'Waiting for fresh history'}</span></div>
    {!data?.generatedAt ? <div className="production-empty"><Radio size={25} /><h3>Reading momentum history</h3><p>{error || data?.error || (api ? 'Counts will appear as the discovery service checks chain history.' : 'Connect a discovery API in Connection settings to see production history.')}</p><span>No estimated or simulated production counts.</span></div> : <>
      {(error || !fresh) && <p className="production-notice" role="status">{error || data.error || (!data.complete ? `Partial totals: ${fmt(data.totalMomentums)} momentums checked; ${fmt(data.remaining)} still to load. Counts and shares cover only the checked history.` : 'Saved history is stale. Counts remain visible; inactivity flags are paused.')}{error && ' Saved counts retain their original timestamp.'}</p>}
      <div className="production-stats">
        <div><span>Momentums {data.complete ? 'since cutoff' : 'checked so far'}</span><strong>{fmt(data.totalMomentums)}</strong><small>{data.firstHeight ? `From #${fmt(data.firstHeight)}` : 'No production in this window yet'}</small></div>
        <div><span>Pillars that produced</span><strong>{data.pillars.filter(p => p.count > 0).length}<em> / {data.pillars.length}</em></strong><small>{data.pillars.filter(p => p.registered).length} currently registered</small></div>
        <div><span>Average momentum interval</span><strong>{seconds(data.intervals.averageSeconds)}</strong><small>Expected: 10 seconds</small></div>
        <div><span>Longest interval</span><strong className={(data.intervals.longestSeconds ?? 0) > 10 ? 'gap' : ''}>{seconds(data.intervals.longestSeconds)}</strong><small>Latest completed: {seconds(data.intervals.latestSeconds)}</small></div>
      </div>
      <div className="production-view"><div className="momentum-tabs" role="group" aria-label="Production view"><button className={tab === 'pillars' ? 'active' : ''} onClick={() => setTab('pillars')}>Pillars</button><button className={tab === 'timing' ? 'active' : ''} onClick={() => setTab('timing')}><Clock3 size={13} /> Momentum timing</button><button className={tab === 'gaps' ? 'active' : ''} onClick={() => setTab('gaps')}>Why the gaps?</button></div><span>{data.complete ? 'Complete through' : 'Checked through'} #{data.last ? fmt(data.last.height) : '—'}</span></div>
      {tab === 'gaps' ? <GapStudy api={api} /> : tab === 'pillars' ? <>
        <div className="production-filters"><label><Search size={15} /><input aria-label="Search pillars" placeholder="Find a pillar or producing address…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label><select aria-label="Filter pillar production" value={filter} onChange={e => { setFilter(e.target.value); setPage(0); }}><option value="all">All pillars</option><option value="produced">Has produced</option><option value="none">No production recorded</option><option value="flagged">Possibly forked out</option></select><select aria-label="Sort pillars" value={sort} onChange={e => { setSort(e.target.value); setPage(0); }}><option value="count">Most momentums</option><option value="name">Pillar name</option><option value="latest">Latest production</option></select></div>
        <div className="production-table-wrap"><table className="production-table pillar-production-table"><thead><tr><th>PILLAR / PRODUCING ADDRESS</th><th>MOMENTUMS <ArrowDown size={11} /></th><th>SHARE</th><th>LAST PRODUCED</th><th>ACTIVITY</th></tr></thead><tbody>{visible.map(p => <tr key={p.producer}><td><b>{p.name || 'Unregistered producer'}</b><code title={p.producer}>{p.producer}</code></td><td data-label="Momentums" className="production-count">{fmt(p.count)}</td><td data-label="Production share"><span>{data.totalMomentums ? `${(p.count / data.totalMomentums * 100).toFixed(1)}%` : '—'}</span><div className="production-share"><i style={{ width: `${p.count / Math.max(1, data.totalMomentums) * 100}%` }} /></div></td><td data-label="Last produced">{p.lastTimestamp ? <><time dateTime={new Date(p.lastTimestamp * 1000).toISOString()}>{date(p.lastTimestamp)}</time><small>#{fmt(p.lastHeight!)}</small></> : <span>{data.complete ? 'None since cutoff' : 'Not found yet'}</span>}</td><td data-label="Activity"><span className={`production-activity ${activity(p)}`}>{activity(p) === 'possible-fork' ? 'Possibly forked out' : activity(p) === 'recent' ? 'Produced within 1h' : activity(p) === 'quiet' ? 'No production in 1h' : 'Not assessed'}</span></td></tr>)}</tbody></table>{!visible.length && <p className="production-empty">No pillars match these filters.</p>}</div>
        <div className="production-pagination"><span>{fmt(rows.length)} {rows.length === 1 ? 'pillar' : 'pillars'} · page {current + 1} of {pages}</span><div><button aria-label="Previous pillars" disabled={!current} onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></button><button aria-label="Next pillars" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}><ChevronRight size={16} /></button></div></div>
        <p className="production-footnote">“Possibly forked out” applies only to zero-production pillars after at least 1 hour of complete, fresh history since the cutoff. Pillars that produced earlier show “No production in 1h” if they go quiet; they never receive the fork warning in that reporting window. It can also mean downtime, missed slots, or a new registration; it does not prove another chain. Names use the current registry and counts use the full producing address. The reporting cutoff is configured, not an independently verified fork height. Production does not reveal a pillar’s software version.</p>
      </> : <>
        <div className="timing-explanation"><h3>Every gap, measured on-chain</h3><p>Expected interval: <b>10 seconds</b>. Amber bars mark longer intervals, including missed slots. This is elapsed time between consecutive momentum timestamps, not computing time or network arrival delay.</p></div>
        <IntervalChart rows={history?.rows ?? data.recent} />
        {history && <p className="production-notice">Browsing saved history through #{fmt(history.tip.height)} · {date(history.tip.timestamp)}. This view stays fixed while new momentums arrive.</p>}
        {historyError && <p className="production-notice" role="alert">{historyError}</p>}
        <div className="production-table-wrap"><table className="production-table timing-table"><thead><tr><th>MOMENTUM</th><th>ACTUAL PRODUCER</th><th>CHAIN TIMESTAMP</th><th>INTERVAL</th><th>VS. EXPECTED</th></tr></thead><tbody>{timing.map(m => <tr key={m.hash}><td data-label="Momentum"><a href={`https://zenonhub.io/explorer/momentum/${m.hash}`} target="_blank" rel="noreferrer">#{fmt(m.height)} <ArrowUpRight size={12} /></a></td><td data-label="Actual producer"><b>{names.get(m.producer) || shortAddress(m.producer)}</b><code title={m.producer}>{shortAddress(m.producer)}</code></td><td data-label="Chain timestamp"><time dateTime={new Date(m.timestamp * 1000).toISOString()}>{date(m.timestamp)}</time></td><td data-label="Interval"><b className={m.intervalSeconds > 10 ? 'gap' : 'on-time'}>{seconds(m.intervalSeconds)}</b></td><td data-label="Vs. expected">{m.intervalSeconds === 10 ? 'On cadence' : `+${m.intervalSeconds - 10}s`}</td></tr>)}</tbody></table></div>
        <div className="production-pagination"><span>Each completed interval is saved by the discovery service.</span><div>{history && <button onClick={() => { historyController.current?.abort(); setPaging(false); setHistory(null); setHistoryError(''); }}>Return to latest</button>}<button disabled={!canPage || paging} onClick={() => void older()}>{paging ? 'Loading…' : 'Older momentums'}<ChevronRight size={14} /></button></div></div>
        <p className="production-footnote">The first included momentum is compared with the header immediately before the reporting cutoff. Times are displayed in your timezone. All summaries cover checked history; a longer interval does not identify why a slot was missed.</p>
      </>}
      <div className="production-source"><span>Checked {new Date(data.generatedAt).toLocaleString()} · refreshes every 30s</span><span title={data.source}>Source: {data.source.replace(/^wss?:\/\//, '')}</span></div>
    </>}
  </section>;
}
