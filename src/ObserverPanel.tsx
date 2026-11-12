import { useEffect, useState } from 'react';
import { ChevronDown, FlaskConical, Info, Radio, RefreshCw } from 'lucide-react';
import { observerIsStale, parseObserverArrivals, parseObserverMomentums, parseObserverPeers, parseObserverPillar, parseObserverStatus, referenceIsFresh } from './observer.ts';
import type { ObserverMomentum } from './observer.ts';
import { useObserverResource } from './useObserverResource.ts';
import { FeedNotice, Metadata } from './ObserverFeed.tsx';
import AssociationEvidence from './AssociationEvidence.tsx';
import './observer.css';

const short = (s: string) => `${s.slice(0, 10)}…${s.slice(-6)}`;
const time = (s: string) => new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const words = (s: string) => s.replaceAll('_', ' ');
const labels: Record<string, string> = { signature_checked: 'Signature checked', rpc_observed: 'RPC observed', rpc_agreed: 'RPC agreement', disputed: 'Disputed', full_broadcast: 'Full broadcast', hash_announcement: 'Hash announcement', requested_response: 'Requested response', historical_or_unresolved: 'Historical / unresolved' };
function MomentumEvidence({ api, momentum, now, revision }: { api: string; momentum: ObserverMomentum; now: number; revision: number }) {
  const arrivals = useObserverResource(`${api}/api/v1/momentums/${momentum.hash}/arrivals?limit=100`, parseObserverArrivals, revision);
  const pillar = useObserverResource(momentum.producerAddress ? `${api}/api/v1/pillars/${momentum.producerAddress}?limit=25` : null, parseObserverPillar, revision);
  const evidenceMatches = !arrivals.data || arrivals.data.result.data.every(a => a.hash === momentum.hash);
  const pillarMatches = !pillar.data || pillar.data.result.producerAddress === momentum.producerAddress;
  return <div className="observer-evidence" id={`evidence-${momentum.hash}`}>
    <div className="observer-evidence-title"><h4>Momentum evidence</h4><span>Producer software version <b>Unknown</b></span></div>
    <code className="observer-full-key">{momentum.hash}</code>
    {momentum.producerAddress ? <div className="observer-pillar">
      <h5>Dated pillar names</h5><code className="observer-full-key">{momentum.producerAddress}</code>
      <FeedNotice resource={pillar} now={now} label="Pillar history" />
      {!pillarMatches && <p className="observer-alert">The returned pillar address does not match this momentum.</p>}
      {pillar.data && pillarMatches && <>
        {pillar.data.result.nameSnapshots.length ? <ul>{pillar.data.result.nameSnapshots.slice(0, 3).map((n, i) => <li key={`${n.observedAt}-${i}`}><b>{n.pillarName}</b><span>Observed {time(n.observedAt)}</span></li>)}</ul> : <p>No dated name was returned for this address.</p>}
        <p>{pillar.data.result.momentums.length}{pillar.data.result.momentumsNextOffset !== null ? '+' : ''} observed momentums returned for this pillar in the query window. Names are dated observations, not proof of historical assignments.</p>
        <p>{pillar.data.methodVersion === 'collection-1' ? 'Association analysis is unavailable from this legacy collector.' : pillar.data.result.associationWindowStart && pillar.data.result.associationWindowEnd ? `Raw-history association window: ${time(pillar.data.result.associationWindowStart)} – ${time(pillar.data.result.associationWindowEnd)}.` : 'No complete association hours in this raw-history window.'}</p>
        <Metadata data={pillar.data} now={now} />
      </>}
    </div> : <p className="observer-alert">{momentum.signerConflict ? 'Conflicting signer claims: producer address is unknown.' : 'Producer address is unknown.'}</p>}
    {momentum.producerAddress && <AssociationEvidence key={momentum.producerAddress} api={api} producer={momentum.producerAddress} now={now} revision={revision} />}
    <h5>Per-peer arrivals</h5><p className="observer-help">Each row identifies a relay observation. Requested responses are fetched data, and are not comparable to unsolicited broadcasts. Arrival order does not establish pillar ownership.</p>
    <FeedNotice resource={arrivals} now={now} label="Arrival evidence" />
    {!evidenceMatches && <p className="observer-alert">The returned evidence does not match this momentum.</p>}
    {arrivals.data && evidenceMatches && <>
      <div className="observer-table-scroll"><table className="observer-arrivals"><thead><tr><th>Relay IP / peer</th><th>Relay advertised version</th><th>Event / arrival UTC</th><th>Capture evidence</th></tr></thead><tbody>{arrivals.data.result.data.map(a => <tr key={`${a.bootId}-${a.sessionId}-${a.hash}-${a.eventKind}`}>
        <td><b>{a.ip}</b><code title={a.peerId}>{short(a.peerId)}</code><small title={a.sessionId}>Session {short(a.sessionId)}</small></td>
        <td><span className="observer-version">{a.advertisedVersion ?? 'Unknown'}</span><small>{a.versionObservedAt ? `Observed ${time(a.versionObservedAt)}` : 'Observation time unknown'}</small></td>
        <td><b>{labels[a.eventKind] ?? words(a.eventKind)}</b><code className="observer-arrival-time">{a.arrivedAt}</code><small>{a.duplicateCount} duplicates recorded</small></td>
        <td><span>{a.eligible ? 'Capture eligible' : 'Capture excluded'}</span>{a.exclusionReason && <small>{words(a.exclusionReason)}</small>}<small>{labels[a.verificationState] ?? words(a.verificationState)} · {a.rankingEligible === null ? 'Eligibility determined by comparison window' : 'Collection only'}</small></td>
      </tr>)}</tbody></table></div>
      {!arrivals.data.result.data.length && <p className="observer-empty">No arrival evidence in this query window. This does not establish that a peer is offline.</p>}
      {arrivals.data.result.nextOffset !== null && <p className="observer-help">Showing the first 100 arrival records. Additional evidence is available from the API.</p>}
      <Metadata data={arrivals.data} now={now} />
    </>}
  </div>;
}

