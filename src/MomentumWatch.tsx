import { useEffect, useState } from 'react';
import { ArrowUpRight, Check, ChevronDown, Clock3, Info, Radio, RefreshCw } from 'lucide-react';
import { parseSchedule, scheduleIsFresh, shownVersion, slotOutcome } from './momentums.ts';
import type { MomentumSchedule, MomentumSlot } from './momentums.ts';
import './momentums.css';

const localTime = (unix: number) => new Date(unix * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const compact = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`;
const resultLabels = { produced: 'Produced', different: 'Different producer', missed: 'No momentum', awaiting: 'Awaiting observation', scheduled: 'Projected' };

export function MomentumWatch({ api }: { api: string }) {
  const [data, setData] = useState<MomentumSchedule | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now() / 1000);
  const [view, setView] = useState<'upcoming' | 'recent'>('upcoming');
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') setNow(Date.now() / 1000); }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setData(null); setError(''); setLoading(!!api);
    if (!api) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function refresh() {
      if (stopped) return;
      if (document.visibilityState === 'visible') {
        try {
          const response = await fetch(`${api.replace(/\/$/, '')}/api/v1/momentums`, { credentials: 'omit', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]) });
          if (response.status === 404) throw new Error('Upcoming momentums aren’t available from this discovery service yet.');
          if (!response.ok && response.status !== 503) throw new Error('The momentum feed is temporarily unavailable.');
          const reader = response.body?.getReader();
          if (!reader) throw new Error('The momentum feed returned an empty response.');
          const decoder = new TextDecoder();
          let raw = '', bytes = 0;
          try {
            while (true) {
              const { value, done } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 500000) throw new Error('The momentum feed returned too much data.');
              raw += decoder.decode(value, { stream: true });
            }
            raw += decoder.decode();
          } finally { await reader.cancel(); }
          const snapshot = parseSchedule(JSON.parse(raw));
          if (!stopped) { setData(snapshot); setError(snapshot.status === 'unavailable' ? 'The public node could not provide a fresh schedule. Retrying automatically.' : ''); }
        } catch (e) {
          if (!stopped) setError(e instanceof Error ? e.message : 'Unable to read the momentum feed.');
        } finally { if (!stopped) setLoading(false); }
      }
      if (!stopped) timer = setTimeout(refresh, 10000);
    }
    void refresh();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); };
  }, [api]);
  const fresh = !!data && !error && scheduleIsFresh(data, now);
  const upcoming = data?.slots.filter(s => s.startsAt > now).sort((a, b) => a.startsAt - b.startsAt) ?? [];
  const recent = data?.slots.filter(s => s.startsAt <= now).sort((a, b) => b.startsAt - a.startsAt) ?? [];
  const next = upcoming[0];
  const chosen = data?.slots.find(s => s.startsAt === selected) ?? next;
  const slots = view === 'upcoming' ? upcoming : recent;
  const rows = expanded ? slots : slots.slice(0, 6);
  const mismatches = (data?.checked ?? 0) - (data?.matched ?? 0);
  const software = (slot: MomentumSlot) => shownVersion(slot.software, now);
  return <section className="panel momentum-watch" id="momentums" aria-labelledby="momentum-title">
    <div className="panel-heading momentum-heading"><div><h2 id="momentum-title"><Clock3 size={17} /> Momentum watch</h2><p>Who’s scheduled next, and what we know about their software.</p></div><span className={`schedule-state ${fresh ? '' : 'muted'}`}><i className="dot" /> {fresh ? 'RPC projection' : loading ? 'Connecting' : 'Waiting for fresh data'}</span></div>
    {!data?.slots.length ? <div className="schedule-empty"><Radio size={25} /><h3>{loading ? 'Reading the production schedule…' : 'The next producer will appear here'}</h3><p>{error || (api ? 'The service is gathering recent momentums and pillar weights. This view updates automatically.' : 'Connect a discovery API in Connection settings to see upcoming momentums.')}</p><span>Live observations only · no simulated schedule</span></div> : <>
      <div className="momentum-hero">
        <div className="next-producer"><div className="eyebrow">{fresh && next ? 'NEXT SCHEDULED PILLAR' : 'LAST AVAILABLE PROJECTION'}</div><h3>{next?.pillar ?? 'Schedule has elapsed'}</h3><div className="next-meta"><span className={`momentum-version ${next && software(next) ? 'known' : ''}`}>{next && software(next) ? software(next) : 'Version unknown'}</span>{next && <span>{localTime(next.startsAt)} <small>local time</small></span>}</div>{next && <code title={next.producer}>{compact(next.producer)}</code>}</div>
        <div className="slot-countdown"><span>{fresh && next ? 'SLOT STARTS IN' : 'COUNTDOWN PAUSED'}</span><strong>{fresh && next ? <>{Math.max(0, Math.ceil(next.startsAt - now)).toString().padStart(2, '0')}<small>s</small></> : '—'}</strong><div className="slot-progress" role="progressbar" aria-label="Time until next slot" aria-valuemin={0} aria-valuemax={10} aria-valuenow={fresh && next ? Math.min(10, Math.max(0, next.startsAt - now)) : 0}><i style={{ width: `${fresh && next ? Math.min(100, Math.max(0, (next.startsAt - now) * 10)) : 0}%` }} /></div></div>
        <div className="schedule-facts"><span>Latest observed momentum<b>{data.frontier?.height.toLocaleString() ?? '—'}</b></span><span>Recent election replay<b className={mismatches ? 'mismatch' : ''}>{data.matched} / {data.checked} match</b></span><span>Projection horizon<b>{fresh && upcoming.length ? `${Math.ceil((upcoming.at(-1)!.startsAt + 10 - now) / 60)} min · ${upcoming.length} slots` : 'Awaiting fresh data'}</b></span></div>
      </div>
      {(!fresh || mismatches > 0) && <div className="schedule-alert" role="status"><Info size={15} /><p>{!fresh ? error || 'This feed is stale. The countdown is paused; displayed observations are historical.' : `${mismatches} recent momentum${mismatches === 1 ? '' : 's'} differ from this reconstruction. Public RPC weights may have changed or lagged; upcoming producers are uncertain.`}</p></div>}
      <div className="slot-tape-label"><span><i className="dot" /> NEXT {Math.min(30, upcoming.length)} SLOTS</span><span>10 seconds per slot · select one to inspect</span></div>
      <div className="slot-tape" aria-label="Upcoming momentum slots">{upcoming.slice(0, 30).map((slot, i) => <button key={slot.startsAt} className={`${i === 0 ? 'first' : ''} ${chosen?.startsAt === slot.startsAt ? 'selected' : ''} ${software(slot) ? 'known' : ''}`} onClick={() => setSelected(slot.startsAt)} aria-pressed={chosen?.startsAt === slot.startsAt} aria-label={`${slot.pillar}, ${localTime(slot.startsAt)}, ${software(slot) ?? 'version unknown'}`} title={`${slot.pillar} · ${localTime(slot.startsAt)} · ${software(slot) ?? 'Version unknown'}`}><i /><span>{i === 0 ? 'NEXT' : i % 5 === 0 ? `+${i * 10}s` : ''}</span></button>)}</div>
      {chosen && <div className="slot-inspector"><span><b>{chosen.pillar}</b> <code>{compact(chosen.producer)}</code></span><span>{localTime(chosen.startsAt)} · round {chosen.round.toLocaleString()} / slot {chosen.index}</span><span className={`momentum-version ${software(chosen) ? 'known' : ''}`}>{software(chosen) ?? 'Version unknown'}</span>{software(chosen) && <small>Configured peer link · {chosen.software.evidence} · observed {new Date(chosen.software.observedAt!).toLocaleString()}{(chosen.software.reportedVersions?.length ?? 0) > 1 ? ' · multiple version reports' : ''}</small>}</div>}
      <div className="momentum-list-heading"><div className="momentum-tabs" role="group" aria-label="Momentum view"><button className={view === 'upcoming' ? 'active' : ''} onClick={() => { setView('upcoming'); setExpanded(false); }}>Upcoming</button><button className={view === 'recent' ? 'active' : ''} onClick={() => { setView('recent'); setExpanded(false); }}>Recent outcomes</button></div><span>Times shown in your timezone</span></div>
      <div className="momentum-table-wrap"><table className="momentum-table"><thead><tr><th>SLOT TIME</th><th>EXPECTED PILLAR</th><th>GO-ZENON</th><th>RESULT</th></tr></thead><tbody>{rows.map(slot => { const outcome = slotOutcome(slot, data, now); return <tr key={slot.startsAt}><td><time dateTime={new Date(slot.startsAt * 1000).toISOString()}>{localTime(slot.startsAt)}</time></td><td><button className="pillar-inspect" onClick={() => setSelected(slot.startsAt)}>{slot.pillar}<ArrowUpRight size={12} /></button></td><td><span className={`momentum-version ${software(slot) ? 'known' : ''}`}>{software(slot) ?? 'Unknown'}</span></td><td><span className={`slot-outcome ${outcome}`}>{outcome === 'produced' && <Check size={12} />}{resultLabels[outcome]}{slot.observed && <small>#{slot.observed.height.toLocaleString()}{outcome === 'different' ? ` · ${compact(slot.observed.producer)}` : ''}</small>}</span></td></tr>; })}</tbody></table>{!rows.length && <p className="empty">No {view === 'upcoming' ? 'upcoming slots remain in this snapshot' : 'recent slots are available'}.</p>}</div>
      {slots.length > 6 && <button className="schedule-expand" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show fewer slots' : `Show all ${slots.length} slots`}<ChevronDown size={14} style={{ transform: expanded ? 'rotate(180deg)' : undefined }} /></button>}
    </>}
    <div className="schedule-note"><Info size={15} /><p>Scheduled slots are projections, not guaranteed momentums. Pillar addresses and peer keys are separate identities; a version stays unknown until an explicit peer link is supplied. Receiving a momentum from an IP identifies a relay, not necessarily its producer. <a href={`${import.meta.env.BASE_URL}guide/`}>How to read this data <ArrowUpRight size={11} /></a></p></div>
    {data?.generatedAt && <div className="schedule-source"><span><RefreshCw size={11} /> Checked {new Date(data.generatedAt).toLocaleTimeString()} · refreshes every 10s</span><span title={data.source}>Source: {(() => { try { return new URL(data.source).hostname; } catch { return 'Public RPC'; } })()}</span></div>}
  </section>;
}
