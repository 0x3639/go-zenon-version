import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FlaskConical, Search } from 'lucide-react';
import { fetchProductionJSON } from './production.ts';
import { gapFinding, gapFresh, missRate, parseGapStudy } from './gaps.ts';
import type { GapCounts, GapStudy as Study } from './gaps.ts';
import './gaps.css';
const date = (n: number) => new Date(n * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const pct = (c: GapCounts) => missRate(c) === null ? '—' : `${missRate(c)!.toFixed(1)}%`;
const reason = { 'replay-matched': 'Replay matched', 'missing-proof': 'Missing election proof', 'producer-mismatch': 'Producer mismatch', 'too-few-produced-slots': 'Fewer than 5 producers checked' };
function Cohort({ label, detail, counts }: { label: string; detail: string; counts: GapCounts }) {
  return <div className="gap-cohort"><h4>{label}</h4><p>{detail}</p><div className="gap-rate"><strong>{pct(counts)}</strong><span>of projected slots empty</span></div><div className="gap-bar" role="img" aria-label={`${counts.missed} empty and ${counts.produced} produced out of ${counts.scheduled} projected slots`}><i style={{ width: `${missRate(counts) ?? 0}%` }} /></div><small><b>{counts.missed}</b> empty · <b>{counts.produced}</b> produced · {counts.scheduled} assigned</small></div>;
}
export default function GapStudy({ api }: { api: string }) {
  const [data, setData] = useState<Study | null>(null), [error, setError] = useState(''), [now, setNow] = useState(Date.now() / 1000);
  const [search, setSearch] = useState(''), [page, setPage] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>, failures = 0;
    async function poll() {
      if (document.visibilityState === 'visible' && api) {
        try { const next = parseGapStudy(await fetchProductionJSON(`${api.replace(/\/$/, '')}/api/v1/production/gaps`, controller.signal)); if (!controller.signal.aborted) { setData(next); setError(''); failures = 0; } }
        catch (err) { if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : 'The study could not load.'); failures++; } }
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, Math.min(120000, 30000 * 2 ** Math.min(failures, 2)));
    }
    void poll(); const clock = setInterval(() => setNow(Date.now() / 1000), 5000);
    return () => { controller.abort(); clearTimeout(timer); clearInterval(clock); };
  }, [api]);
  const fresh = !!data && !error && gapFresh(data, now), finding = data ? gapFinding(data) : 'insufficient';
  const included = data?.rounds.filter(r => r.included).length ?? 0;
  const rows = data?.pillars.filter(p => `${p.name} ${p.producer}`.toLowerCase().includes(search.toLowerCase())) ?? [], pages = Math.max(1, Math.ceil(rows.length / 10)), current = Math.min(page, pages - 1);
  return <div className="gap-study" aria-labelledby="gap-title">
    <div className="gap-intro"><div><span className="gap-eyebrow"><FlaskConical size={13} /> CHAIN EVIDENCE · EXPERIMENTAL</span><h3 id="gap-title">Are silent pillars leaving empty slots?</h3><p>We test whether pillars with no production in the first hour after the cutoff miss more of their later projected assignments.</p></div><span className={`gap-badge ${fresh ? 'live' : ''}`}>{fresh ? 'Fresh study' : data?.status === 'waiting' && !error ? 'Collecting history' : 'Study not current'}</span></div>
    {(error || (!!data && !fresh && data.status !== 'waiting')) && <p className="production-notice" role="status">{error || data?.error || 'This study is stale.'} Saved results are historical; they do not describe the network now.</p>}
    {!data || data.windowStart === null ? <div className="production-empty"><h3>{error ? 'Study unavailable' : 'Waiting for a later comparison window'}</h3><p>{data?.error || error || 'The first hour forms the baseline. Only completed rounds after that hour enter the test.'}</p></div> : <>
      <div className="gap-windows"><span><b>Baseline · first hour</b>{date(data.baselineStart)} – {date(data.baselineEnd)}<small>{data.baselineMomentums} momentums · groups stay fixed</small></span><span><b>Later test window</b>{date(data.windowStart)} – {date(data.windowEnd!)}<small>{data.rounds.length} closed rounds · local timezone</small></span></div>
      <div className="gap-measures"><div><strong>{data.all.missed}<em> / {data.all.scheduled}</em></strong><span>Empty 10-second slots</span></div><div><strong>{included}<em> / {data.rounds.length}</em></strong><span>Rounds with matching replay</span></div><div><strong>{data.all.missed - data.comparable.missed}</strong><span>Empty slots excluded from attribution</span></div></div>
      <div className="gap-cohorts"><Cohort label="No production in baseline" detail="Zero momentums in the first hour" counts={data.noBaselineProduction} /><Cohort label="Produced in baseline" detail="At least one momentum in the first hour" counts={data.priorProduction} /></div>
      <div className="gap-finding"><h4>{!fresh ? 'Historical comparison only' : finding === 'insufficient' ? 'Not enough comparable slots yet' : finding === 'higher' ? 'Baseline nonproducers missed more slots' : 'This window does not support the pattern'}</h4><p>{finding === 'insufficient' ? 'The readout waits for 6 matching rounds and 20 assigned slots in each group. These are display thresholds, not statistical confidence.' : `The empty-slot rate differs by ${(missRate(data.noBaselineProduction)! - missRate(data.priorProduction)!).toFixed(1)} percentage points in the included rounds. ${finding === 'higher' ? 'This is consistent with missing production from scheduled pillars.' : 'Pillars silent during the baseline did not miss a greater share of assignments.'}`} <b>It does not prove those pillars are on another fork.</b> Downtime or a new registration can also explain silence.</p></div>
      {included < data.rounds.length && <p className="production-notice">Partial comparison: {data.rounds.length - included} rounds excluded. Their {data.all.missed - data.comparable.missed} empty slots remain in the total above, but have no accepted pillar attribution.</p>}
      <details className="gap-method"><summary>How we test this, and what remains unknown</summary><p>Groups use only production during the baseline hour, keyed by full producing address. A later momentum stays in its original group and can count against the theory. These group labels are not current fork or inactivity labels.</p><p>We replay the go-zenon election algorithm with current cached public RPC weights and each round’s historical proof momentum. Historical weights are not available here. A round enters the comparison only if at least 5 observed producers all match the replay. Matching produced slots does not independently verify assignments to empty slots.</p><p>Only complete, linked chain history through a closed round counts. The test covers at most the latest 12 eligible five-minute rounds. Exclusions may bias the comparison, and repeated slots are not independent trials. This is descriptive evidence, not a causal or statistical proof. It cannot identify a pillar’s IP, software, or another chain.</p></details>
      <div className="gap-table-title"><h4>Projected assignments by pillar</h4><p>Included rounds only · group membership comes from the baseline hour</p></div>
      <div className="production-filters"><label><Search size={15} /><input aria-label="Search study pillars" placeholder="Find a pillar or producing address…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></label></div>
      <div className="production-table-wrap"><table className="production-table gap-pillar-table"><thead><tr><th>PILLAR / PRODUCING ADDRESS</th><th>BASELINE MOMENTUMS</th><th>ASSIGNED</th><th>PRODUCED</th><th>EMPTY</th><th>EMPTY RATE</th></tr></thead><tbody>{rows.slice(current * 10, current * 10 + 10).map(p => <tr key={p.producer}><td><b>{p.name}</b><code>{p.producer}</code><small>{p.group === 'no-baseline-production' ? 'No production in baseline' : 'Produced in baseline'}</small></td><td data-label="Baseline momentums">{p.baselineCount}</td><td data-label="Assigned">{p.scheduled}</td><td data-label="Produced">{p.produced}</td><td data-label="Empty" className="gap">{p.missed}</td><td data-label="Empty rate">{pct(p)}</td></tr>)}</tbody></table></div>
      {!rows.length && <p className="production-empty">No comparable assignments match this view.</p>}
      <div className="production-pagination"><span>{rows.length} pillars · page {current + 1} of {pages}</span><div><button aria-label="Previous study pillars" disabled={!current} onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></button><button aria-label="Next study pillars" disabled={current + 1 >= pages} onClick={() => setPage(current + 1)}><ChevronRight size={16} /></button></div></div>
      <details className="gap-method gap-audit"><summary>Round-by-round evidence · {included} of {data.rounds.length} included</summary>{data.rounds.map(r => <div className="gap-round" key={r.start}><b>{date(r.start)}</b><span>{r.produced} produced · {r.missed} empty · {r.matched}/{r.produced} replay matched</span><span>{r.included ? 'Included' : 'Excluded'} · {reason[r.reason]}</span>{r.proofHash && <a href={`https://zenonhub.io/explorer/momentum/${r.proofHash}`} target="_blank" rel="noreferrer">Proof #{r.proofHeight?.toLocaleString()}</a>}</div>)}</details>
    </>}
    {data?.generatedAt && <div className="production-source gap-source"><span>Study checked {new Date(data.generatedAt).toLocaleString()} · refreshes every 30s while open</span><span>Source: {data.source.replace(/^wss?:\/\//, '')}</span></div>}
  </div>;
}