export default function ObserverPanel({ api }: { api: string }) {
  const [revision, setRevision] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState<'associations' | 'momentums' | 'peers'>('associations');
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<ObserverMomentum | null>(null);
  const status = useObserverResource(`${api}/api/v1/status`, parseObserverStatus, revision);
  const momentums = useObserverResource(`${api}/api/v1/momentums?limit=25`, parseObserverMomentums, revision);
  const peers = useObserverResource(`${api}/api/v1/peers?limit=100`, parseObserverPeers, revision);
  useEffect(() => { const timer = setInterval(() => { if (document.visibilityState === 'visible') setNow(Date.now()); }, 5000); return () => clearInterval(timer); }, []);
  const s = status.data?.result;
  const fresh = !!status.data && !status.error && !observerIsStale(status.data, now);
  const referenceFresh = !!s && referenceIsFresh(s.referenceObservedAt, now) && !s.referenceError;
  const active = fresh && s?.captureState === 'observing' && status.data?.dataQuality.ready !== false && s.connectedPeers > 0;
  const selectedCurrent = momentums.data?.result.data.find(m => m.hash === selected?.hash) ?? selected;
  const rows = momentums.data?.result.data.slice(0, expanded ? 25 : 6) ?? [];
  const sessions = peers.data?.result.data.slice(0, expanded ? 100 : 6) ?? [];
  const refreshing = status.loading || peers.loading || momentums.loading;
  return <section className="panel observer-panel" id="observer" aria-labelledby="observer-title">
    <div className="panel-heading observer-heading"><div><div className="observer-kicker"><FlaskConical size={13} /> EXPERIMENTAL · RELAY EVIDENCE</div><h2 id="observer-title">Observer</h2><p>Following momentums through the peers that relay them.</p></div><div className="observer-actions"><span className={`observer-state ${active ? 'active' : ''}`}><i className="dot" />{active ? 'Observing' : !status.data ? status.error ? 'Unavailable' : 'Connecting' : !fresh ? 'Snapshot unavailable / stale' : words(s!.captureState)}</span><button className="icon-button" aria-label="Refresh Observer" disabled={refreshing} onClick={() => setRevision(n => n + 1)}><RefreshCw size={16} className={refreshing ? 'spin' : ''} /></button></div></div>
    <div className="observer-intro"><Radio size={17} /><p>Relay versions describe the connected peers. <strong>Producer software version: Unknown.</strong> IP addresses and arrival order do not establish pillar ownership.</p></div>
    <FeedNotice resource={status} now={now} label="Collection status" />
    <div className="observer-stats">
      <div><span>Connected peers</span><strong>{s ? s.connectedPeers : '—'}<small>{s ? ` / ${s.configuredPeers}` : ''}</small></strong><p>{fresh ? 'Latest collection status' : 'Awaiting a fresh status'}</p></div>
      <div><span>Capture drops</span><strong className={s?.captureDrops ? 'observer-warning' : ''}>{s ? s.captureDrops : '—'}</strong><p>Collector-reported drops</p></div>
      <div><span>Checked live momentums</span><strong>{s?.distinctCheckedLiveMomentums ?? '—'}</strong><p>{s?.statisticsWindowSeconds ? `${Math.round(s.statisticsWindowSeconds / 60)} minute collection window` : 'Collector observation window'}</p></div>
      <div><span>Reference freshness</span><strong className={`observer-word ${referenceFresh ? '' : 'observer-warning'}`}>{!s ? '—' : referenceFresh ? 'Fresh' : s.referenceObservedAt ? 'Stale / unavailable' : 'Unknown'}</strong><p>{s?.referenceObservedAt ? time(s.referenceObservedAt) : 'No successful reference time'}</p></div>
    </div>
    {s && (!referenceFresh || status.data?.dataQuality.ready === false) && <p className="observer-alert"><Info size={14} />{!referenceFresh ? 'The chain reference is stale or unavailable. Collection status alone does not establish current chain agreement.' : 'The collector reports that it is not ready. Review data quality before interpreting these observations.'}</p>}
    {status.data && <Metadata data={status.data} now={now} />}
    <div className="observer-list-heading"><div className="observer-tabs" role="tablist" aria-label="Observer views"><button id="observer-tab-associations" role="tab" aria-selected={view === 'associations'} aria-controls="observer-association-list" onClick={() => { setView('associations'); setSelected(null); }}>Relay associations</button><button id="observer-tab-momentums" role="tab" aria-selected={view === 'momentums'} aria-controls="observer-momentum-list" onClick={() => { setView('momentums'); setExpanded(false); }}>Checked momentums</button><button id="observer-tab-peers" role="tab" aria-selected={view === 'peers'} aria-controls="observer-peer-list" onClick={() => { setView('peers'); setExpanded(false); setSelected(null); }}>Peer sessions</button></div><span>Refreshes about every 30s</span></div>
    {view === 'associations' ? <div role="tabpanel" id="observer-association-list" aria-labelledby="observer-tab-associations"><AssociationEvidence api={api} now={now} revision={revision} /></div> : view === 'momentums' ? <div role="tabpanel" id="observer-momentum-list" aria-labelledby="observer-tab-momentums">
      <FeedNotice resource={momentums} now={now} label="Checked momentums" />
      <div className="observer-column-labels"><span>Momentum / slot time</span><span>Producer address</span><span>Verification</span><span>Producer software</span></div>
      {rows.map(m => <article className="observer-momentum" key={m.hash}><button className="observer-momentum-row" aria-label={`${selected?.hash === m.hash ? 'Collapse' : 'Expand'} momentum ${m.height}`} aria-expanded={selected?.hash === m.hash} aria-controls={selected?.hash === m.hash ? `evidence-${m.hash}` : undefined} onClick={() => setSelected(selected?.hash === m.hash ? null : m)}>
        <span><b>#{m.height.toLocaleString()}</b><small>{time(new Date(m.timestamp * 1000).toISOString())}</small><code title={m.hash}>{short(m.hash)}</code></span>
        <span><code title={m.producerAddress ?? ''}>{m.producerAddress ? short(m.producerAddress) : 'Unknown'}</code>{m.signerConflict && <small className="observer-warning">Signer conflict</small>}</span>
        <span className={`observer-verification ${m.verificationState === 'disputed' ? 'observer-warning' : ''}`}>{labels[m.verificationState]}</span>
        <span className="observer-row-end"><span className="observer-version">Unknown</span><ChevronDown size={15} style={{ transform: selected?.hash === m.hash ? 'rotate(180deg)' : undefined }} /></span>
      </button>{selected?.hash === m.hash && selectedCurrent && <MomentumEvidence key={m.hash} api={api} momentum={selectedCurrent} now={now} revision={revision} />}</article>)}
      {momentums.data && !rows.length && <p className="observer-empty">No checked momentums in this query window. Missing observations do not establish offline pillars.</p>}
      {momentums.data && <><p className="observer-help">Latest {momentums.data.result.data.length} returned records{momentums.data.result.nextOffset !== null ? ' · more available in the API' : ''}. Default API windows may lag by up to 30 seconds. Signature and RPC checks are not full consensus validation.</p><Metadata data={momentums.data} now={now} /></>}
    </div> : <div role="tabpanel" id="observer-peer-list" aria-labelledby="observer-tab-peers"><FeedNotice resource={peers} now={now} label="Peer sessions" />
      <div className="observer-table-scroll"><table className="observer-peer-table"><thead><tr><th>Relay IP / peer</th><th>Relay advertised version</th><th>Connection interval</th><th>Session</th></tr></thead><tbody>{sessions.map(p => <tr key={`${p.bootId}-${p.sessionId}`}><td><b>{p.ip}{p.port ? `:${p.port}` : ''}</b><code title={p.peerId}>{short(p.peerId)}</code></td><td><span className="observer-version">{p.advertisedVersion ?? 'Unknown'}</span><small>{p.versionObservedAt ? `Observed ${time(p.versionObservedAt)}` : 'Observation time unknown'}</small></td><td><span>{time(p.connectedAt)}</span><small>{p.disconnectedAt ? `Until ${time(p.disconnectedAt)}` : 'No disconnect recorded'}</small>{p.uncleanShutdown && <small className="observer-warning">Unclean shutdown · end time uncertain</small>}</td><td><code title={p.sessionId}>{short(p.sessionId)}</code></td></tr>)}</tbody></table></div>
      {peers.data && !sessions.length && <p className="observer-empty">No peer sessions in this query window.</p>}{peers.data && <><p className="observer-help">Sessions are historical observations, not a count of unique peers.{peers.data.result.nextOffset !== null ? ' Showing the first 100 returned sessions.' : ''}</p><Metadata data={peers.data} now={now} /></>}
    </div>}
    {view !== 'associations' && (view === 'momentums' ? momentums.data?.result.data.length ?? 0 : peers.data?.result.data.length ?? 0) > 6 && <button className="observer-expand" onClick={() => { setExpanded(v => !v); if (expanded) setSelected(null); }}>{expanded ? 'Show fewer records' : `Show all ${view === 'momentums' ? momentums.data?.result.data.length : peers.data?.result.data.length} returned records`}<ChevronDown size={14} /></button>}
    <div className="observer-source"><span>Independent collection experiment · no ownership inference</span><a href={api} target="_blank" rel="noreferrer">Observer API ↗</a></div>
  </section>;
}
